/**
 * Permanent guard: every translation key the app uses literally must exist in the English
 * catalog. Scans apps/mobile-web/src for
 *  - `t('ns:key')` calls and `t(\`ns:a.${x}.b\`)` templates (the dynamic part is a wildcard that
 *    must match at least one en key), and
 *  - any other string literal shaped like `ns:dotted.key` with a known namespace (keys kept in
 *    constants or data tables).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NAMESPACES, sourceResources } from '../src/resources';

const here = dirname(fileURLToPath(import.meta.url));
const appSrc = join(here, '..', '..', '..', 'apps', 'mobile-web', 'src');

function flatKeys(): Set<string> {
  const out = new Set<string>();
  const walk = (o: unknown, prefix: string): void => {
    if (typeof o === 'string') out.add(prefix);
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${prefix}.${k}`);
  };
  for (const ns of NAMESPACES) walk(sourceResources[ns], ns);
  // `ns.key` -> `ns:key`
  return new Set([...out].map((k) => k.replace('.', ':')));
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) files.push(path);
  }
  return files;
}

const NS = NAMESPACES.join('|');
const KEY_LITERAL = new RegExp(`(['"\`])((?:${NS}):[A-Za-z0-9_.$\\{\\}\\s\\[\\]?.()'"-]*?)\\1`, 'g');
const SIMPLE_KEY = new RegExp(`^(?:${NS}):[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*$`);
const TEMPLATE_KEY = new RegExp(`^(?:${NS}):[A-Za-z0-9_.]*(?:\\$\\{[^}]*\\}[A-Za-z0-9_.]*)+$`);

describe('keys used by apps/mobile-web exist in en', () => {
  const keys = flatKeys();
  const missing: string[] = [];
  const unmatched: string[] = [];
  let checked = 0;

  for (const file of sourceFiles(appSrc)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(appSrc, file);
    for (const m of text.matchAll(KEY_LITERAL)) {
      const key = m[2] ?? '';
      if (SIMPLE_KEY.test(key)) {
        checked++;
        if (!keys.has(key)) missing.push(`${rel}: ${key}`);
      } else if (TEMPLATE_KEY.test(key)) {
        checked++;
        const pattern = new RegExp(
          '^' + key.replace(/[.*+?^()|[\]\\]/g, '\\$&').replace(/\$\{[^}]*\}/g, '[A-Za-z0-9_.]+').replace(/\{/g, '\\{') + '$',
        );
        if (![...keys].some((k) => pattern.test(k))) unmatched.push(`${rel}: ${key}`);
      }
    }
  }

  it('scans a meaningful number of keys', () => {
    expect(checked).toBeGreaterThan(100);
  });

  it('has no literal key missing from locales/en', () => {
    expect(missing).toEqual([]);
  });

  it('has no dynamic key pattern that matches nothing in locales/en', () => {
    expect(unmatched).toEqual([]);
  });
});
