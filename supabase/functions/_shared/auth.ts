/**
 * Caller authentication.
 *
 * - User calls carry the Supabase access token (`Authorization: Bearer <jwt>`).
 *   An injected {@link AuthVerifier} resolves it to a user id; the production
 *   verifier asks GoTrue (`/auth/v1/user`), which also rejects revoked sessions.
 * - Internal calls (pg_cron via `st_dispatch`, database webhooks) carry a
 *   shared secret (service role key or a dedicated `FUNCTIONS_INTERNAL_SECRET`),
 *   compared in constant time.
 */
import { StError, type UserId } from '@st/domain';

export interface AuthedUser {
  userId: UserId;
  /** JWT `role` claim (`authenticated` for app users). */
  role: string;
  /** The raw access token, for calling RLS-scoped RPCs on the user's behalf. Never logged. */
  accessToken: string;
}

export interface AuthVerifier {
  /** Returns the user for a valid, unexpired token, else `null`. Never throws for bad tokens. */
  verify(accessToken: string): Promise<AuthedUser | null>;
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization');
  const m = h ? /^Bearer\s+(\S+)$/i.exec(h.trim()) : null;
  return m ? (m[1] as string) : null;
}

/** Requires an authenticated app user. Throws `StError('unauthenticated')`. */
export async function requireUser(req: Request, verifier: AuthVerifier): Promise<AuthedUser> {
  const token = bearerToken(req);
  if (!token) throw new StError('unauthenticated');
  const user = await verifier.verify(token);
  if (!user || user.role !== 'authenticated') throw new StError('unauthenticated');
  return user;
}

/** Constant-time string equality. */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Requires an internal caller (cron / DB webhook). Throws `StError('unauthenticated')`. */
export function requireInternalCaller(req: Request, secrets: readonly string[]): void {
  const token = bearerToken(req);
  const valid = secrets.filter((s) => s.length >= 16);
  if (!token || valid.length === 0 || !valid.some((s) => safeEqual(token, s))) throw new StError('unauthenticated');
}

/** Production verifier: GoTrue `GET /auth/v1/user`. */
export function createGoTrueVerifier(options: { url: string; anonKey: string; fetch?: typeof fetch; timeoutMs?: number }): AuthVerifier {
  const doFetch = options.fetch ?? fetch;
  const base = options.url.replace(/\/+$/, '');
  return {
    async verify(accessToken) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 3000);
      try {
        const res = await doFetch(`${base}/auth/v1/user`, {
          headers: { apikey: options.anonKey, authorization: `Bearer ${accessToken}` },
          signal: ctrl.signal,
        });
        if (res.status === 401 || res.status === 403) return null;
        if (!res.ok) throw new StError('unavailable', 'auth service unavailable');
        const body = (await res.json()) as { id?: unknown; role?: unknown };
        if (typeof body.id !== 'string') return null;
        return { userId: body.id, role: typeof body.role === 'string' ? body.role : 'authenticated', accessToken };
      } catch (e) {
        if (e instanceof StError) throw e;
        throw new StError('unavailable', 'auth service unreachable');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
