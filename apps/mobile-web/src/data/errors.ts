/**
 * Error normalisation shared by the adapters. Every DataPort method must reject
 * with `StError` only (see DataPort.ts). Postgres RPCs raise `ST:<code>` in the
 * message; Edge Functions answer `{ code }`; anything else becomes
 * `network` / `unavailable` / `unknown`.
 */
import { isStError, StError, type ErrorCode } from '@st/domain';

const ERROR_CODES: readonly ErrorCode[] = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'validation',
  'conflict',
  'rate_limited',
  'age_restricted',
  'otp_invalid',
  'otp_expired',
  'join_banned',
  'chat_muted',
  'host_suspended',
  'account_banned',
  'women_only',
  'blocked',
  'game_full',
  'game_not_open',
  'outside_window',
  'too_many_sports',
  'invalid_radius',
  'dispute_window_closed',
  'already_reported',
  'payment_failed',
  'payment_required',
  'roster_priority',
  'network',
  'unavailable',
  'unknown',
];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

const ST_PREFIX = /ST:([a-z_]+)/;

/** Extracts an `ST:<code>` marker from any string (Postgres message, function body). */
export function parseStCode(text: string | null | undefined): ErrorCode | null {
  if (!text) return null;
  const m = ST_PREFIX.exec(text);
  const code = m?.[1];
  return isErrorCode(code) ? code : null;
}

/** Maps Supabase Auth error codes/messages to our codes. */
function authCode(e: { code?: unknown; message?: unknown; status?: unknown }): ErrorCode | null {
  const code = typeof e.code === 'string' ? e.code : '';
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  if (code === 'otp_expired' || msg.includes('expired')) return 'otp_expired';
  if (code === 'invalid_otp' || (msg.includes('invalid') && msg.includes('otp'))) return 'otp_invalid';
  if (code === 'over_sms_send_rate_limit' || code === 'over_request_rate_limit' || e.status === 429) return 'rate_limited';
  if (code === 'validation_failed' || code === 'phone_invalid') return 'validation';
  return null;
}

/**
 * Converts anything thrown by supabase-js, fetch or our own code into an `StError`.
 * Keeps the original message for logs only (never shown to users).
 */
export function toStError(error: unknown, fallback: ErrorCode = 'unknown'): StError {
  if (isStError(error)) return error;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown; status?: unknown; name?: unknown };
    const message = typeof e.message === 'string' ? e.message : '';
    const fromMessage =
      parseStCode(message) ??
      parseStCode(typeof e.details === 'string' ? e.details : null) ??
      parseStCode(typeof e.hint === 'string' ? e.hint : null);
    if (fromMessage) return new StError(fromMessage, message);
    if (isErrorCode(e.code)) return new StError(e.code, message);
    const auth = authCode(e);
    if (auth) return new StError(auth, message);
    if (e.name === 'TypeError' && /fetch|network/i.test(message)) return new StError('network', message);
    if (e.name === 'FunctionsFetchError' || e.name === 'AuthRetryableFetchError') return new StError('network', message);
    if (e.name === 'FunctionsRelayError' || e.status === 503 || e.status === 502) return new StError('unavailable', message);
    if (e.status === 401) return new StError('unauthenticated', message);
    if (e.status === 403) return new StError('forbidden', message);
    if (e.status === 404) return new StError('not_found', message);
    if (e.status === 429) return new StError('rate_limited', message);
    return new StError(fallback, message);
  }
  return new StError(fallback, typeof error === 'string' ? error : undefined);
}

/** i18n key for an error code (namespace `errors`). */
export function errorKey(error: unknown): `errors:${ErrorCode}` {
  return `errors:${toStError(error).code}`;
}
