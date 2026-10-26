/**
 * Object storage port used by the Media Vault functions, with a dependency-free
 * Supabase Storage implementation over `fetch` (service role; runs in Deno and Node).
 *
 * Object keys are produced by the database (`create_upload_intent`) and by
 * {@link mediaPaths}; they are validated here so a crafted key can never escape
 * its bucket (`..`, leading `/`, control characters).
 */
import { StError } from '@st/domain';

export interface SignedUpload {
  /** Absolute URL the client PUTs the file to (single use, short-lived). */
  signedUrl: string;
  /** Token for `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)`. */
  token: string;
  path: string;
}

export interface StorageClient {
  createSignedUploadUrl(bucket: string, path: string): Promise<SignedUpload>;
  /** Signed GET URL (used to hand originals to a video provider without proxying bytes). */
  createSignedUrl(bucket: string, path: string, expiresInS: number): Promise<string>;
  /** Downloads an object, refusing anything larger than `maxBytes`. `null` when it does not exist. */
  download(bucket: string, path: string, maxBytes: number): Promise<Uint8Array | null>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string, options?: { upsert?: boolean }): Promise<void>;
  /** Server-side copy across buckets (legal-hold preservation). Idempotent when the target exists. */
  copy(from: { bucket: string; path: string }, to: { bucket: string; path: string }): Promise<void>;
  /** Removes objects; missing ones are ignored. */
  remove(bucket: string, paths: readonly string[]): Promise<void>;
  /** Object keys directly under `prefix` (a folder ending in `/`), at most `limit`. */
  list(bucket: string, prefix: string, limit: number): Promise<string[]>;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;

/** Throws `validation` unless `path` is a safe relative object key. */
export function assertObjectKey(path: string): string {
  if (!KEY_RE.test(path) || path.split('/').some((p) => p === '' || p === '.' || p === '..')) {
    throw new StError('validation', 'invalid object key');
  }
  return path;
}

function encodeKey(path: string): string {
  return assertObjectKey(path).split('/').map(encodeURIComponent).join('/');
}

export function createSupabaseStorage(options: { url: string; serviceKey: string; fetch?: typeof fetch; timeoutMs?: number }): StorageClient {
  const base = `${options.url.replace(/\/+$/, '')}/storage/v1`;
  const doFetch = options.fetch ?? fetch;
  const auth = { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}` };

  async function call(path: string, init: RequestInit, allow404 = false): Promise<Response | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 30_000);
    try {
      const res = await doFetch(`${base}${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string> | undefined) }, signal: ctrl.signal });
      if (res.ok) return res;
      // Storage answers 400 with statusCode "404" for missing objects.
      let notFound = res.status === 404;
      let duplicate = res.status === 409;
      try {
        const body = (await res.json()) as { statusCode?: unknown; error?: unknown };
        notFound ||= String(body.statusCode) === '404' || body.error === 'not_found';
        duplicate ||= String(body.statusCode) === '409' || body.error === 'Duplicate';
      } catch {
        /* non-JSON */
      }
      if (notFound && allow404) return null;
      if (notFound) throw new StError('not_found', 'object not found');
      if (duplicate) throw new StError('conflict', 'object exists');
      if (res.status === 401 || res.status === 403) throw new StError('forbidden', 'storage denied the request');
      if (res.status === 413) throw new StError('validation', 'object too large');
      throw new StError('unavailable', `storage error ${res.status}`);
    } catch (e) {
      if (e instanceof StError) throw e;
      throw new StError('unavailable', 'storage unreachable');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async createSignedUploadUrl(bucket, path) {
      const res = (await call(`/object/upload/sign/${encodeURIComponent(bucket)}/${encodeKey(path)}`, { method: 'POST' })) as Response;
      const body = (await res.json()) as { url?: unknown };
      if (typeof body.url !== 'string') throw new StError('unavailable', 'malformed storage response');
      const signed = new URL(`${base}${body.url}`);
      const token = signed.searchParams.get('token');
      if (!token) throw new StError('unavailable', 'malformed storage response');
      return { signedUrl: signed.toString(), token, path };
    },
    async createSignedUrl(bucket, path, expiresInS) {
      const res = (await call(`/object/sign/${encodeURIComponent(bucket)}/${encodeKey(path)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiresInS }),
      })) as Response;
      const body = (await res.json()) as { signedURL?: unknown };
      if (typeof body.signedURL !== 'string') throw new StError('unavailable', 'malformed storage response');
      return `${base}${body.signedURL}`;
    },
    async download(bucket, path, maxBytes) {
      const res = await call(`/object/authenticated/${encodeURIComponent(bucket)}/${encodeKey(path)}`, { method: 'GET' }, true);
      if (!res) return null;
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > maxBytes) throw new StError('validation', 'object too large', { maxBytes });
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) throw new StError('validation', 'object too large', { maxBytes });
      return buf;
    },
    async upload(bucket, path, bytes, contentType, opts = {}) {
      await call(`/object/${encodeURIComponent(bucket)}/${encodeKey(path)}`, {
        method: 'POST',
        headers: { 'content-type': contentType, 'x-upsert': opts.upsert ? 'true' : 'false', 'cache-control': 'max-age=31536000' },
        body: bytes as unknown as BodyInit,
      });
    },
    async copy(from, to) {
      try {
        await call('/object/copy', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ bucketId: from.bucket, sourceKey: assertObjectKey(from.path), destinationBucket: to.bucket, destinationKey: assertObjectKey(to.path) }),
        });
      } catch (e) {
        if (e instanceof StError && e.code === 'conflict') return; // already preserved
        throw e;
      }
    },
    async list(bucket, prefix, limit) {
      const folder = prefix.replace(/\/+$/, '');
      assertObjectKey(folder);
      const res = (await call(`/object/list/${encodeURIComponent(bucket)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: folder, limit, offset: 0 }),
      })) as Response;
      const rows = (await res.json()) as { name?: unknown; id?: unknown }[];
      return Array.isArray(rows) ? rows.filter((r) => typeof r.name === 'string' && r.id).map((r) => `${folder}/${String(r.name)}`) : [];
    },
    async remove(bucket, paths) {
      if (paths.length === 0) return;
      await call(`/object/${encodeURIComponent(bucket)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths.map(assertObjectKey) }),
      });
    },
  };
}
