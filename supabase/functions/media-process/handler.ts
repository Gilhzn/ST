/**
 * media-process: the Media Vault pre-publication pipeline (VAULT-003).
 *
 * Callers:
 * - internal (`Authorization: Bearer <service role | FUNCTIONS_INTERNAL_SECRET>`):
 *   a Storage database webhook on `storage.objects` INSERT, a retry job, or `{ mediaId }`;
 * - the uploader (user JWT) with `{ mediaId }` (DataPort `completeMediaUpload`).
 *
 * → 200 { mediaId, status, idempotent }  (202 while a video is still transcoding)
 *
 * Photos: download original (≤ photo cap) → strip EXIF/GPS/XMP/comments (pure TS,
 *   `media-sanitize`; unparseable files are blocked, never published) → CSAM hash
 *   match on the sanitised bytes → image moderation → renditions → upload the
 *   sanitised object → `finalize_media` → delete the original.
 * Videos: signed URL → video provider transcode (drops container metadata) → when
 *   ready: duration check → CSAM match + moderation on sampled frames → finalize.
 * CSAM match: never published. The original is copied to the legal-hold path
 *   with a manifest (SHA-256, match ref, timestamps), the report is filed through
 *   {@link CsamReporter}, the account is restricted via `apply_effects` (temporary
 *   join ban, visibility restriction and chat mute pending review) and an urgent
 *   review item is queued; then the item is finalised `blocked`. The uploader
 *   only ever sees the generic policy block.
 *
 * Idempotent per media id: every step is repeatable (upserts, copy-if-absent,
 * report and review keyed by media id, `greatest()` projections) and finalisation
 * is last, so a failure anywhere leaves the item `processing` (unpublished) and a
 * retry completes it; a finalised item returns its status and only re-attempts
 * the original's deletion. Vendor outages fail closed (503, retried).
 * Media bytes, URLs and EXIF are never logged.
 */
import {
  DEFAULT_PHASE15_CONFIG,
  StError,
  type Effect,
  type GameId,
  type IsoDateTime,
  type MediaId,
  type MediaKind,
  type MediaModerationVerdict,
  type MediaStatus,
  type ModerationCategory,
  type Phase15Effect,
  type ReviewKind,
  type UserId,
} from '@st/domain';
import { bearerToken, requireUser, safeEqual, type AuthVerifier } from '#shared/auth';
import { json, readJson, route, type CorsOptions } from '#shared/http';
import type { Logger } from '#shared/log';
import type { CsamMatch, CsamReporter, CsamScanner, ImageModerationResult, ImageModerator, RenditionProvider, VideoProvider } from '#shared/media-providers';
import { IMAGE_MIME, MediaFormatError, stripImageMetadata } from '#shared/media-sanitize';
import { withTimeout, type Clock, type RateLimiter } from '#shared/runtime';
import { assertObjectKey, type StorageClient } from '#shared/storage';
import { isUuid, objectValue, uuidField } from '#shared/validate';

export interface MediaRecord {
  id: MediaId;
  gameId: GameId;
  uploaderId: UserId;
  kind: MediaKind;
  status: MediaStatus;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  /** Object key of the uploaded original. */
  storagePath: string;
  createdAt: IsoDateTime;
}

export interface FinalizeMediaInput {
  mediaId: MediaId;
  status: 'published' | 'blocked';
  verdict: MediaModerationVerdict;
  /** Sanitised object (photos) or `null`. */
  publishedPath: string | null;
  thumbnailPath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  /** Video provider reference (e.g. `stream:<uid>`), or `null`. */
  playbackRef: string | null;
}

export interface MediaProcessStore {
  loadMedia(mediaId: MediaId): Promise<MediaRecord | null>;
  /** `finalize_media` (service role). Idempotent; returns the resulting status. */
  finalizeMedia(input: FinalizeMediaInput): Promise<MediaStatus>;
  /** `apply_effects` (service role). */
  applyEffects(effects: readonly (Effect | Phase15Effect)[]): Promise<void>;
}

