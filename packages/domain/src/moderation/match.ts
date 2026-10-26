import type { Locale } from '../types';
import { SEED_BLOCKLISTS } from './blocklists';
import { normalizeTokens } from './normalize';

export interface BlocklistMatch {
  matched: boolean;
  /** Matched list terms as written in the list, deduplicated, in list order. */
  terms: string[];
}

/** A compiled term: its normalised tokens, and whether it matches as a substring. */
interface CompiledTerm {
  term: string;
  tokens: string[];
  substring: boolean;
}

function hasCjk(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff)) return true;
  }
  return false;
}

const cache = new Map<string, CompiledTerm[]>();

function compile(terms: readonly string[]): CompiledTerm[] {
  const key = terms.join('\u0000');
  const hit = cache.get(key);
  if (hit) return hit;
  const compiled = terms
    .map((term) => {
      const tokens = normalizeTokens(term, false);
      return { term, tokens, substring: hasCjk(term) };
    })
    .filter((t) => t.tokens.length > 0);
  cache.set(key, compiled);
  return compiled;
}

/** Adds candidates formed by joining runs of ≥ 3 single-character tokens ("i d i o t"). */
function withJoinedRuns(tokens: readonly string[]): string[][] {
  const variants: string[][] = [tokens.slice()];
  const joined: string[] = [];
  let run = '';
  for (const t of tokens) {
    if ([...t].length === 1) {
      run += t;
      continue;
    }
    if ([...run].length >= 3) joined.push(run);
    run = '';
  }
  if ([...run].length >= 3) joined.push(run);
  if (joined.length > 0) variants.push(joined.map((j) => j.replace(/(.)\1+/gu, '$1')));
  return variants;
}

function containsSequence(hay: readonly string[], needle: readonly string[]): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Matches `text` against an explicit term list (whole-token sequences; CJK terms as substrings). */
export function matchTerms(text: string, terms: readonly string[]): BlocklistMatch {
  const plain = normalizeTokens(text, false);
  const leet = normalizeTokens(text, true);
  const variants = [...withJoinedRuns(plain), ...withJoinedRuns(leet)];
  const compacts = [plain.join(''), leet.join('')];
  const found: string[] = [];
  for (const t of compile(terms)) {
    const hit = t.substring
      ? compacts.some((c) => c.includes(t.tokens.join('')))
      : variants.some((v) => containsSequence(v, t.tokens));
    if (hit && !found.includes(t.term)) found.push(t.term);
  }
  return { matched: found.length > 0, terms: found };
}

/**
 * Client-side blocklist check for instant feedback: the locale's seed list plus
 * English. Not a trust decision; the server pipeline decides.
 */
export function matchBlocklist(text: string, locale: Locale): BlocklistMatch {
  const terms = locale === 'en' ? SEED_BLOCKLISTS.en : [...SEED_BLOCKLISTS[locale], ...SEED_BLOCKLISTS.en];
  return matchTerms(text, terms);
}
