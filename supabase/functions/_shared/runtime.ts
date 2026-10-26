/** Clock, timeouts and rate limiting shared by handlers. */

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export type TimedOutcome<T> =
  | { ok: true; value: T; ms: number }
  | { ok: false; reason: 'timeout' | 'error'; error?: unknown; ms: number };

/**
 * Runs `fn` with an AbortSignal and a hard deadline. Never rejects: failures
 * and timeouts are returned as data so callers can degrade (moderation →
 * `pending`, translation → next provider).
 */
export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number, clock: Clock = systemClock): Promise<TimedOutcome<T>> {
  const start = clock.now();
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const winner = await Promise.race([fn(ctrl.signal).then((value) => ({ value })), deadline]);
    if (winner === 'timeout') {
      ctrl.abort();
      return { ok: false, reason: 'timeout', ms: clock.now() - start };
    }
    return { ok: true, value: winner.value, ms: clock.now() - start };
  } catch (error) {
    return { ok: false, reason: 'error', error, ms: clock.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/** Fixed-window rate limiter. Edge isolates are short-lived, so authoritative limits also live in SQL. */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

/** Per-isolate, best-effort limiter (absorbs bursts before they reach the database). */
export class MemoryRateLimiter implements RateLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly clock: Clock = systemClock, private readonly maxKeys = 10_000) {}

  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.clock.now();
    let w = this.#windows.get(key);
    if (!w || now - w.start >= windowMs) {
      if (this.#windows.size >= this.maxKeys) this.#windows.clear();
      w = { start: now, count: 0 };
      this.#windows.set(key, w);
    }
    w.count++;
    const allowed = w.count <= limit;
    return Promise.resolve({ allowed, remaining: Math.max(0, limit - w.count), retryAfterMs: allowed ? 0 : w.start + windowMs - now });
  }
}

/** Reads an env var through an injected getter (Deno.env.get in production). */
export function requireEnv(get: (name: string) => string | undefined, name: string): string {
  const v = get(name);
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}