export interface MediaLimits {
  photoMaxBytes: number;
  videoMaxSeconds: number;
  /** Frames sampled per video for CSAM matching and moderation. */
  videoFrames: number;
}

export const DEFAULT_MEDIA_LIMITS: MediaLimits = {
  photoMaxBytes: DEFAULT_PHASE15_CONFIG.mediaPhotoMaxMb * 1024 * 1024,
  videoMaxSeconds: DEFAULT_PHASE15_CONFIG.mediaVideoMaxSeconds,
  videoFrames: 6,
};

export interface MediaProcessDeps {
  internalSecrets: readonly string[];
  auth: AuthVerifier;
  store: MediaProcessStore;
  storage: StorageClient;
  /** `MEDIA_BUCKET`. */
  bucket: string;
  /** Legal-hold bucket (`MEDIA_QUARANTINE_BUCKET`, defaults to `MEDIA_BUCKET`); objects under `quarantine/`. */
  quarantineBucket: string;
  /** `null` when no vendor is configured: nothing is published (fail closed). */
  csam: CsamScanner | null;
  reporter: CsamReporter;
  moderator: ImageModerator | null;
  renditions: RenditionProvider;
  video: VideoProvider | null;
  limits?: MediaLimits;
  /** Review kind for CSAM / minors signals (default `media_csam`). */
  csamReviewKind?: ReviewKind;
  vendorTimeoutMs?: number;
  rateLimiter: RateLimiter;
  clock: Clock;
  log: Logger;
  cors: CorsOptions;
}

export interface MediaProcessResult {
  mediaId: MediaId;
  status: MediaStatus;
  /** Internal callers only. */
  decision?: MediaModerationVerdict['decision'];
  reasonKey: string | null;
  idempotent: boolean;
}

/**
 * `review_kind` value added by the Media Vault migration (0103). Contract v3's `ReviewKind`
 * does not list it yet, hence the cast; `apply_effects` casts the text to the DB enum.
 */
export const MEDIA_CSAM_REVIEW_KIND = 'media_csam' as ReviewKind;

export const CSAM_REVIEW_SLA_HOURS = 24;

export const REASON_KEYS = {
  policy: 'media.blocked.policy',
  unsupported: 'media.blocked.unsupported',
  tooLarge: 'media.blocked.too_large',
  tooLong: 'media.blocked.too_long',
} as const;

/** Object keys derived from the item (never from client input). */
export function mediaPaths(item: Pick<MediaRecord, 'id' | 'gameId'>, ext: string) {
  const dir = `media/${item.gameId}/${item.id}`;
  return {
    published: `${dir}/display.${ext}`,
    renditionPrefix: dir,
    quarantineDir: `quarantine/${item.id}`,
  };
}

function isInternal(req: Request, secrets: readonly string[]): boolean {
  const token = bearerToken(req);
  return !!token && secrets.some((s) => s.length >= 16 && safeEqual(token, s));
}

