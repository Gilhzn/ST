/**
 * Optional Phase 1.5 adapter extensions (same pattern as `blocked.ts`).
 *
 * DataPort contract v3 covers the rules; a few screens need data the contract
 * does not carry yet. Adapters implement these when they can; callers go
 * through the helpers below, which degrade gracefully when an adapter lacks one.
 *
 * - `listMyRatingHistory`: the caller's weekly Glicko updates (`rating_updates`,
 *   readable by the owner under RLS) for the level sparkline.
 * - `reportMedia`: `report_media(p_media_id, p_reason, p_note)` (one report per person).
 * - `getMediaItem`: one item the caller may see (`media_items` + `st_media_json`), for
 *   tag-request thumbnails in the inbox.
 * - `uploadMediaObject`: sends the picked bytes to `MediaUploadIntent.uploadUrl`
 *   (Supabase: signed `PUT`; InMemory: keeps the local data URL as the published image).
 */
import type { MediaId, MediaItemView, MediaUploadIntent, RatingUpdate, SportId } from '@st/domain';

import type { DataPort } from './DataPort';

/** Mirrors the SQL enum `media_report_reason`. */
export const MEDIA_REPORT_REASONS = ['nudity', 'violence', 'harassment', 'privacy', 'copyright', 'spam', 'other'] as const;
export type MediaReportReason = (typeof MEDIA_REPORT_REASONS)[number];

/** A file picked on this device (see `platform/pick`). */
export interface PickedMedia {
  /** Displayable URI (data URL on web). */
  uri: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'photo' | 'video';
  durationSeconds: number | null;
  /** Raw bytes for a direct upload (web `File`). */
  blob?: Blob;
}

export interface Phase15Extension {
  listMyRatingHistory(sport?: SportId): Promise<RatingUpdate[]>;
  reportMedia(mediaId: MediaId, reason: MediaReportReason, note?: string): Promise<void>;
  getMediaItem(mediaId: MediaId): Promise<MediaItemView | null>;
  uploadMediaObject(intent: MediaUploadIntent, file: PickedMedia): Promise<void>;
}

function ext(port: DataPort): Partial<Phase15Extension> {
  return port as unknown as Partial<Phase15Extension>;
}

export async function listMyRatingHistory(port: DataPort, sport?: SportId): Promise<RatingUpdate[]> {
  const fn = ext(port).listMyRatingHistory;
  return fn ? fn.call(port, sport) : [];
}

export function canReportMedia(port: DataPort): boolean {
  return typeof ext(port).reportMedia === 'function';
}

export async function reportMedia(port: DataPort, mediaId: MediaId, reason: MediaReportReason, note?: string): Promise<void> {
  const fn = ext(port).reportMedia;
  if (fn) await fn.call(port, mediaId, reason, note);
}

export async function getMediaItem(port: DataPort, mediaId: MediaId): Promise<MediaItemView | null> {
  const fn = ext(port).getMediaItem;
  return fn ? fn.call(port, mediaId) : null;
}

/** Full upload: intent → bytes → pre-publication pipeline. Returns the new item id. */
export async function uploadPickedMedia(port: DataPort, gameId: string, file: PickedMedia): Promise<MediaId> {
  const intent = await port.createMediaUploadIntent({
    gameId,
    kind: file.kind,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    durationSeconds: file.durationSeconds,
  });
  const put = ext(port).uploadMediaObject;
  if (put) await put.call(port, intent, file);
  await port.completeMediaUpload(intent.mediaId);
  return intent.mediaId;
}
