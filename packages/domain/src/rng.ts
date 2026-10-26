/**
 * Seeded pseudo-random numbers. The domain package never uses `Math.random()`:
 * every random choice is reproducible from a 32-bit seed.
 */

/** A generator of floats in `[0, 1)`. */
export type Rng = () => number;

/**
 * mulberry32: a tiny, fast 32-bit PRNG with good statistical quality for
 * shuffles and simulated annealing (not for cryptography).
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in `[0, maxExclusive)` drawn from `rng`. */
export function randomInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/** Fisher–Yates shuffle returning a new array; the input is not mutated. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** FNV-1a 32-bit hash of a string, handy for deriving a seed from an id (e.g. a game id). */
export function seedFromString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
