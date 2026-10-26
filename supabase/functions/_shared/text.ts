/**
 * User-text sanitisation for chat (CHAT-022, CHAT-033).
 *
 * Bidi control characters are stripped server side: they enable "Trojan
 * Source"-style spoofing (reordering text so it reads differently than it is
 * stored and moderated). The client already isolates every message with
 * FSI…PDI, so legitimate Hebrew/Arabic text never needs embedded controls.
 * ZWJ/ZWNJ are kept: they are required for emoji sequences and for Persian,
 * Hindi and other scripts.
 */
import { StError } from '@st/domain';

/** U+061C ALM, U+200E/F LRM/RLM, U+202A–U+202E embeddings/overrides, U+2066–U+2069 isolates. */
export const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;
/** Invisible characters with no legitimate chat use: ZWSP, word joiner, BOM, invisible operators, soft hyphen. */
const INVISIBLES = /[­​⁠-⁤﻿]/g;
/** C0/C1 controls except TAB and LF. */
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

export const MAX_MESSAGE_CHARS = 1000;

export interface SanitizedText {
  text: string;
  /** Number of characters removed (bidi controls, invisibles, control chars). */
  removed: number;
}

/** Strips bidi and control characters, normalises to NFC and tidies whitespace. Does not validate length. */
export function sanitizeText(input: string): SanitizedText {
  const nfc = input.normalize('NFC').replace(/\r\n?/g, '\n');
  const stripped = nfc.replace(BIDI_CONTROLS, '').replace(INVISIBLES, '').replace(CONTROLS, '');
  const text = stripped
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, removed: [...nfc].length - [...stripped].length };
}

/** Sanitises and enforces 1..{@link MAX_MESSAGE_CHARS} code points. Throws `StError('validation')`. */
export function sanitizeMessage(input: unknown, maxChars = MAX_MESSAGE_CHARS): SanitizedText {
  if (typeof input !== 'string') throw new StError('validation', 'body must be a string', { field: 'body' });
  if (input.length > maxChars * 4) throw new StError('validation', 'message too long', { field: 'body', maxChars });
  const out = sanitizeText(input);
  const length = [...out.text].length;
  if (length === 0) throw new StError('validation', 'message is empty', { field: 'body' });
  if (length > maxChars) throw new StError('validation', 'message too long', { field: 'body', maxChars });
  return out;
}

/** Stable fingerprint for duplicate detection (case/space-insensitive). Not a security hash. */
export function spamFingerprint(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}
