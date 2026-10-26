/**
 * HTTP helpers shared by every Edge Function: JSON responses, the ErrorCode →
 * status mapping, `ST:<code>` parsing for Postgres errors, CORS and a request
 * wrapper that turns thrown errors into stable `{ code }` bodies.
 */
import { StError, isStError, type ErrorCode } from '@st/domain';
import type { Logger } from '#shared/log';

/** HTTP status per stable error code. The body always carries `{ code }`; the UI maps it to `errors:<code>`. */
export const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  rate_limited: 429,
  age_restricted: 403,
  otp_invalid: 400,
  otp_expired: 400,
  join_banned: 403,
  chat_muted: 403,
  host_suspended: 403,
  account_banned: 403,
  women_only: 403,
  blocked: 403,
  game_full: 409,
  game_not_open: 409,
  outside_window: 409,
  /** Contract v3: joining a series occurrence inside its roster-only window. */
  roster_priority: 409,
  too_many_sports: 400,
  invalid_radius: 400,
  dispute_window_closed: 409,
  already_reported: 409,
  payment_failed: 402,
  payment_required: 402,
  network: 503,
  unavailable: 503,
  unknown: 500,
};

const ERROR_CODES = new Set(Object.keys(HTTP_STATUS));

/** True for a known {@link ErrorCode}. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODES.has(value);
}

/** Extracts `<code>` from a Postgres message like `ST:chat_muted` or `ST:validation: field`. */
export function parseStCode(message: string | null | undefined): ErrorCode | null {
  const m = message ? /\bST:([a-z_]+)/.exec(message) : null;
  return m && isErrorCode(m[1]) ? m[1] : null;
}

export type HeadersInitLike = Record<string, string>;

export function json(body: unknown, status = 200, headers: HeadersInitLike = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/** Error body: `{ code, details? }`. Details are machine-readable only and never contain user content. */
export function errorResponse(code: ErrorCode, headers: HeadersInitLike = {}, details?: StError['details']): Response {
  return json(details ? { code, details } : { code }, HTTP_STATUS[code], headers);
}

/** Standard headers the supabase-js client sends with `functions.invoke`. */
const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type, x-idempotency-key';

export interface CorsOptions {
  /** `'*'` or an allow-list of exact origins (e.g. `https://app.sporttalent.example`). */
  allowedOrigins: '*' | readonly string[];
}

export function corsHeaders(req: Request, options: CorsOptions): HeadersInitLike {
  const origin = req.headers.get('origin');
  let allow: string | null = null;
  if (options.allowedOrigins === '*') allow = '*';
  else if (origin && options.allowedOrigins.includes(origin)) allow = origin;
  if (!allow) return {};
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    ...(allow === '*' ? {} : { vary: 'Origin' }),
  };
}

/** Reads a JSON object body with a size cap. Throws `StError('validation')`. */
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('application/json')) throw new StError('validation', 'content-type must be application/json');
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new StError('validation', 'body too large', { maxBytes });
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new StError('validation', 'body too large', { maxBytes });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StError('validation', 'malformed JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new StError('validation', 'body must be a JSON object');
  return parsed as Record<string, unknown>;
}

/** Converts anything thrown into an error response. Unknown errors are logged (without content) as 500/503. */
export function toErrorResponse(err: unknown, log: Logger, headers: HeadersInitLike = {}): Response {
  if (isStError(err)) {
    const status = HTTP_STATUS[err.code];
    if (status >= 500) log.error('request.failed', { code: err.code, error: err });
    return errorResponse(err.code, headers, err.details);
  }
  log.error('request.crashed', { error: err });
  return errorResponse('unknown', headers);
}

export interface RouteOptions {
  methods?: readonly string[];
  cors?: CorsOptions | null;
}

/**
 * Wraps a handler body: CORS preflight, method check and error mapping.
 * `run` receives the CORS headers to add to its own responses.
 */
export async function route(
  req: Request,
  log: Logger,
  options: RouteOptions,
  run: (cors: HeadersInitLike) => Promise<Response>,
): Promise<Response> {
  const cors = options.cors ? corsHeaders(req, options.cors) : {};
  if (req.method === 'OPTIONS' && options.cors) return new Response(null, { status: 204, headers: cors });
  const methods = options.methods ?? ['POST'];
  if (!methods.includes(req.method)) {
    return json({ code: 'validation', details: { method: req.method } }, 405, { ...cors, allow: methods.join(', ') });
  }
  try {
    return await run(cors);
  } catch (err) {
    return toErrorResponse(err, log, cors);
  }
}