/** `{ mediaId }` or a Storage webhook `{ type: 'INSERT', table: 'objects', record: { bucket_id, name } }`. */
function parseTarget(input: Record<string, unknown>, bucket: string): { mediaId: MediaId; objectPath: string | null } | null {
  if (input['mediaId'] !== undefined) return { mediaId: uuidField(input, 'mediaId'), objectPath: null };
  if (input['type'] === 'INSERT' && input['table'] === 'objects') {
    const record = objectValue(input['record'], 'record');
    if (record['bucket_id'] !== bucket || typeof record['name'] !== 'string') return null;
    const name = record['name'];
    if (!name.startsWith('originals/')) return null; // our own writes (display copies, quarantine) re-trigger the webhook
    const ids = name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    const id = ids[ids.length - 1];
    return id && isUuid(id) ? { mediaId: id.toLowerCase(), objectPath: name } : null;
  }
  throw new StError('validation', 'expected { mediaId } or a storage webhook');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

const verdict = (v: Omit<MediaModerationVerdict, 'categories'> & { categories?: readonly ModerationCategory[] }): MediaModerationVerdict => ({ categories: [], ...v });

export async function handle(req: Request, deps: MediaProcessDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'], cors: deps.cors }, async (cors) => {
    const internal = isInternal(req, deps.internalSecrets);
    const user = internal ? null : await requireUser(req, deps.auth);
    const input = await readJson(req, 64 * 1024);
    const target = parseTarget(input, deps.bucket);
    if (!target) return json({ skipped: true }, 200, cors);
    if (user) {
      const limit = await deps.rateLimiter.hit(`media-process:${user.userId}`, 60, 10 * 60_000);
      if (!limit.allowed) throw new StError('rate_limited', 'too many requests', { retryAfterMs: limit.retryAfterMs });
    }

    const item = await deps.store.loadMedia(target.mediaId);
    // Users learn nothing about other people's items.
    if (!item || (user && item.uploaderId !== user.userId)) throw new StError('not_found');
    if (target.objectPath !== null && target.objectPath !== item.storagePath) return json({ skipped: true }, 200, cors);

    const pipeline = new Pipeline(deps, item);
    const result = await pipeline.run();
    deps.log.info('media.processed', { mediaId: item.id, kind: item.kind, status: result.status, decision: result.decision ?? null, idempotent: result.idempotent });
    const status = result.status === 'processing' ? 202 : 200;
    if (internal) return json(result, status, cors);
    // The uploader never learns that a hash matched (no tipping off): a CSAM block reads like any policy block.
    const { decision: _hidden, ...publicResult } = result;
    return json(publicResult, status, cors);
  });
}

class Pipeline {
  readonly limits: MediaLimits;
  readonly timeoutMs: number;
  readonly now: number;
  constructor(
    readonly deps: MediaProcessDeps,
    readonly item: MediaRecord,
  ) {
    this.limits = deps.limits ?? DEFAULT_MEDIA_LIMITS;
    this.timeoutMs = deps.vendorTimeoutMs ?? 15_000;
    this.now = deps.clock.now();
  }

  async run(): Promise<MediaProcessResult> {
    const { item } = this;
    if (item.status !== 'processing') {
      await this.removeOriginal(); // finish a cleanup that a previous run may not have completed
      return { mediaId: item.id, status: item.status, reasonKey: null, idempotent: true };
    }
    if (!this.deps.csam) throw new StError('unavailable', 'CSAM scanner not configured', { reason: 'csam_unconfigured' });
    if (!this.deps.moderator) throw new StError('unavailable', 'image moderation not configured', { reason: 'moderation_unconfigured' });
    return item.kind === 'photo' ? this.photo() : this.videoItem();
  }

  // ----- photos --------------------------------------------------------------

