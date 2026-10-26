/**
 * Bidirectional-text helpers (pure; no react-native import).
 *
 * Rule: any user-generated or interpolated string (names, chat messages, venue names,
 * phone numbers) shown inside UI text is wrapped in an isolate so it cannot reorder the
 * surrounding sentence. FSI (U+2068) picks direction from the first strong character;
 * LRI/RLI force it. Every isolate is closed by PDI (U+2069).
 */

export const FSI = "⁨";
export const LRI = "⁦";
export const RLI = "⁧";
export const PDI = "⁩";

export type TextDirection = "ltr" | "rtl";
export type IsolateDirection = "auto" | TextDirection;

/**
 * Explicit embedding/override/isolate controls. Overrides (LRO/RLO) in user content can
 * be abused to spoof text ("Trojan Source"), so we strip them before isolating.
 * U+202A LRE, U+202B RLE, U+202C PDF, U+202D LRO, U+202E RLO, U+2066–U+2069 isolates.
 */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;

export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, "");
}

/** Wraps `text` in a directional isolate. Safe to nest inside any sentence. */
export function isolate(text: string, dir: IsolateDirection = "auto"): string {
  const open = dir === "ltr" ? LRI : dir === "rtl" ? RLI : FSI;
  return `${open}${stripBidiControls(text)}${PDI}`;
}

/** Isolates every value of an i18n interpolation map (numbers become LTR isolates). */
export function isolateValues<T extends Record<string, unknown>>(values: T): Record<keyof T, unknown> {
  const out = {} as Record<keyof T, unknown>;
  for (const k of Object.keys(values) as (keyof T)[]) {
    const v = values[k];
    if (typeof v === "string") out[k] = isolate(v);
    else if (typeof v === "number") out[k] = isolate(String(v), "ltr");
    else out[k] = v;
  }
  return out;
}

function isStrongRtl(cp: number): boolean {
  return (
    (cp >= 0x0590 && cp <= 0x08ff) || // Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Arabic ext.
    (cp >= 0xfb1d && cp <= 0xfdff) || // Hebrew + Arabic presentation forms A
    (cp >= 0xfe70 && cp <= 0xfeff) || // Arabic presentation forms B
    (cp >= 0x10800 && cp <= 0x10fff) || // Historic RTL scripts
    (cp >= 0x1e800 && cp <= 0x1efff)
  );
}

function isStrongLtr(ch: string): boolean {
  // Any letter that is not RTL counts as strong LTR (Latin, Cyrillic, CJK, Devanagari…).
  return /\p{L}/u.test(ch);
}

/**
 * First-strong-character direction (Unicode P2/P3), skipping isolated runs.
 * Returns `fallback` when the text has no strong characters (e.g. "12:30", "👍").
 */
export function detectDirection(text: string, fallback: TextDirection = "ltr"): TextDirection {
  let depth = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x2066 || cp === 0x2067 || cp === 0x2068) {
      depth++;
      continue;
    }
    if (cp === 0x2069) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    if (isStrongRtl(cp)) return "rtl";
    if (isStrongLtr(ch)) return "ltr";
  }
  return fallback;
}

/** True when the string contains at least one strong RTL character. */
export function containsRtl(text: string): boolean {
  for (const ch of text) {
    if (isStrongRtl(ch.codePointAt(0) ?? 0)) return true;
  }
  return false;
}

/**
 * Initials for avatars: first grapheme of the first and last word, combining marks kept
 * (Devanagari matras, Arabic harakat). CJK names → first character only.
 */
export function initialsFor(name: string, max = 2): string {
  const clean = stripBidiControls(name).trim();
  if (!clean) return "?";
  const firstGrapheme = (word: string): string => {
    const chars = Array.from(word);
    let out = chars[0] ?? "";
    for (let i = 1; i < chars.length; i++) {
      const c = chars[i] ?? "";
      if (/[\p{M}‍]/u.test(c)) out += c;
      else break;
    }
    return out;
  };
  const first = Array.from(clean)[0] ?? "";
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(first)) {
    return first;
  }
  const words = clean.split(/\s+/u).filter(Boolean);
  const picks = words.length > 1 && max > 1 ? [words[0] ?? "", words[words.length - 1] ?? ""] : [words[0] ?? ""];
  return picks.map(firstGrapheme).join("").toLocaleUpperCase();
}
