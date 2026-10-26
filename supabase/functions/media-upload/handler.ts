/**
 * media-upload: starts a Media Vault direct upload (VAULT-001/002, DataPort
 * `createMediaUploadIntent`).
 *
 * POST MediaUploadRequest { gameId, kind, mimeType, sizeBytes, durationSeconds? }  (user JWT)
 * → 200 MediaUploadIntent { mediaId, uploadUrl, method: 'PUT', headers, expiresAt, maxBytes }
 *
 * `create_upload_intent` runs *as the caller* and is authoritative: verified
 * attendee, window `startsAt … endsAt + 2h`, 30 items per user per game, size,
 * duration and type limits. Its `ST:<code>` errors pass through unchanged
 * (`outside_window`, `forbidden`, `validation`, `rate_limited`), with the
 * {@link MediaRejectReason} in `details.reason` when the RPC names one. The
 * function only adds a cheap shape check and signs a single-use upload URL for
 * the object key the RPC allocated (`StorageClient.createSignedUploadUrl`).
 * The client then calls `media-process` (`completeMediaUpload`).
 */
import {
  StError,
  isStError,
  type GameId,
  type IsoDateTime,
  type MediaId,
  type MediaKind,
  type MediaRejectReason,
  type MediaUploadIntent,
  type MediaUploadRequest,
} from '@st/domain';
import { requireUser, type AuthVerifier } from '#shared/auth';
import { json, readJson, route, type CorsOptions } from '#shared/http';
import type { Logger } from '#shared/log';
import type { Clock, RateLimiter } from '#shared/runtime';
import { assertObjectKey, type StorageClient } from '#shared/storage';
import { finiteNumber, stringField, uuidField } from '#shared/validate';

export interface UploadIntentRow {
  mediaId: MediaId;
  /** Object key of the original (`originals/…`), allocated by the database. */
  storagePath: string;
  maxBytes: number;
  expiresAt: IsoDateTime;
}

export interface MediaUploadStore {
  /** `create_upload_intent` as the caller (RLS / `auth.uid()`); raises `ST:<code>[: reason]`. */
  createUploadIntent(accessToken: string, request: MediaUploadRequest): Promise<UploadIntentRow>;
}

export interface MediaUploadDeps {
  auth: AuthVerifier;
  store: MediaUploadStore;
  storage: StorageClient;
  /** `MEDIA_BUCKET` (private). */
  bucket: string;
  rateLimiter: RateLimiter;
  clock: Clock;
  log: Logger;
  cors: CorsOptions;
}

/** Containers the pipeline can sanitise (images) or the video provider can transcode. */
export const ACCEPTED_MIME: Readonly<Record<MediaKind, readonly string[]>> = {
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
};

/** Supabase signed upload URLs are valid for 2 hours. */
export const SIGNED_UPLOAD_TTL_MS = 2 * 3_600_000;

const REJECT_REASONS: readonly MediaRejectReason[] = [
  'not_verified_attendee', 'window_not_open', 'window_closed', 'too_large', 'too_long', 'unsupported_type',
  'user_cap_reached', 'not_uploader', 'not_published', 'tags_pending',
];

/** Adds `details.reason` when a database error message names a {@link MediaRejectReason}. */
export function withRejectReason(err: unknown): unknown {
  if (!isStError(err) || err.details?.['reason']) return err;
  const reason = REJECT_REASONS.find((r) => new RegExp(`\\b${r}\\b`).test(err.message));
  return reason ? new StError(err.code, err.message, { ...(err.details ?? {}), reason }) : err;
}

function reject(reason: MediaRejectReason, field: string): never {
  throw new StError('validation', `${field}: ${reason}`, { field, reason });
}

function parseRequest(input: Record<string, unknown>): MediaUploadRequest {
  const gameId: GameId = uuidField(input, 'gameId');
  const kind = input['kind'];
  if (kind !== 'photo' && kind !== 'video') throw new StError('validation', 'kind must be photo or video', { field: 'kind' });
  const mimeType = stringField(input, 'mimeType', { max: 100 }).toLowerCase();
  if (!ACCEPTED_MIME[kind].includes(mimeType)) reject('unsupported_type', 'mimeType');
  const sizeBytes = finiteNumber(input['sizeBytes'], 'sizeBytes', 1, 2 ** 31);
  if (!Number.isInteger(sizeBytes)) throw new StError('validation', 'sizeBytes must be an integer', { field: 'sizeBytes' });
  const rawDuration = input['durationSeconds'];
  let durationSeconds: number | null = null;
  if (rawDuration !== undefined && rawDuration !== null) durationSeconds = finiteNumber(rawDuration, 'durationSeconds', 0, 24 * 3600);
  if (kind === 'video' && durationSeconds === null) throw new StError('validation', 'durationSeconds required for videos', { field: 'durationSeconds' });
  return { gameId, kind, mimeType, sizeBytes, durationSeconds: kind === 'video' ? durationSeconds : null };
}

export async function handle(req: Request, deps: MediaUploadDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'], cors: deps.cors }, async (cors) => {
    const user = await requireUser(req, deps.auth);
    const request = parseRequest(await readJson(req, 4 * 1024));

    const limit = await deps.rateLimiter.hit(`media-upload:${user.userId}`, 40, 10 * 60_000);
    if (!limit.allowed) throw new StError('rate_limited', 'too many uploads', { retryAfterMs: limit.retryAfterMs });

    let row: UploadIntentRow;
    try {
      row = await deps.store.createUploadIntent(user.accessToken, request);
    } catch (err) {
      const e = withRejectReason(err);
      if (isStError(e)) deps.log.info('media.intent_rejected', { gameId: request.gameId, code: e.code, reason: e.details?.['reason'] ?? null });
      throw e;
    }
    const signed = await deps.storage.createSignedUploadUrl(deps.bucket, assertObjectKey(row.storagePath));
    const now = deps.clock.now();
    const expiresAt = new Date(Math.min(Date.parse(row.expiresAt) || Infinity, now + SIGNED_UPLOAD_TTL_MS)).toISOString();
    const intent: MediaUploadIntent = {
      mediaId: row.mediaId,
      uploadUrl: signed.signedUrl,
      method: 'PUT',
      headers: { 'content-type': request.mimeType, 'x-upsert': 'false' },
      expiresAt,
      maxBytes: row.maxBytes,
    };
    deps.log.info('media.intent_created', { mediaId: row.mediaId, gameId: request.gameId, kind: request.kind, sizeBytes: request.sizeBytes });
    return json(intent, 200, cors);
  });
}
