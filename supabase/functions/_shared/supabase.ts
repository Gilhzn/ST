/**
 * Minimal Supabase client over `fetch` (PostgREST, GoTrue admin, Realtime
 * broadcast). Dependency-free so it runs unchanged in Deno and Node tests.
 *
 * - {@link createSupabaseClient} with the service role key is the *admin*
 *   client (bypasses RLS). Use it only for writes the architecture assigns to
 *   Edge Functions (chat insert, apply_effects, record_checkin_verdict…).
 * - With `accessToken` it acts as the user (RLS applies): prefer it for reads
 *   that must respect the caller's visibility (e.g. `game_views`).
 * - Postgres errors raised as `ST:<code>` become `StError(code)`.
 */
import { StError } from '@st/domain';
import { parseStCode } from '#shared/http';

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is';
export type FilterValue = string | number | boolean | null | readonly (string | number)[];
export type Filter = readonly [column: string, op: FilterOp, value: FilterValue];

export interface SelectOptions {
  columns?: string;
  filters?: readonly Filter[];
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

export interface WriteOptions {
  /** Upsert conflict target (`col1,col2`). */
  onConflict?: string;
  /** With `onConflict`: `true` = `ON CONFLICT DO NOTHING`, `false` = merge. */
  ignoreDuplicates?: boolean;
  /** Return the written rows (default true). */
  returning?: boolean;
}

export interface BroadcastMessage {
  topic: string;
  event: string;
  payload: unknown;
  /** Private channels require Realtime Authorization (RLS on realtime.messages). */
  private: boolean;
}

export interface SupabaseClient {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  select<T = Record<string, unknown>>(table: string, options?: SelectOptions): Promise<T[]>;
  insert<T = Record<string, unknown>>(table: string, rows: object | readonly object[], options?: WriteOptions): Promise<T[]>;
  update<T = Record<string, unknown>>(table: string, filters: readonly Filter[], patch: object, options?: WriteOptions): Promise<T[]>;
  remove(table: string, filters: readonly Filter[]): Promise<number>;
  deleteAuthUser(userId: string): Promise<void>;
  broadcast(messages: readonly BroadcastMessage[]): Promise<void>;
}

export interface SupabaseClientOptions {
  url: string;
  /** Service role key (admin) or anon key (with `accessToken`). */
  apiKey: string;
  /** User access token; when set, requests run as that user under RLS. */
  accessToken?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function encodeValue(v: FilterValue, op: FilterOp): string {
  if (op === 'in') {
    const list = (Array.isArray(v) ? v : [v]) as (string | number)[];
    return `(${list.map((x) => (typeof x === 'number' ? String(x) : `"${String(x).replace(/["\\]/g, (c) => `\\${c}`)}"`)).join(',')})`;
  }
  if (op === 'is') return v === null ? 'null' : String(v);
  return String(v);
}

export function buildQuery(filters: readonly Filter[] = [], extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [col, op, value] of filters) {
    if (!/^[a-z_][a-z0-9_]*$/.test(col)) throw new StError('validation', 'invalid column');
    params.append(col, `${op}.${encodeValue(value, op)}`);
  }
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function createSupabaseClient(options: SupabaseClientOptions): SupabaseClient {
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  const bearer = options.accessToken ?? options.apiKey;
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    apikey: options.apiKey,
    authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
    ...extra,
  });

  async function call(path: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 8000);
    try {
      const res = await doFetch(`${base}${path}`, { ...init, signal: ctrl.signal });
      if (!res.ok) {
        let message = '';
        try {
          const body = (await res.json()) as { message?: unknown; msg?: unknown; error?: unknown };
          message = String(body.message ?? body.msg ?? body.error ?? '');
        } catch {
          /* non-JSON error body */
        }
        const code = parseStCode(message);
        if (code) throw new StError(code, message);
        if (res.status === 401 || res.status === 403) throw new StError('forbidden', 'database denied the request');
        if (res.status === 404) throw new StError('not_found', 'resource not found');
        if (res.status === 409) throw new StError('conflict', 'conflict');
        throw new StError('unavailable', `database error ${res.status}`);
      }
      return res;
    } catch (e) {
      if (e instanceof StError) throw e;
      throw new StError('unavailable', 'database unreachable');
    } finally {
      clearTimeout(timer);
    }
  }

  async function readRows<T>(res: Response): Promise<T[]> {
    const text = await res.text();
    if (!text) return [];
    const data = JSON.parse(text) as unknown;
    return (Array.isArray(data) ? data : [data]) as T[];
  }

  const prefer = (o: WriteOptions = {}): string => {
    const parts = [o.returning === false ? 'return=minimal' : 'return=representation'];
    if (o.onConflict) parts.push(o.ignoreDuplicates ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates');
    return parts.join(',');
  };

  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      const res = await call(`/rest/v1/rpc/${encodeURIComponent(fn)}`, { method: 'POST', headers: headers(), body: JSON.stringify(args) });
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as T;
    },
    async select<T>(table: string, o: SelectOptions = {}): Promise<T[]> {
      const extra: Record<string, string> = { select: o.columns ?? '*' };
      if (o.order) extra['order'] = `${o.order.column}.${o.order.ascending === false ? 'desc' : 'asc'}`;
      if (o.limit !== undefined) extra['limit'] = String(o.limit);
      const res = await call(`/rest/v1/${table}${buildQuery(o.filters, extra)}`, { method: 'GET', headers: headers() });
      return readRows<T>(res);
    },
    async insert<T>(table: string, rows: object | readonly object[], o: WriteOptions = {}): Promise<T[]> {
      const q = o.onConflict ? buildQuery([], { on_conflict: o.onConflict }) : '';
      const res = await call(`/rest/v1/${table}${q}`, { method: 'POST', headers: headers({ prefer: prefer(o) }), body: JSON.stringify(rows) });
      return o.returning === false ? [] : readRows<T>(res);
    },
    async update<T>(table: string, filters: readonly Filter[], patch: object, o: WriteOptions = {}): Promise<T[]> {
      if (filters.length === 0) throw new StError('validation', 'refusing an unfiltered update');
      const res = await call(`/rest/v1/${table}${buildQuery(filters)}`, { method: 'PATCH', headers: headers({ prefer: prefer(o) }), body: JSON.stringify(patch) });
      return o.returning === false ? [] : readRows<T>(res);
    },
    async remove(table: string, filters: readonly Filter[]): Promise<number> {
      if (filters.length === 0) throw new StError('validation', 'refusing an unfiltered delete');
      const res = await call(`/rest/v1/${table}${buildQuery(filters)}`, { method: 'DELETE', headers: headers({ prefer: 'return=representation' }) });
      return (await readRows(res)).length;
    },
    async deleteAuthUser(userId: string): Promise<void> {
      try {
        await call(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: headers() });
      } catch (e) {
        if (e instanceof StError && e.code === 'not_found') return; // already deleted: idempotent
        throw e;
      }
    },
    async broadcast(messages: readonly BroadcastMessage[]): Promise<void> {
      if (messages.length === 0) return;
      await call('/realtime/v1/api/broadcast', { method: 'POST', headers: headers(), body: JSON.stringify({ messages }) });
    },
  };
}
