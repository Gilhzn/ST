/**
 * Catalog validation shared by `scripts/check-keys.ts` (CLI) and `test/catalog.test.ts`.
 *
 * Runs under plain Node (`--experimental-strip-types`), so it only uses erasable
 * TypeScript syntax and explicit `.ts` import extensions.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse, TYPE } from '@formatjs/icu-messageformat-parser';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { NOTIFICATION_PARAMS, PHASE15_NOTIFICATION_PARAMS, STATEMENT_PARAMS } from '../src/params.ts';

export type Level = 'error' | 'warn';

export interface Issue {
  level: Level;
  locale: string;
  ns: string;
  key: string;
  message: string;
}

/** locale -> namespace -> parsed JSON. */
export type Catalog = Record<string, Record<string, unknown>>;

export const SOURCE_LOCALE = 'en';

/** Share of untranslated (identical to en) strings above which a warning is raised. */
export const UNTRANSLATED_WARN_RATIO = 0.05;

/** Keys that legitimately equal the English value in every locale. */
const SAME_AS_EN_OK = new Set<string>(['legal:contact.email']);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Paths of object keys that occur twice in the same JSON object. `JSON.parse` silently keeps
 * the last one, which hides copy (two `"host": {...}` blocks, the first lost).
 */
export function findDuplicateKeys(text: string): string[] {
  const dups: string[] = [];
  let i = 0;
  const ws = (): void => {
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
  };
  const str = (): string => {
    const start = i++;
    while (i < text.length && text.charAt(i) !== '"') i += text.charAt(i) === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (path: string): void => {
    ws();
    const c = text.charAt(i);
    if (c === '{') {
      i++;
      const seen = new Set<string>();
      ws();
      while (text.charAt(i) !== '}' && i < text.length) {
        ws();
        const key = str();
        const here = path ? `${path}.${key}` : key;
        if (seen.has(key)) dups.push(here);
        seen.add(key);
        ws();
        i++; // ':'
        value(here);
        ws();
        if (text.charAt(i) === ',') i++;
        ws();
      }
      i++;
    } else if (c === '[') {
      i++;
      ws();
      while (text.charAt(i) !== ']' && i < text.length) {
        value(path);
        ws();
        if (text.charAt(i) === ',') i++;
        ws();
      }
      i++;
    } else if (c === '"') {
      str();
    } else {
      while (i < text.length && !/[,}\]\s]/.test(text.charAt(i))) i++;
    }
  };
  value('');
  return dups;
}

export function loadCatalog(localesDir: string): Catalog {
  const catalog: Catalog = {};
  for (const locale of readdirSync(localesDir).sort()) {
    const dir = join(localesDir, locale);
    if (!statSync(dir).isDirectory()) continue;
    const namespaces: Record<string, unknown> = {};
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.json')) continue;
      const path = join(dir, file);
      try {
        const text = readFileSync(path, 'utf8');
        const dups = findDuplicateKeys(text);
        if (dups.length) throw new Error(`duplicate key${dups.length > 1 ? 's' : ''}: ${dups.join(', ')} (JSON keeps only the last)`);
        namespaces[file.slice(0, -'.json'.length)] = JSON.parse(text);
      } catch (e) {
        namespaces[file.slice(0, -'.json'.length)] = { __parseError: String(e) };
      }
    }
    catalog[locale] = namespaces;
  }
  return catalog;
}

