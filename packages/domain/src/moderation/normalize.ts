/**
 * Text normalisation for blocklist matching. Applied identically to the text
 * and to every list term, so evasions fold onto the same canonical form:
 * NFKC (full-width → ASCII, compatibility forms) → lower case → leetspeak map →
 * strip Latin diacritics, Hebrew niqqud/cantillation, Arabic tashkeel and
 * tatweel → hiragana folded to katakana → punctuation inside tokens removed →
 * runs of a repeated character collapsed to one.
 * Avoids Unicode property escapes (`\p{…}`) so it runs on every JS engine we ship to.
 */

/** Leetspeak / symbol substitutions applied after lower-casing. */
export const LEET_MAP: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'l',
  '+': 't',
};

function isStrippedMark(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritics (Latin, Cyrillic ё/й, etc.)
    (cp >= 0x0591 && cp <= 0x05c7 && cp !== 0x05be && cp !== 0x05c0 && cp !== 0x05c3 && cp !== 0x05c6) || // Hebrew points
    (cp >= 0x0610 && cp <= 0x061a) ||
    (cp >= 0x064b && cp <= 0x065f) || // Arabic tashkeel
    cp === 0x0670 ||
    (cp >= 0x06d6 && cp <= 0x06ed) ||
    cp === 0x0640 // tatweel
  );
}

/** Characters dropped inside a token (separators used to dodge filters). */
function isPunctuation(cp: number): boolean {
  return (
    (cp >= 0x21 && cp <= 0x2f) ||
    (cp >= 0x3a && cp <= 0x40) ||
    (cp >= 0x5b && cp <= 0x60) ||
    (cp >= 0x7b && cp <= 0x7e) ||
    (cp >= 0x2000 && cp <= 0x206f) || // general punctuation, zero-width chars, bidi marks
    (cp >= 0x3000 && cp <= 0x303f) || // CJK punctuation
    cp === 0x05be || // maqaf
    cp === 0x05f3 ||
    cp === 0x05f4 || // geresh / gershayim
    cp === 0x060c ||
    cp === 0x061b ||
    cp === 0x061f || // Arabic comma, semicolon, question mark
    cp === 0x0964 ||
    cp === 0x0965 || // Devanagari danda
    cp === 0x00a1 ||
    cp === 0x00bf ||
    cp === 0x00ab ||
    cp === 0x00bb ||
    cp === 0xfeff
  );
}

function isSpace(cp: number): boolean {
  return cp === 0x20 || (cp >= 0x09 && cp <= 0x0d) || cp === 0xa0 || cp === 0x3000 || (cp >= 0x2000 && cp <= 0x200a);
}

function nfkc(s: string, form: 'NFKC' | 'NFD' | 'NFC'): string {
  return typeof s.normalize === 'function' ? s.normalize(form) : s;
}

/** Normalises one already-split token: maps, strips and collapses. */
function normalizeToken(token: string): string {
  let out = '';
  let prev = '';
  for (const ch of nfkc(token, 'NFD')) {
    const cp = ch.codePointAt(0) as number;
    if (isStrippedMark(cp) || isPunctuation(cp)) continue;
    let c = ch;
    if (cp >= 0x3041 && cp <= 0x3096) c = String.fromCodePoint(cp + 0x60); // hiragana → katakana
    if (c === prev) continue;
    out += c;
    prev = c;
  }
  return nfkc(out, 'NFC');
}

/**
 * Splits on whitespace, normalises each token, drops empty ones. With `leet`
 * (default) digits/symbols are mapped to letters first (`1d10t` → `idiot`);
 * without it they are treated as punctuation (`stupid!` → `stupid`).
 * The matcher tries both.
 */
export function normalizeTokens(text: string, leet = true): string[] {
  const lowered = nfkc(text, 'NFKC').toLowerCase();
  let mapped = '';
  for (const ch of lowered) mapped += leet ? (LEET_MAP[ch] ?? ch) : ch;
  const tokens: string[] = [];
  let cur = '';
  for (const ch of mapped) {
    if (isSpace(ch.codePointAt(0) as number)) {
      if (cur) tokens.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens.map(normalizeToken).filter((t) => t.length > 0);
}

/** Canonical form of a whole text: normalised tokens joined by single spaces. */
export function normalizeForMatch(text: string, leet = true): string {
  return normalizeTokens(text, leet).join(' ');
}
