/**
 * Vendor ports of the Media Vault pre-publication pipeline (VAULT-003) and
 * their production adapters. Every port has an in-memory fake in
 * `_test/media-fakes.ts`; handlers only ever see the interfaces.
 *
 * | Port | Production adapter | Notes |
 * |---|---|---|
 * | {@link CsamScanner} | Microsoft PhotoDNA Cloud Service (`CSAM_PROVIDER_KEY`) | Hash match only; perceptual hashes never leave the vendor. |
 * | {@link CsamReporter} | {@link manualCsamReporter} | Files nothing automatically: an urgent review item tells Trust & Safety to file the NCMEC / national-hotline report. A vendor reporting API needs a contract. |
 * | {@link ImageModerator} | OpenAI `omni-moderation-latest` with image input (`OPENAI_API_KEY`) | |
 * | {@link RenditionProvider} | {@link storageTransformRenditions} (Supabase image transformations, on the fly) | No bytes are produced; the app requests `?width=` variants of the sanitised object. |
 * | {@link VideoProvider} | Cloudflare Stream (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_TOKEN`, `CLOUDFLARE_STREAM_CUSTOMER_CODE`) | Transcoding drops container metadata (GPS atoms); frames are sampled from Stream thumbnails. |
 *
 * Data minimisation: vendors receive media bytes (or a short-lived signed URL)
 * and an opaque media id. Never user ids, names, game or venue details, except
 * in the CSAM report, where the law requires uploader information.
 */
import type { ModerationCategory } from '@st/domain';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface CsamMatch {
  matched: boolean;
  /** Vendor match reference (kept for the report and legal hold), or `null`. */
  matchId: string | null;
  /** Vendor name, e.g. `photodna`. */
  source: string;
}

export interface CsamScanner {
  readonly name: string;
  /** Hash-matches one image (a photo, or one sampled video frame). Throws when the vendor is unavailable. */
  match(image: { bytes: Uint8Array; mimeType: string }, signal: AbortSignal): Promise<CsamMatch>;
}

export interface CsamReportInput {
  mediaId: string;
  uploaderId: string;
  matchId: string | null;
  matchSource: string;
  /** SHA-256 of the preserved original (chain of custody); `null` for videos (not downloaded by the function). */
  sha256: string | null;
  /** Legal-hold object (bucket/path). */
  evidence: { bucket: string; path: string };
  mimeType: string;
  uploadedAt: string;
  detectedAt: string;
}

export interface CsamReportResult {
  /** `filed`: submitted through the vendor; `manual_required`: T&S must file it (review item). */
  status: 'filed' | 'manual_required';
  reportId: string | null;
}

export interface CsamReporter {
  /** Idempotent per `idempotencyKey` (the media id). */
  report(input: CsamReportInput, idempotencyKey: string): Promise<CsamReportResult>;
}

export interface ImageModerationResult {
  decision: 'allow' | 'block';
  categories: ModerationCategory[];
  /** True when a category suggests minors: routed to urgent human review even without a hash match. */
  minorsSignal: boolean;
}

export interface ImageModerator {
  readonly name: string;
  classify(image: { bytes: Uint8Array; mimeType: string }, signal: AbortSignal): Promise<ImageModerationResult>;
}

export interface Rendition {
  name: 'thumb' | 'medium';
  maxWidth: number;
  /** Stored path when bytes were produced; with on-the-fly transforms, the sanitised object's path. */
  path: string;
  /** Bytes to upload, or `null` when the variant is served by on-the-fly transformation. */
  bytes: Uint8Array | null;
  contentType: string;
}

export interface RenditionProvider {
  render(input: { bytes: Uint8Array; mimeType: string; sanitizedPath: string; renditionPrefix: string }): Promise<Rendition[]>;
}

export type VideoStatus =
  | { state: 'processing' }
  | { state: 'ready'; durationSeconds: number; playbackRef: string }
  | { state: 'error'; reason: string };