  async photo(): Promise<MediaProcessResult> {
    const { item, deps } = this;
    let original: Uint8Array | null;
    try {
      original = await deps.storage.download(deps.bucket, item.storagePath, this.limits.photoMaxBytes);
    } catch (err) {
      if (err instanceof StError && err.code === 'validation') return this.block(verdict({ decision: 'block', exifStripped: false, csamHashMatch: false, source: 'fallback', reasonKey: REASON_KEYS.tooLarge }));
      throw err;
    }
    if (!original) throw new StError('conflict', 'upload not finished', { reason: 'not_uploaded' });

    let sanitized: Uint8Array;
    let mimeType: string;
    let ext: string;
    try {
      const stripped = stripImageMetadata(original);
      sanitized = stripped.bytes;
      mimeType = IMAGE_MIME[stripped.format];
      ext = stripped.format === 'jpeg' ? 'jpg' : stripped.format;
      deps.log.info('media.stripped', { mediaId: item.id, format: stripped.format, removed: stripped.removed.length });
    } catch (err) {
      if (!(err instanceof MediaFormatError)) throw err;
      return this.block(verdict({ decision: 'block', exifStripped: false, csamHashMatch: false, source: 'fallback', reasonKey: REASON_KEYS.unsupported }));
    }

    // Vendors get the sanitised bytes: no GPS ever leaves for hash matching or moderation.
    const match = await this.csamMatch([{ bytes: sanitized, mimeType }]);
    if (match) return this.csamPositive(match, await sha256Hex(original), ext);

    const mod = await this.moderate([{ bytes: sanitized, mimeType }]);
    if (mod.decision === 'block') {
      return this.block(verdict({ decision: 'block', categories: mod.categories, exifStripped: true, csamHashMatch: false, source: 'vision', reasonKey: REASON_KEYS.policy }), mod.minorsSignal);
    }

    const paths = mediaPaths(item, ext);
    const renditions = await deps.renditions.render({ bytes: sanitized, mimeType, sanitizedPath: paths.published, renditionPrefix: paths.renditionPrefix });
    await deps.storage.upload(deps.bucket, paths.published, sanitized, mimeType, { upsert: true });
    for (const r of renditions) if (r.bytes) await deps.storage.upload(deps.bucket, assertObjectKey(r.path), r.bytes, r.contentType, { upsert: true });
    const thumb = renditions.find((r) => r.name === 'thumb');
    const status = await deps.store.finalizeMedia({
      mediaId: item.id,
      status: 'published',
      verdict: verdict({ decision: 'publish', exifStripped: true, csamHashMatch: false, source: 'combined', reasonKey: null }),
      publishedPath: paths.published,
      thumbnailPath: thumb ? thumb.path : null,
      mimeType,
      sizeBytes: sanitized.byteLength,
      durationSeconds: null,
      playbackRef: null,
    });
    await this.removeOriginal();
    return { mediaId: item.id, status, decision: 'publish', reasonKey: null, idempotent: false };
  }

  // ----- videos --------------------------------------------------------------

  async videoItem(): Promise<MediaProcessResult> {
    const { item, deps } = this;
    if (!deps.video) throw new StError('unavailable', 'video provider not configured', { reason: 'video_unconfigured' });
    let sourceUrl: string;
    try {
      sourceUrl = await deps.storage.createSignedUrl(deps.bucket, item.storagePath, 3600);
    } catch (err) {
      if (err instanceof StError && err.code === 'not_found') throw new StError('conflict', 'upload not finished', { reason: 'not_uploaded' });
      throw err;
    }
    const ref = await this.vendor('video', () => deps.video!.ingest(item.id, sourceUrl));
    const st = await this.vendor('video', () => deps.video!.status(ref));
    if (st.state === 'processing') return { mediaId: item.id, status: 'processing', reasonKey: null, idempotent: false };
    if (st.state === 'error') {
      await this.vendor('video', () => deps.video!.remove(ref));
      return this.block(verdict({ decision: 'block', exifStripped: false, csamHashMatch: false, source: 'fallback', reasonKey: REASON_KEYS.unsupported }));
    }
    if (st.durationSeconds > this.limits.videoMaxSeconds + 1) {
      await this.vendor('video', () => deps.video!.remove(ref));
      return this.block(verdict({ decision: 'block', exifStripped: true, csamHashMatch: false, source: 'fallback', reasonKey: REASON_KEYS.tooLong }));
    }
    const frames = (await this.vendor('video', () => deps.video!.sampleFrames(ref, st.durationSeconds, this.limits.videoFrames))).map((bytes) => ({ bytes, mimeType: 'image/jpeg' }));
    if (frames.length === 0) throw new StError('unavailable', 'no frames sampled');

    const match = await this.csamMatch(frames);
    if (match) {
      await this.vendor('video', () => deps.video!.remove(ref));
      return this.csamPositive(match, null, 'video');
    }
    const mod = await this.moderate(frames);
    if (mod.decision === 'block') {
      await this.vendor('video', () => deps.video!.remove(ref));
      return this.block(verdict({ decision: 'block', categories: mod.categories, exifStripped: true, csamHashMatch: false, source: 'vision', reasonKey: REASON_KEYS.policy }), mod.minorsSignal);
    }
    const status = await deps.store.finalizeMedia({
      mediaId: item.id,
      status: 'published',
      verdict: verdict({ decision: 'publish', exifStripped: true, csamHashMatch: false, source: 'combined', reasonKey: null }),
      publishedPath: null,
      thumbnailPath: null,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      durationSeconds: Math.round(st.durationSeconds),
      playbackRef: `stream:${st.playbackRef}`,
    });
    await this.removeOriginal();
    return { mediaId: item.id, status, decision: 'publish', reasonKey: null, idempotent: false };
  }

