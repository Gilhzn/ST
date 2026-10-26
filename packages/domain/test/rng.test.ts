import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mulberry32, randomInt, seedFromString, shuffle } from '../src';

describe('mulberry32', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('known first outputs (regression pin)', () => {
    const r = mulberry32(0);
    expect([r(), r()].map((x) => Math.round(x * 1e9))).toMatchInlineSnapshot(`
      [
        266429209,
        329746,
      ]
    `);
  });
  it('randomInt stays in range', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const n = randomInt(r, 5);
      expect(Number.isInteger(n) && n >= 0 && n < 5).toBe(true);
    }
  });
});

describe('shuffle', () => {
  it('returns a permutation and does not mutate the input', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.integer(), (arr, seed) => {
        const copy = arr.slice();
        const out = shuffle(arr, mulberry32(seed));
        expect(arr).toEqual(copy);
        expect(out.slice().sort((a, b) => a - b)).toEqual(copy.sort((a, b) => a - b));
      }),
    );
  });
  it('is deterministic per seed', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(items, mulberry32(9))).toEqual(shuffle(items, mulberry32(9)));
  });
});

describe('seedFromString', () => {
  it('is FNV-1a 32-bit', () => {
    expect(seedFromString('')).toBe(0x811c9dc5);
    expect(seedFromString('a')).toBe(0xe40c292c);
    expect(seedFromString('foobar')).toBe(0xbf9cf968);
  });
});