export interface VideoProvider {
  readonly name: string;
  /** Starts (or finds) the transcode of `sourceUrl` for `mediaId`. Idempotent per media id. Returns the provider ref. */
  ingest(mediaId: string, sourceUrl: string): Promise<string>;
  status(ref: string): Promise<VideoStatus>;
  /** JPEG frames sampled evenly over the video (moderation and CSAM matching). */
  sampleFrames(ref: string, durationSeconds: number, count: number): Promise<Uint8Array[]>;
  /** Deletes the transcoded asset (blocked or quarantined items). Missing assets are ignored. */
  remove(ref: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// PhotoDNA (CSAM hash matching)
// ---------------------------------------------------------------------------

/** Microsoft PhotoDNA Cloud Service `Match`. Response codes: 3000 = OK. */
export function createPhotoDnaScanner(options: { apiKey: string; fetch?: typeof fetch; baseUrl?: string }): CsamScanner {
  const doFetch = options.fetch ?? fetch;
  const url = `${(options.baseUrl ?? 'https://api.microsoftmoderator.com/photodna/v1.0').replace(/\/+$/, '')}/Match?enhance=false`;
  return {
    name: 'photodna',
    async match(image, signal) {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': options.apiKey, 'content-type': image.mimeType },
        body: image.bytes as unknown as BodyInit,
        signal,
      });
      if (!res.ok) throw new Error(`photodna HTTP ${res.status}`);
      const body = (await res.json()) as { IsMatch?: unknown; Status?: { Code?: unknown }; MatchDetails?: { MatchFlags?: { MatchId?: unknown }[] } };
      if (body.Status && body.Status.Code !== 3000) throw new Error(`photodna status ${String(body.Status.Code)}`);
      if (typeof body.IsMatch !== 'boolean') throw new Error('photodna: malformed response');
      const flag = body.MatchDetails?.MatchFlags?.[0];
      return { matched: body.IsMatch, matchId: flag && flag.MatchId !== undefined ? String(flag.MatchId) : null, source: 'photodna' };
    },
  };
}

/** No automated filing: the urgent `media_csam` review item carries everything T&S needs to file. */
export const manualCsamReporter: CsamReporter = {
  report: () => Promise.resolve({ status: 'manual_required', reportId: null }),
};

// ---------------------------------------------------------------------------
// OpenAI omni-moderation (image input)
// ---------------------------------------------------------------------------

const IMAGE_CATEGORY_MAP: Readonly<Record<string, ModerationCategory>> = {
  sexual: 'sexual',
  'sexual/minors': 'sexual_minors',
  violence: 'violence',
  'violence/graphic': 'violence',
  'self-harm': 'self_harm',
  'self-harm/intent': 'self_harm',
  'self-harm/instructions': 'self_harm',
  harassment: 'harassment',
  'harassment/threatening': 'threat',
  hate: 'hate',
  'hate/threatening': 'hate',
  illicit: 'other',
  'illicit/violent': 'violence',
};

/**
 * Image block thresholds. Sports photos legitimately show contact, sweat and
 * swimwear-like kit, so plain `violence` needs a very high score; sexual
 * content and anything involving minors are near zero tolerance.
 */
export const IMAGE_THRESHOLDS: Readonly<Record<string, number>> = {
  sexual: 0.5,
  'sexual/minors': 0.1,
  violence: 0.9,
  'violence/graphic': 0.6,
  'self-harm': 0.6,
  'self-harm/intent': 0.6,
  'self-harm/instructions': 0.6,
  default: 0.85,
};

