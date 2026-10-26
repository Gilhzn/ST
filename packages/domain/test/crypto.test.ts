import { createHash, createHmac } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  deriveReviewItemId,
  deriveSanctionId,
  fromHex,
  hmacSha256Hex,
  sha256Hex,
  stableUuid,
  toHex,
  utf8Encode,
} from '../src';

describe('sha256 (FIPS 180-4 vectors)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
  ])('sha256(%j)', (msg, hex) => {
    expect(sha256Hex(msg)).toBe(hex);
  });

  it('one million "a"', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('matches node:crypto for arbitrary byte strings (incl. block boundaries)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
      }),
      { numRuns: 300 },
    );
    for (const n of [55, 56, 63, 64, 65, 119, 120, 128]) {
      const bytes = new Uint8Array(n).fill(0x61);
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });
});

describe('HMAC-SHA256 (RFC 4231)', () => {
  const rep = (b: number, n: number) => toHex(new Uint8Array(n).fill(b));
  const cases: [string, string, string, string, number?][] = [
    ['1', rep(0x0b, 20), toHex(utf8Encode('Hi There')), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'],
    ['2', toHex(utf8Encode('Jefe')), toHex(utf8Encode('what do ya want for nothing?')), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'],
    ['3', rep(0xaa, 20), rep(0xdd, 50), '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe'],
    [
      '4',
      '0102030405060708090a0b0c0d0e0f10111213141516171819',
      rep(0xcd, 50),
      '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
    ],
    ['5', rep(0x0c, 20), toHex(utf8Encode('Test With Truncation')), 'a3b6167473100ee06e0c796c2955552b', 32],
    [
      '6',
      rep(0xaa, 131),
      toHex(utf8Encode('Test Using Larger Than Block-Size Key - Hash Key First')),
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    ],
    [
      '7',
      rep(0xaa, 131),
      toHex(
        utf8Encode(
          'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.',
        ),
      ),
      '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
    ],
  ];
  it.each(cases)('test case %s', (_n, key, data, expected, truncate) => {
    const mac = hmacSha256Hex(fromHex(key), fromHex(data));
    expect(truncate ? mac.slice(0, truncate) : mac).toBe(expected);
  });

  it('matches node:crypto for arbitrary keys and messages', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), fc.uint8Array({ maxLength: 200 }), (key, msg) => {
        expect(hmacSha256Hex(key, msg)).toBe(createHmac('sha256', key).update(msg).digest('hex'));
      }),
      { numRuns: 200 },
    );
  });

  it('string inputs are UTF-8 encoded', () => {
    expect(hmacSha256Hex('sëcret', 'ゲーム|1')).toBe(createHmac('sha256', 'sëcret').update('ゲーム|1').digest('hex'));
  });
});

describe('utf8Encode', () => {
  it('matches Buffer for well-formed strings', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (s) => {
        expect(Array.from(utf8Encode(s))).toEqual(Array.from(Buffer.from(s, 'utf8')));
      }),
    );
  });
  it('replaces lone surrogates with U+FFFD like TextEncoder', () => {
    for (const s of ['\ud800', 'a\udc00b', '\ud83d']) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(new TextEncoder().encode(s)));
    }
  });
});

describe('hex helpers and constant-time compare', () => {
  it('round-trips hex', () => {
    fc.assert(
      fc.property(fc.uint8Array(), (b) => {
        expect(Array.from(fromHex(toHex(b)))).toEqual(Array.from(b));
      }),
    );
    expect(Array.from(fromHex('ABff'))).toEqual([0xab, 0xff]);
  });
  it('rejects malformed hex', () => {
    expect(() => fromHex('abc')).toThrow(RangeError);
    expect(() => fromHex('zz')).toThrow(RangeError);
  });
  it('constantTimeEqual', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
  });
});

describe('stableUuid', () => {
  it('is an RFC 9562 v8 UUID derived from SHA-256', () => {
    const id = stableUuid('late_cancel:g1:u1');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const h = createHash('sha256').update('late_cancel:g1:u1').digest();
    h[6] = (h[6]! & 0x0f) | 0x80;
    h[8] = (h[8]! & 0x3f) | 0x80;
    const x = h.subarray(0, 16).toString('hex');
    expect(id).toBe(`${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`);
  });
  it('separates sanction and review namespaces and is deterministic', () => {
    expect(deriveSanctionId('k')).toBe(stableUuid('sanction:k'));
    expect(deriveReviewItemId('k')).toBe(stableUuid('review:k'));
    expect(deriveSanctionId('k')).not.toBe(deriveReviewItemId('k'));
  });
});
