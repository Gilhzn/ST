import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_CHARS, sanitizeMessage, sanitizeText, spamFingerprint } from '#shared/text';

describe('sanitizeText', () => {
  it('strips bidi overrides, embeddings, isolates and marks (Trojan Source)', () => {
    const evil = 'pay \u202Eecnetsixe\u202C now \u2066x\u2069 \u200F\u200E\u061C';
    const r = sanitizeText(evil);
    expect(r.text).toBe('pay ecnetsixe now x');
    expect(r.removed).toBe(7);
  });
  it('keeps Hebrew/Arabic text, emoji ZWJ sequences and ZWNJ', () => {
    const t = 'שלום عالم 👨\u200D👩\u200D👧 می\u200Cخواهم';
    expect(sanitizeText(t).text).toBe(t);
  });
  it('normalises to NFC, removes control and invisible characters, tidies whitespace', () => {
    expect(sanitizeText('é').text).toBe('é');
    expect(sanitizeText('a\u0000b\u200Bc\uFEFF\u00AD').text).toBe('abc');
    expect(sanitizeText('  hi \r\n\n\n\nthere  ').text).toBe('hi\n\nthere');
  });
});

describe('sanitizeMessage', () => {
  it('rejects empty, non-string and over-long input', () => {
    expect(() => sanitizeMessage('\u202E\u202C   ')).toThrow(/empty/);
    expect(() => sanitizeMessage(42)).toThrow(/string/);
    expect(() => sanitizeMessage('x'.repeat(MAX_MESSAGE_CHARS + 1))).toThrow(/too long/);
    expect(sanitizeMessage('😀'.repeat(MAX_MESSAGE_CHARS)).text).toHaveLength(MAX_MESSAGE_CHARS * 2); // code points, not UTF-16 units
  });
  it('fingerprints ignore case and spacing', () => {
    expect(spamFingerprint(' Join  NOW ')).toBe(spamFingerprint('join now'));
  });
});