/** Converts an omni-moderation result into an image verdict. Exported for tests. */
export function imageVerdict(result: { category_scores?: unknown }): ImageModerationResult {
  const scores = (result.category_scores && typeof result.category_scores === 'object' ? result.category_scores : {}) as Record<string, unknown>;
  const categories = new Set<ModerationCategory>();
  let minorsSignal = false;
  for (const [key, raw] of Object.entries(scores)) {
    const score = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    const threshold = IMAGE_THRESHOLDS[key] ?? (IMAGE_THRESHOLDS['default'] as number);
    if (score >= threshold) {
      categories.add(IMAGE_CATEGORY_MAP[key] ?? 'other');
      if (key === 'sexual/minors') minorsSignal = true;
    }
  }
  return { decision: categories.size > 0 ? 'block' : 'allow', categories: [...categories].sort(), minorsSignal };
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createOmniImageModerator(options: { apiKey: string; fetch?: typeof fetch; baseUrl?: string }): ImageModerator {
  const doFetch = options.fetch ?? fetch;
  const url = `${(options.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '')}/v1/moderations`;
  return {
    name: 'omni',
    async classify(image, signal) {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'omni-moderation-latest',
          input: [{ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${base64(image.bytes)}` } }],
        }),
        signal,
      });
      if (!res.ok) throw new Error(`omni-moderation HTTP ${res.status}`);
      const body = (await res.json()) as { results?: unknown };
      const first = Array.isArray(body.results) ? (body.results[0] as Record<string, unknown> | undefined) : undefined;
      if (!first) throw new Error('omni-moderation: malformed response');
      return imageVerdict(first);
    },
  };
}

// ---------------------------------------------------------------------------
// Renditions
// ---------------------------------------------------------------------------

/** Thumbnail and display sizes served by Supabase image transformations of the sanitised object. */
export const RENDITION_WIDTHS = { thumb: 320, medium: 1280 } as const;

export const storageTransformRenditions: RenditionProvider = {
  render: ({ mimeType, sanitizedPath }) =>
    Promise.resolve(
      (Object.entries(RENDITION_WIDTHS) as [Rendition['name'], number][]).map(([name, maxWidth]) => ({ name, maxWidth, path: sanitizedPath, bytes: null, contentType: mimeType })),
    ),
};

// ---------------------------------------------------------------------------
// Cloudflare Stream
// ---------------------------------------------------------------------------

interface StreamVideo {
  uid?: unknown;
  readyToStream?: unknown;
  duration?: unknown;
  status?: { state?: unknown; errorReasonCode?: unknown };
  meta?: { name?: unknown };
}

export function createCloudflareStream(options: { accountId: string; apiToken: string; customerCode: string; fetch?: typeof fetch }): VideoProvider {
  const doFetch = options.fetch ?? fetch;
  const api = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/stream`;
  const headers = { authorization: `Bearer ${options.apiToken}`, 'content-type': 'application/json' };
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await doFetch(`${api}${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`stream HTTP ${res.status}`);
    const body = (await res.json()) as { success?: unknown; result?: T };
    if (body.success !== true) throw new Error('stream: request failed');
    return body.result as T;
  };
  const uidRe = /^[a-f0-9]{32}$/;
  const checkUid = (ref: string): string => {
    if (!uidRe.test(ref)) throw new Error('stream: invalid uid');
    return ref;
  };
  return {
    name: 'cloudflare-stream',
    async ingest(mediaId, sourceUrl) {
      // Idempotent: the media id is stored as the video name and searched first.
      const existing = await call<StreamVideo[]>(`?search=${encodeURIComponent(mediaId)}`);
      const hit = existing.find((v) => v.meta?.name === mediaId && typeof v.uid === 'string');
      if (hit) return String(hit.uid);
      const created = await call<StreamVideo>('/copy', {
        method: 'POST',
        body: JSON.stringify({ url: sourceUrl, meta: { name: mediaId }, requireSignedURLs: true }),
      });
      if (typeof created.uid !== 'string') throw new Error('stream: malformed response');
      return created.uid;
    },
    async status(ref) {
      const v = await call<StreamVideo>(`/${checkUid(ref)}`);
      const state = v.status?.state;
      if (state === 'error') return { state: 'error', reason: String(v.status?.errorReasonCode ?? 'unknown') };
      if (v.readyToStream === true && state === 'ready') return { state: 'ready', durationSeconds: Number(v.duration) || 0, playbackRef: ref };
      return { state: 'processing' };
    },
    async sampleFrames(ref, durationSeconds, count) {
      const { token } = await call<{ token: string }>(`/${checkUid(ref)}/token`, { method: 'POST', body: JSON.stringify({}) });
      const frames: Uint8Array[] = [];
      const n = Math.max(1, count);
      for (let i = 0; i < n; i++) {
        const t = Math.max(0, ((i + 0.5) * durationSeconds) / n).toFixed(1);
        const res = await doFetch(`https://customer-${options.customerCode}.cloudflarestream.com/${encodeURIComponent(token)}/thumbnails/thumbnail.jpg?time=${t}s&height=720`);
        if (!res.ok) throw new Error(`stream thumbnail HTTP ${res.status}`);
        frames.push(new Uint8Array(await res.arrayBuffer()));
      }
      return frames;
    },
    async remove(ref) {
      const res = await doFetch(`${api}/${checkUid(ref)}`, { method: 'DELETE', headers });
      if (!res.ok && res.status !== 404) throw new Error(`stream HTTP ${res.status}`);
    },
  };
}