  // ----- steps ---------------------------------------------------------------

  async vendor<T>(step: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const out = await withTimeout(fn, this.timeoutMs, this.deps.clock);
    if (out.ok) return out.value;
    this.deps.log.warn('media.vendor_failed', { mediaId: this.item.id, step, reason: out.reason, error: out.error });
    throw new StError('unavailable', `${step} provider unavailable`, { step });
  }

  async csamMatch(images: readonly { bytes: Uint8Array; mimeType: string }[]): Promise<CsamMatch | null> {
    for (const image of images) {
      const m = await this.vendor('csam', (signal) => this.deps.csam!.match(image, signal));
      if (m.matched) return m;
    }
    return null;
  }

  async moderate(images: readonly { bytes: Uint8Array; mimeType: string }[]): Promise<ImageModerationResult> {
    const categories = new Set<ModerationCategory>();
    let minorsSignal = false;
    for (const image of images) {
      const r = await this.vendor('moderation', (signal) => this.deps.moderator!.classify(image, signal));
      if (r.decision === 'block') r.categories.forEach((c) => categories.add(c));
      minorsSignal ||= r.minorsSignal;
    }
    return { decision: categories.size > 0 ? 'block' : 'allow', categories: [...categories].sort(), minorsSignal };
  }

  reviewItem(reason: string, evidence: Record<string, string | number | boolean | null>): Effect {
    const { item } = this;
    return {
      type: 'EnqueueReview',
      item: {
        kind: this.deps.csamReviewKind ?? MEDIA_CSAM_REVIEW_KIND,
        priority: 'high',
        subjectUserId: item.uploaderId,
        venueId: null,
        gameId: item.gameId,
        sanctionId: null,
        appealId: null,
        reportIds: [],
        evidence: { reason, mediaId: item.id, ...evidence },
        dueBy: new Date(this.now + CSAM_REVIEW_SLA_HOURS * 3_600_000).toISOString(),
        // Same key as the domain (`vault` module) and its SQL mirror: `media_csam:<id>` for a hash match.
        dedupeKey: reason === 'csam_hash_match' ? `media_csam:${item.id}` : `media_${reason}:${item.id}`,
      },
    };
  }

  /** Policy block: finalise, drop the original; a minors signal also queues an urgent human review. */
  async block(v: MediaModerationVerdict, minorsSignal = false): Promise<MediaProcessResult> {
    const { item, deps } = this;
    if (minorsSignal) await deps.store.applyEffects([this.reviewItem('minors_classifier', { categories: v.categories.join(',') })]);
    const status = await deps.store.finalizeMedia({ mediaId: item.id, status: 'blocked', verdict: v, publishedPath: null, thumbnailPath: null, mimeType: null, sizeBytes: null, durationSeconds: null, playbackRef: null });
    await this.removeOriginal();
    return { mediaId: item.id, status, decision: v.decision, reasonKey: v.reasonKey, idempotent: false };
  }

