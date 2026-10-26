/** Test helpers for Edge Function handlers (Node/vitest only; never deployed). */
import type { AuthVerifier } from '#shared/auth';
import { memoryLogger } from '#shared/log';
import type { Clock, RateLimitResult, RateLimiter } from '#shared/runtime';

export const BASE = 'https://fn.test';
export const INTERNAL_SECRET = 'internal-secret-0123456789abcdef';

export function fakeAuth(tokens: Record<string, string>): AuthVerifier {
  return {
    verify: (token) => Promise.resolve(tokens[token] ? { userId: tokens[token] as string, role: 'authenticated', accessToken: token } : null),
  };
}

export function mutableClock(start: number): Clock & { set(ms: number): void; advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    set: (ms) => {
      now = ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

export const allowAll: RateLimiter = { hit: (): Promise<RateLimitResult> => Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 }) };

export function post(path: string, body: unknown, opts: { token?: string; headers?: Record<string, string>; method?: string } = {}): Request {
  return new Request(`${BASE}/${path}`, {
    method: opts.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.method === 'GET' || opts.method === 'OPTIONS' ? null : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export { memoryLogger };

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