/** Flattens nested JSON to `dotted.key -> string`; non-string leaves are reported via `onBad`. */
export function flatten(
  value: unknown,
  onBad: (key: string, why: string) => void,
  prefix = '',
  out: Map<string, string> = new Map(),
): Map<string, string> {
  if (typeof value === 'string') {
    out.set(prefix, value);
  } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.includes('.') || k.includes(':')) onBad(prefix ? `${prefix}.${k}` : k, 'key must not contain "." or ":"');
      flatten(v, onBad, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    onBad(prefix, `value must be a string or an object, got ${Array.isArray(value) ? 'array' : typeof value}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ICU message analysis
// ---------------------------------------------------------------------------

export interface MessageInfo {
  /** Argument name -> kinds seen ("argument", "number", "plural", ...). */
  args: Map<string, Set<string>>;
  plurals: { arg: string; ordinal: boolean; categories: string[] }[];
  selects: { arg: string; options: string[] }[];
  hasTags: boolean;
}

const KIND_NAMES: Record<number, string> = {
  [TYPE.argument]: 'argument',
  [TYPE.number]: 'number',
  [TYPE.date]: 'date',
  [TYPE.time]: 'time',
  [TYPE.select]: 'select',
  [TYPE.plural]: 'plural',
};

export function analyzeMessage(message: string): MessageInfo {
  const info: MessageInfo = { args: new Map(), plurals: [], selects: [], hasTags: false };
  const add = (name: string, kind: string): void => {
    const set = info.args.get(name) ?? new Set<string>();
    set.add(kind);
    info.args.set(name, set);
  };
  const walk = (elements: MessageFormatElement[]): void => {
    for (const el of elements) {
      switch (el.type) {
        case TYPE.argument:
        case TYPE.number:
        case TYPE.date:
        case TYPE.time:
          add(el.value, KIND_NAMES[el.type] ?? 'argument');
          break;
        case TYPE.select:
          add(el.value, 'select');
          info.selects.push({ arg: el.value, options: Object.keys(el.options).sort() });
          for (const opt of Object.values(el.options)) walk(opt.value);
          break;
        case TYPE.plural:
          add(el.value, 'plural');
          info.plurals.push({
            arg: el.value,
            ordinal: el.pluralType === 'ordinal',
            categories: Object.keys(el.options),
          });
          for (const opt of Object.values(el.options)) walk(opt.value);
          break;
        case TYPE.tag:
          info.hasTags = true;
          walk(el.children);
          break;
        default:
          break;
      }
    }
  };
  walk(parse(message));
  return info;
}

/** CLDR plural categories `Intl.PluralRules` reports for a locale. */
export function requiredPluralCategories(locale: string, ordinal = false): string[] {
  return new Intl.PluralRules(locale, { type: ordinal ? 'ordinal' : 'cardinal' })
    .resolvedOptions()
    .pluralCategories.slice()
    .sort();
}

const sameSet = (a: Iterable<string>, b: Iterable<string>): boolean => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

// ---------------------------------------------------------------------------
// Domain coverage (reads packages/domain/src/types.ts as text)
// ---------------------------------------------------------------------------

function unionMembers(src: string, typeName: string): string[] {
  // Doc comments inside a union may contain ';' (e.g. Phase15NotificationKind); drop them first.
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = new RegExp(`export type ${typeName}\\s*=([^;]+);`).exec(src);
  if (!m) throw new Error(`type ${typeName} not found in domain types`);
  return [...(m[1] ?? '').matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1] ?? '');
}

function constArrayMembers(src: string, constName: string): string[] {
  const m = new RegExp(`export const ${constName}\\s*=\\s*\\[([^\\]]+)\\]`).exec(src);
  if (!m) throw new Error(`const ${constName} not found in domain types`);
  return [...(m[1] ?? '').matchAll(/'([A-Za-z0-9_-]+)'/g)].map((x) => x[1] ?? '');
}

function blockOf(src: string, startMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`${startMarker} not found in domain types`);
  const end = src.indexOf('} as const', start);
  return src.slice(start, end);
}

export interface DomainSets {
  locales: string[];
  sports: string[];
  positions: string[];
  attributeKeys: string[];
  attributeValues: string[];
  errorCodes: string[];
  notificationKinds: string[];
  sanctionReasons: string[];
  sanctionKinds: string[];
  checkInRejectReasons: string[];
  moderationCategories: string[];
  userReportCategories: string[];
  venueReportReasons: string[];
  reliabilityStatuses: string[];
}

export function readDomainSets(typesPath: string): DomainSets {
  const src = readFileSync(typesPath, 'utf8');
  const positionsBlock = blockOf(src, 'export const SPORT_POSITIONS');
  const attrBlock = blockOf(src, 'export const VENUE_RATING_ATTRIBUTES');
  const uniq = (xs: string[]): string[] => [...new Set(xs)];
  return {
    locales: constArrayMembers(src, 'LOCALES'),
    sports: constArrayMembers(src, 'SPORT_IDS'),
    positions: uniq([...positionsBlock.matchAll(/'([a-z_]+)'/g)].map((x) => x[1] ?? '')),
    attributeKeys: uniq([...attrBlock.matchAll(/^ {4}([a-z_]+):/gm)].map((x) => x[1] ?? '')),
    attributeValues: uniq([...attrBlock.matchAll(/'([a-z_]+)'/g)].map((x) => x[1] ?? '')).filter((v) => v !== 'score'),
    errorCodes: unionMembers(src, 'ErrorCode'),
    // Phase 1.5 kinds share the `notifications:<kind>.title|body` keys (contract v3).
    notificationKinds: [...unionMembers(src, 'NotificationKind'), ...(src.includes('export type Phase15NotificationKind') ? unionMembers(src, 'Phase15NotificationKind') : [])],
    sanctionReasons: unionMembers(src, 'SanctionReasonCode'),
    sanctionKinds: unionMembers(src, 'SanctionKind'),
    checkInRejectReasons: unionMembers(src, 'CheckInRejectReason'),
    moderationCategories: unionMembers(src, 'ModerationCategory'),
    userReportCategories: unionMembers(src, 'UserReportCategory'),
    venueReportReasons: unionMembers(src, 'VenueReportReason'),
    reliabilityStatuses: unionMembers(src, 'ReliabilityStatus'),
  };
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /** Path to packages/domain/src/types.ts; domain coverage is skipped when absent. */
  domainTypesPath?: string | undefined;
  /** Locales that must exist (defaults to the domain LOCALES when the types file is given). */
  expectedLocales?: readonly string[] | undefined;
}

export function validateCatalog(catalog: Catalog, options: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const push = (level: Level, locale: string, ns: string, key: string, message: string): void => {
    issues.push({ level, locale, ns, key, message });
  };

  const source = catalog[SOURCE_LOCALE];
  if (!source) {
    push('error', SOURCE_LOCALE, '*', '*', 'source locale folder is missing');
    return issues;
  }

  // Flatten everything once.
  const flat: Record<string, Record<string, Map<string, string>>> = {};
  for (const [locale, namespaces] of Object.entries(catalog)) {
    const perLocale: Record<string, Map<string, string>> = {};
    for (const [ns, json] of Object.entries(namespaces)) {
      const parseError = (json as { __parseError?: string } | null)?.__parseError;
      if (parseError) {
        push('error', locale, ns, '*', `invalid JSON: ${parseError}`);
        perLocale[ns] = new Map();
        continue;
      }
      perLocale[ns] = flatten(json, (key, why) => push('error', locale, ns, key, why));
    }
    flat[locale] = perLocale;
  }

  // Expected locales.
  let domain: DomainSets | undefined;
  if (options.domainTypesPath && existsSync(options.domainTypesPath)) domain = readDomainSets(options.domainTypesPath);
  const expected = options.expectedLocales ?? domain?.locales;
  if (expected) {
    for (const l of expected) if (!catalog[l]) push('error', l, '*', '*', 'locale folder is missing');
    for (const l of Object.keys(catalog)) {
      if (!expected.includes(l)) push('error', l, '*', '*', 'locale folder is not in the supported LOCALES list');
    }
  }

  const enFlat = flat[SOURCE_LOCALE] ?? {};
  const enInfo = new Map<string, MessageInfo>(); // "ns:key" -> info (source messages that parse)

  // Source messages first.
  for (const [ns, map] of Object.entries(enFlat)) {
    for (const [key, value] of map) {
      checkText(SOURCE_LOCALE, ns, key, value, push);
      try {
        const info = analyzeMessage(value);
        if (info.hasTags) push('error', SOURCE_LOCALE, ns, key, 'rich-text tags (<b>...) are not supported');
        enInfo.set(`${ns}:${key}`, info);
        checkPlurals(SOURCE_LOCALE, ns, key, info, push);
      } catch (e) {
        push('error', SOURCE_LOCALE, ns, key, `ICU parse error: ${errMsg(e)}`);
      }
    }
  }

  // Other locales against en.
  for (const [locale, perLocale] of Object.entries(flat)) {
    if (locale === SOURCE_LOCALE) continue;
    let comparable = 0;
    let untranslated = 0;
    for (const ns of new Set([...Object.keys(enFlat), ...Object.keys(perLocale)])) {
      const en = enFlat[ns];
      const loc = perLocale[ns];
      if (!en) {
        push('error', locale, ns, '*', 'namespace file does not exist in en');
        continue;
      }
      if (!loc) {
        push('error', locale, ns, '*', 'namespace file is missing');
        continue;
      }
      for (const key of en.keys()) if (!loc.has(key)) push('error', locale, ns, key, 'missing key');
      for (const key of loc.keys()) if (!en.has(key)) push('error', locale, ns, key, 'extra key (not in en)');

      for (const [key, value] of loc) {
        const enValue = en.get(key);
        if (enValue === undefined) continue;
        checkText(locale, ns, key, value, push);
        let info: MessageInfo;
        try {
          info = analyzeMessage(value);
        } catch (e) {
          push('error', locale, ns, key, `ICU parse error: ${errMsg(e)}`);
          continue;
        }
        if (info.hasTags) push('error', locale, ns, key, 'rich-text tags (<b>...) are not supported');
        const src = enInfo.get(`${ns}:${key}`);
        if (src) {
          const want = [...src.args.keys()];
          const got = [...info.args.keys()];
          if (!sameSet(want, got)) {
            const missing = want.filter((a) => !got.includes(a));
            const extra = got.filter((a) => !want.includes(a));
            push(
              'error',
              locale,
              ns,
              key,
              `placeholders differ from en${missing.length ? `; missing {${missing.join('}, {')}}` : ''}${extra.length ? `; unexpected {${extra.join('}, {')}}` : ''}`,
            );
          }
          for (const sel of src.selects) {
            const mine = info.selects.find((s) => s.arg === sel.arg);
            if (!mine) push('error', locale, ns, key, `select on {${sel.arg}} is missing`);
            else if (!sameSet(sel.options, mine.options)) {
              push('error', locale, ns, key, `select options for {${sel.arg}} differ from en (${sel.options.join(', ')})`);
            }
          }
        }
        checkPlurals(locale, ns, key, info, push);

        if (!SAME_AS_EN_OK.has(`${ns}:${key}`) && hasEnoughLetters(enValue)) {
          comparable++;
          if (value === enValue) untranslated++;
        }
      }
    }
    if (comparable > 0 && untranslated / comparable > UNTRANSLATED_WARN_RATIO) {
      push(
        'warn',
        locale,
        '*',
        '*',
        `${untranslated} of ${comparable} strings (${Math.round((100 * untranslated) / comparable)}%) are identical to en`,
      );
    }
  }

  if (domain) checkDomainCoverage(enFlat, domain, push);
  return issues;
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? 'unknown';
}

/** Strings with at least 4 letters count as "real text" for the untranslated check. */
function hasEnoughLetters(s: string): boolean {
  const withoutArgs = s.replace(/\{[^{}]*\}/g, '');
  return (withoutArgs.match(/\p{L}/gu) ?? []).length >= 4;
}

type Push = (level: Level, locale: string, ns: string, key: string, message: string) => void;

function checkText(locale: string, ns: string, key: string, value: string, push: Push): void {
  if (value.trim() === '') push('error', locale, ns, key, 'empty string');
  else if (value !== value.trim()) push('error', locale, ns, key, 'leading or trailing whitespace');
  if (/\p{Cc}/u.test(value.replace(/[\t]/g, ''))) push('error', locale, ns, key, 'contains control characters');
  if (/[‪-‮⁦-⁩]/.test(value)) {
    push('error', locale, ns, key, 'contains bidi control characters (the app isolates values at runtime)');
  }
}

function checkPlurals(locale: string, ns: string, key: string, info: MessageInfo, push: Push): void {
  for (const p of info.plurals) {
    const required = requiredPluralCategories(locale, p.ordinal);
    const named = p.categories.filter((c) => !c.startsWith('='));
    const missing = required.filter((c) => !named.includes(c));
    const extra = named.filter((c) => !required.includes(c));
    if (missing.length) {
      push('error', locale, ns, key, `plural on {${p.arg}} lacks CLDR categories: ${missing.join(', ')} (needs ${required.join('/')})`);
    }
    if (extra.length) {
      push('error', locale, ns, key, `plural on {${p.arg}} has categories ${locale} never uses: ${extra.join(', ')}`);
    }
  }
}

function checkDomainCoverage(enFlat: Record<string, Map<string, string>>, d: DomainSets, push: Push): void {
  const expectKeys = (
    ns: string,
    prefix: string,
    ids: readonly string[],
    suffixes: readonly string[] = [''],
    exact = false,
  ): void => {
    const map = enFlat[ns];
    if (!map) {
      push('error', SOURCE_LOCALE, ns, '*', 'namespace is missing');
      return;
    }
    const want = new Set<string>();
    for (const id of ids) for (const s of suffixes) want.add(`${prefix}${id}${s}`);
    for (const k of want) if (!map.has(k)) push('error', SOURCE_LOCALE, ns, k, 'no copy for a domain value (see packages/domain/src/types.ts)');
    // Reverse (pure enum groups only): keys with no matching domain value.
    if (exact) {
      for (const k of map.keys()) {
        if (k.startsWith(prefix) && !want.has(k)) {
          push('error', SOURCE_LOCALE, ns, k, 'key has no matching domain value');
        }
      }
    }
  };

  expectKeys('errors', '', d.errorCodes, [''], true);
  expectKeys('notifications', '', d.notificationKinds, ['.title', '.body'], true);
  expectKeys('trust', 'sanctions.reason.', d.sanctionReasons, [''], true);
  expectKeys('trust', 'sanctions.fix.', d.sanctionReasons);
  expectKeys('trust', 'sanctions.rule.', d.sanctionReasons, [''], true);
  expectKeys('trust', 'sanctions.kind.', d.sanctionKinds, ['.name', '.effect', '.stillAllowed']);
  expectKeys('common', 'sports.', d.sports, [''], true);
  expectKeys('common', 'positions.', d.positions, [''], true);
  expectKeys('common', 'positionsShort.', d.positions, [''], true);
  expectKeys('common', 'reliability.status.', d.reliabilityStatuses, [''], true);
  expectKeys('games', 'venue.attribute.', d.attributeKeys, [''], true);
  expectKeys('games', 'venue.attributeValue.', d.attributeValues, [''], true);
  expectKeys('games', 'venue.report.reason.', d.venueReportReasons, [''], true);
  expectKeys('checkin', 'reject.', d.checkInRejectReasons, [''], true);
  expectKeys('chat', 'moderation.nudge.', d.moderationCategories);
  expectKeys('chat', 'moderation.block.', d.moderationCategories);
  expectKeys('chat', 'report.category.', d.userReportCategories, [''], true);
  expectKeys('profile', 'report.category.', d.userReportCategories, [''], true);

  // Parameter contracts for server-rendered copy.
  const paramCheck = (ns: string, label: string, keys: string[], declared: readonly string[]): void => {
    const used = new Set<string>();
    for (const k of keys) {
      const msg = enFlat[ns]?.get(k);
      if (msg === undefined) continue;
      try {
        for (const a of analyzeMessage(msg).args.keys()) used.add(a);
      } catch {
        /* already reported */
      }
    }
    if (!sameSet(used, declared)) {
      push(
        'error',
        SOURCE_LOCALE,
        ns,
        label,
        `parameters used by the copy (${[...used].sort().join(', ') || 'none'}) differ from the contract in src/params.ts (${[...declared].sort().join(', ') || 'none'})`,
      );
    }
  };
  for (const code of d.sanctionReasons) {
    const declared = (STATEMENT_PARAMS as Record<string, readonly string[]>)[code];
    if (!declared) {
      push('error', SOURCE_LOCALE, 'trust', `sanctions.reason.${code}`, 'missing from STATEMENT_PARAMS in src/params.ts');
      continue;
    }
    paramCheck('trust', `sanctions.reason.${code}`, [`sanctions.reason.${code}`, `sanctions.fix.${code}`], declared);
  }
  for (const kind of d.notificationKinds) {
    const declared = ({ ...NOTIFICATION_PARAMS, ...PHASE15_NOTIFICATION_PARAMS } as Record<string, readonly string[]>)[kind];
    if (!declared) {
      push('error', SOURCE_LOCALE, 'notifications', kind, 'missing from NOTIFICATION_PARAMS in src/params.ts');
      continue;
    }
    paramCheck('notifications', `${kind}.*`, [`${kind}.title`, `${kind}.body`], declared);
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function formatReport(issues: readonly Issue[]): string {
  if (issues.length === 0) return 'i18n check: OK (0 errors, 0 warnings)';
  const lines: string[] = [];
  const byLocale = new Map<string, Issue[]>();
  for (const i of issues) byLocale.set(i.locale, [...(byLocale.get(i.locale) ?? []), i]);
  for (const [locale, list] of [...byLocale.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`\n${locale}`);
    for (const i of list) {
      const where = i.ns === '*' ? '' : i.key === '*' ? `${i.ns}` : `${i.ns}:${i.key}`;
      lines.push(`  ${i.level === 'error' ? 'ERROR' : 'warn '} ${where ? where + '  ' : ''}${i.message}`);
    }
  }
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.length - errors;
  lines.push(`\ni18n check: ${errors} error${errors === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}`);
  return lines.join('\n');
}
