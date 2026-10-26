import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@st/domain';
import { NAMESPACES, resources } from '../src/resources';
import { STATEMENT_PARAMS } from '../src/params';
import {
  analyzeMessage,
  flatten,
  formatReport,
  loadCatalog,
  readDomainSets,
  requiredPluralCategories,
  validateCatalog,
} from '../scripts/validate.ts';
import type { Catalog } from '../scripts/validate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, '..', 'locales');
const domainTypes = join(here, '..', '..', 'domain', 'src', 'types.ts');

describe('catalog on disk', () => {
  const catalog = loadCatalog(localesDir);

  it('passes every check (keys, ICU, placeholders, plural categories, domain coverage)', () => {
    const issues = validateCatalog(catalog, { domainTypesPath: domainTypes });
    const errors = issues.filter((i) => i.level === 'error');
    expect(errors, formatReport(issues)).toEqual([]);
  });

  it('has exactly one folder per supported locale', () => {
    const folders = readdirSync(localesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(folders).toEqual([...LOCALES].sort());
  });

  it('registers every namespace file in resources.ts', () => {
    for (const locale of LOCALES) {
      const files = readdirSync(join(localesDir, locale))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .sort();
      expect(files, locale).toEqual([...NAMESPACES].sort());
      for (const ns of NAMESPACES) {
        const onDisk = JSON.parse(readFileSync(join(localesDir, locale, `${ns}.json`), 'utf8')) as unknown;
        expect(resources[locale][ns], `${locale}/${ns}`).toEqual(onDisk);
      }
    }
  });

  it('keeps the review note that every non-English locale needs native review', () => {
    expect(existsSync(join(localesDir, 'REVIEW.md'))).toBe(true);
  });

  it('English copy uses the documented statement and notification parameters', () => {
    const domain = readDomainSets(domainTypes);
    expect(Object.keys(STATEMENT_PARAMS).sort()).toEqual([...domain.sanctionReasons].sort());
  });
});

describe('validator', () => {
  const base = (en: Record<string, unknown>, other: Record<string, unknown>): Catalog => ({
    en: { x: en },
    de: { x: other },
  });
  const messages = (c: Catalog) => validateCatalog(c, { expectedLocales: ['en', 'de'] }).map((i) => i.message);

  it('accepts a matching translation', () => {
    expect(messages(base({ a: 'Hi {name}' }, { a: 'Hallo {name}' }))).toEqual([]);
  });

  it('reports missing and extra keys', () => {
    const out = messages(base({ a: 'A', b: 'B' }, { a: 'A', c: 'C' })).join('\n');
    expect(out).toMatch(/missing key/);
    expect(out).toMatch(/extra key/);
  });

  it('reports empty strings and surrounding whitespace', () => {
    const out = messages(base({ a: 'A', b: 'B' }, { a: '', b: ' B ' })).join('\n');
    expect(out).toMatch(/empty string/);
    expect(out).toMatch(/whitespace/);
  });

  it('reports ICU syntax errors', () => {
    expect(messages(base({ a: 'A {n}' }, { a: 'A {n' })).join('\n')).toMatch(/ICU parse error/);
  });

  it('reports placeholder mismatches', () => {
    const out = messages(base({ a: 'Hi {name}' }, { a: 'Hallo {nom}' })).join('\n');
    expect(out).toMatch(/missing \{name\}/);
    expect(out).toMatch(/unexpected \{nom\}/);
  });

  it('reports missing and unused CLDR plural categories', () => {
    const en = { a: '{n, plural, one {# item} other {# items}}' };
    const missingFew = '{n, plural, one {# x} other {# xs}}';
    // Russian needs one/few/many/other
    const c: Catalog = { en: { x: en }, ru: { x: { a: missingFew } } };
    const out = validateCatalog(c, { expectedLocales: ['en', 'ru'] })
      .map((i) => i.message)
      .join('\n');
    expect(out).toMatch(/lacks CLDR categories: few, many/);
    // German must not carry `few`
    const c2: Catalog = { en: { x: en }, de: { x: { a: '{n, plural, one {# x} few {# y} other {# xs}}' } } };
    expect(
      validateCatalog(c2, { expectedLocales: ['en', 'de'] })
        .map((i) => i.message)
        .join('\n'),
    ).toMatch(/never uses: few/);
  });

  it('allows exact =N matches next to the CLDR categories', () => {
    const c = base({ a: '{n, plural, =0 {none} one {# item} other {# items}}' }, { a: '{n, plural, =0 {keine} one {# Stück} other {# Stücke}}' });
    expect(messages(c)).toEqual([]);
  });

  it('requires identical select options', () => {
    const c = base({ a: '{k, select, a {A} b {B} other {O}}' }, { a: '{k, select, a {A} other {O}}' });
    expect(messages(c).join('\n')).toMatch(/select options/);
  });

  it('flatten rejects non-string leaves and dotted keys', () => {
    const bad: string[] = [];
    flatten({ a: 1, 'b.c': 'x', d: [1] }, (key) => bad.push(key));
    expect(bad.sort()).toEqual(['a', 'b.c', 'd']);
  });

  it('analyzeMessage finds nested plural arguments', () => {
    const info = analyzeMessage('{a, select, x {{n, plural, one {#} other {# {name}}}} other {z}}');
    expect([...info.args.keys()].sort()).toEqual(['a', 'n', 'name']);
  });
});

describe('CLDR plural categories', () => {
  const modern = Number.parseFloat(process.versions.cldr ?? '0') >= 47;
  const expected: Record<string, string[]> = {
    en: ['one', 'other'],
    de: ['one', 'other'],
    hi: ['one', 'other'],
    he: ['one', 'other', 'two'],
    ar: ['few', 'many', 'one', 'other', 'two', 'zero'],
    ru: ['few', 'many', 'one', 'other'],
    fr: ['many', 'one', 'other'],
    es: ['many', 'one', 'other'],
    it: ['many', 'one', 'other'],
    pt: ['many', 'one', 'other'],
    ja: ['other'],
    'zh-Hans': ['other'],
    'zh-Hant': ['other'],
  };
  it.skipIf(!modern)('matches the categories this project translates for', () => {
    for (const [locale, cats] of Object.entries(expected)) {
      expect(requiredPluralCategories(locale), locale).toEqual(cats);
    }
  });
});