  /** VAULT-003 / AC-VAULT-003: never publish, preserve under legal hold, report, restrict, review. */
  async csamPositive(match: CsamMatch, sha256: string | null, ext: string): Promise<MediaProcessResult> {
    const { item, deps } = this;
    const detectedAt = new Date(this.now).toISOString();
    const dir = mediaPaths(item, ext).quarantineDir;
    const evidence = { bucket: deps.quarantineBucket, path: `${dir}/original.${ext === 'video' ? 'bin' : ext}` };

    // 1. Preserve: copy the untouched original to the legal-hold path (copy-if-absent), plus a manifest.
    await deps.storage.copy({ bucket: deps.bucket, path: item.storagePath }, evidence);
    const manifest = {
      mediaId: item.id, uploaderId: item.uploaderId, gameId: item.gameId, kind: item.kind, mimeType: item.mimeType,
      sizeBytes: item.sizeBytes, sha256, originalPath: item.storagePath, uploadedAt: item.createdAt,
      matchSource: match.source, matchId: match.matchId, detectedAt, legalHold: true,
    };
    try {
      await deps.storage.upload(deps.quarantineBucket, `${dir}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest)), 'application/json', { upsert: false });
    } catch (err) {
      if (!(err instanceof StError && err.code === 'conflict')) throw err; // first detection's manifest wins
    }

    // 2. Report (idempotent per media id).
    const reportInput = { mediaId: item.id, uploaderId: item.uploaderId, matchId: match.matchId, matchSource: match.source, sha256, evidence, mimeType: item.mimeType, uploadedAt: item.createdAt, detectedAt };
    const report = await this.vendor('report', () => deps.reporter.report(reportInput, item.id));

    // 3. Hold the account pending human review and 4. queue the review.
    // A durable account hold (not a sanction): `apply_effects` turns it into an `account_review_holds`
    // row that suspends joining, hosting, chat and uploads until a moderator decides, and survives
    // account re-creation. Effects mirror the domain `vault` module.
    await deps.store.applyEffects([
      { type: 'PreserveMediaEvidence', mediaId: item.id, uploaderId: item.uploaderId, dedupeKey: `preserve:${item.id}` },
      { type: 'RestrictAccountPendingReview', userId: item.uploaderId, reason: 'csam_match', dedupeKey: `restrict:media_csam:${item.id}` },
      this.reviewItem('csam_hash_match', {
        matchSource: match.source,
        matchId: match.matchId,
        reportStatus: report.status,
        reportId: report.reportId,
        evidenceBucket: evidence.bucket,
        evidencePath: evidence.path,
        sha256,
      }),
      { type: 'Audit', action: 'media.csam_quarantined', subjectUserId: item.uploaderId, data: { mediaId: item.id, reportStatus: report.status } },
    ]);

    // 5. Finalise blocked (last, so a failure above is retried), then drop the original from the upload path.
    const v = verdict({ decision: 'csam', exifStripped: item.kind === 'photo', csamHashMatch: true, source: 'hash', reasonKey: REASON_KEYS.policy });
    const status = await deps.store.finalizeMedia({ mediaId: item.id, status: 'blocked', verdict: v, publishedPath: null, thumbnailPath: null, mimeType: null, sizeBytes: null, durationSeconds: null, playbackRef: null });
    await this.removeOriginal();
    deps.log.warn('media.csam_quarantined', { mediaId: item.id, reportStatus: report.status });
    return { mediaId: item.id, status, decision: 'csam', reasonKey: REASON_KEYS.policy, idempotent: false };
  }

  async removeOriginal(): Promise<void> {
    try {
      await this.deps.storage.remove(this.deps.bucket, [this.item.storagePath]);
    } catch (error) {
      this.deps.log.warn('media.original_cleanup_failed', { mediaId: this.item.id, error });
    }
  }
}
