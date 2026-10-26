/**
 * Media Vault (VAULT-001..009), pure rules:
 * - upload window `startsAt … endsAt + mediaUploadAfterEndHours` (inclusive),
 *   verified attendees only, size/duration/type limits, per-user cap per game;
 * - consent: tags are requests; `venue_public` only when the uploader opted in
 *   AND every tag is accepted (a tag removed by the uploader before acceptance
 *   no longer blocks; a veto from the tagged person always blocks);
 * - pre-publication verdicts (CSAM → block, preserve, restrict, P0 review);
 * - retention: `createdAt + mediaRetentionMonths` (Pro: until the subscription
 *   ends + `mediaProGraceDays`, whichever is later).
 */
import type {
  EpochMs,
  ErrorCode,
  Game,
  IsoDateTime,
  MediaItem,
  MediaModerationVerdict,
  MediaRejectReason,
  MediaTag,
  MediaUploadRequest,
  MediaVisibility,
  Phase15Effect,
  Result,
  UserId,
  Block,
} from '../types';
import { DAY_MS, HOUR_MS, toEpochMs, toIso } from '../time';
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from '../config';
import type { TimeWindow } from '../games/windows';
import { SEVERE_REPORT_SLA_HOURS } from '../trust/constants';

/** Accepted MIME types (VAULT-009 pickers produce these). */
export const MEDIA_MIME_TYPES = {
  // HEIC/HEIF are excluded: the media-process pipeline cannot strip their EXIF/GPS metadata (VAULT-003).
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
} as const;

const MB = 1024 * 1024;

/** VAULT-001: `startsAt … endsAt + mediaUploadAfterEndHours`, both inclusive. */
export function mediaUploadWindow(game: Pick<Game, 'startsAt' | 'endsAt'>, config: DomainConfig = DEFAULT_DOMAIN_CONFIG): TimeWindow {
  return { opensAt: game.startsAt, closesAt: toIso(toEpochMs(game.endsAt) + config.mediaUploadAfterEndHours * HOUR_MS) };
}

export interface MediaUploadCheckInput {
  game: Pick<Game, 'startsAt' | 'endsAt'>;
  /** The uploader is a verified attendee of the game. */
  verifiedAttendee: boolean;
  request: MediaUploadRequest;
  /** The uploader's items in this game that are not `removed`. */
  existingCount: number;
}

/**
 * First failing check: `not_verified_attendee`, `window_not_open`,
 * `window_closed` (AC-VAULT-001), `unsupported_type` (MIME, or a video without
 * a duration), `too_large`, `too_long`, `user_cap_reached`.
 */
export function checkMediaUpload(input: MediaUploadCheckInput, config: DomainConfig = DEFAULT_DOMAIN_CONFIG, now: EpochMs): Result<{ maxBytes: number }, MediaRejectReason> {
  const fail = (error: MediaRejectReason): Result<{ maxBytes: number }, MediaRejectReason> => ({ ok: false, error });
  const { request } = input;
  if (!input.verifiedAttendee) return fail('not_verified_attendee');
  const w = mediaUploadWindow(input.game, config);
  if (now < toEpochMs(w.opensAt)) return fail('window_not_open');
  if (now > toEpochMs(w.closesAt)) return fail('window_closed');
  const types = MEDIA_MIME_TYPES[request.kind] as readonly string[] | undefined;
  if (!types || !types.includes(request.mimeType.toLowerCase())) return fail('unsupported_type');
  if (request.kind === 'video' && (request.durationSeconds == null || !(request.durationSeconds >= 0))) return fail('unsupported_type');
  const maxBytes = (request.kind === 'photo' ? config.mediaPhotoMaxMb : config.mediaVideoMaxMb) * MB;
  if (!(request.sizeBytes > 0) || request.sizeBytes > maxBytes) return fail('too_large');
  if (request.kind === 'video' && (request.durationSeconds as number) > config.mediaVideoMaxSeconds) return fail('too_long');
  if (input.existingCount >= config.mediaMaxItemsPerUserPerGame) return fail('user_cap_reached');
  return { ok: true, value: { maxBytes } };
}

/** The DataPort `ErrorCode` for a reject reason (the reason goes in `StError.details.reason`). */
export function mediaRejectErrorCode(reason: MediaRejectReason): ErrorCode {
  switch (reason) {
    case 'not_verified_attendee':
    case 'not_uploader':
      return 'forbidden';
    case 'window_not_open':
    case 'window_closed':
      return 'outside_window';
    case 'user_cap_reached':
      return 'rate_limited';
    case 'not_published':
    case 'tags_pending':
      return 'conflict';
    default:
      return 'validation';
  }
}

/** `ms + months` calendar months (UTC), clamping the day (Jan 31 + 1 → Feb 28/29). */
export function addMonthsUtc(ms: EpochMs, months: number): EpochMs {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/** VAULT-007 retention end. `proUntil`: end of the uploader's Pro subscription, if any. */
export function mediaExpiresAt(createdAt: IsoDateTime, config: DomainConfig = DEFAULT_DOMAIN_CONFIG, proUntil?: IsoDateTime | null): IsoDateTime {
  const free = addMonthsUtc(toEpochMs(createdAt), config.mediaRetentionMonths);
  if (!proUntil) return toIso(free);
  return toIso(Math.max(free, toEpochMs(proUntil) + config.mediaProGraceDays * DAY_MS));
}

/** Tags (of this item) that still block `venue_public`: pending, declined, or vetoed. */
export function consentBlockers(tags: readonly MediaTag[]): UserId[] {
  return tags
    .filter((t) => t.status === 'requested' || t.status === 'declined' || (t.status === 'removed' && t.vetoPublic))
    .map((t) => t.userId)
    .sort();
}

/** VAULT-004: the visibility the item may have now. */
export function effectiveMediaVisibility(item: Pick<MediaItem, 'publicOptIn' | 'status'>, tags: readonly MediaTag[]): MediaVisibility {
  return item.publicOptIn && item.status === 'published' && consentBlockers(tags).length === 0 ? 'venue_public' : 'participants';
}

export interface MediaChange {
  item: MediaItem;
  tags: MediaTag[];
  effects: Phase15Effect[];
}

function withVisibility(item: MediaItem, tags: MediaTag[], effects: Phase15Effect[], now: EpochMs): MediaChange {
  const visibility = effectiveMediaVisibility(item, tags);
  if (visibility === item.visibility) return { item, tags, effects };
  return {
    item: { ...item, visibility },
    tags,
    effects: [...effects, { type: 'SetMediaVisibility', mediaId: item.id, visibility, dedupeKey: `media-visibility:${item.id}:${visibility}:${toIso(now)}` }],
  };
}

function tagEffect(tag: MediaTag, now: EpochMs): Phase15Effect {
  return { type: 'SetMediaTagStatus', mediaId: tag.mediaId, userId: tag.userId, status: tag.status, dedupeKey: `media-tag:${tag.mediaId}:${tag.userId}:${tag.status}:${toIso(now)}` };
}

/**
 * The uploader sets the visibility they want. `venue_public` stores the opt-in
 * and is applied only once every tag is accepted (AC-VAULT-004/005); the
 * result's `pendingUserIds` explains why it is still `participants`. Rejects
 * `not_uploader`, `not_published` (blocked or removed items).
 */
export function requestMediaVisibility(
  item: MediaItem,
  tags: readonly MediaTag[],
  requested: MediaVisibility,
  actorId: UserId,
  now: EpochMs,
): Result<MediaChange & { pendingUserIds: UserId[] }, MediaRejectReason> {
  if (actorId !== item.uploaderId) return { ok: false, error: 'not_uploader' };
  if (item.status === 'blocked' || item.status === 'removed') return { ok: false, error: 'not_published' };
  const next = { ...item, publicOptIn: requested === 'venue_public' };
  const change = withVisibility(next, [...tags], [], now);
  return { ok: true, value: { ...change, pendingUserIds: requested === 'venue_public' ? consentBlockers(tags) : [] } };
}

export interface TagContext {
  /** Approved participants of the game (only they can be tagged). */
  participantIds: readonly UserId[];
  blocks: readonly Pick<Block, 'blockerId' | 'blockedId'>[];
}

/**
 * The uploader tags co-participants. Each tag is a request, invisible until
 * accepted (VAULT-005). Rejects `forbidden` (not the uploader, or a target who
 * is not a participant), `blocked` (a blocked pair), `validation` (self, empty,
 * duplicates), `conflict` (already tagged and not removed). A previously
 * removed tag is re-requested.
 */
export function tagMedia(item: MediaItem, tags: readonly MediaTag[], userIds: readonly UserId[], actorId: UserId, ctx: TagContext, now: EpochMs): Result<MediaChange, ErrorCode> {
  if (actorId !== item.uploaderId) return { ok: false, error: 'forbidden' };
  if (item.status === 'blocked' || item.status === 'removed') return { ok: false, error: 'conflict' };
  if (userIds.length === 0 || new Set(userIds).size !== userIds.length || userIds.includes(actorId)) return { ok: false, error: 'validation' };
  const blocked = (u: UserId) => ctx.blocks.some((b) => (b.blockerId === u && b.blockedId === actorId) || (b.blockerId === actorId && b.blockedId === u));
  for (const u of userIds) {
    if (!ctx.participantIds.includes(u)) return { ok: false, error: 'forbidden' };
    if (blocked(u)) return { ok: false, error: 'blocked' };
    const t = tags.find((x) => x.userId === u);
    if (t && t.status !== 'removed') return { ok: false, error: 'conflict' };
  }
  const at = toIso(now);
  const all = tags.filter((t) => !userIds.includes(t.userId));
  const effects: Phase15Effect[] = [];
  for (const u of [...userIds].sort()) {
    const prev = tags.find((x) => x.userId === u);
    const tag: MediaTag = { mediaId: item.id, userId: u, taggedBy: actorId, status: 'requested', vetoPublic: prev?.vetoPublic ?? false, createdAt: at, decidedAt: null };
    all.push(tag);
    effects.push(tagEffect(tag, now), {
      type: 'Notify15',
      userId: u,
      kind: 'media_tag_request',
      params: { mediaId: item.id },
      gameId: item.gameId,
      seriesId: null,
      dedupeKey: `notify:media_tag_request:${item.id}:${u}:${at}`,
    });
  }
  return { ok: true, value: withVisibility(item, all, effects, now) };
}

function updateTag(item: MediaItem, tags: readonly MediaTag[], userId: UserId, patch: Partial<MediaTag>, now: EpochMs): MediaChange {
  const next = tags.map((t) => (t.userId === userId ? { ...t, ...patch } : t));
  const tag = next.find((t) => t.userId === userId) as MediaTag;
  return withVisibility(item, next, [tagEffect(tag, now)], now);
}

/** The tagged user accepts or declines a pending tag (a decline vetoes `venue_public`). Rejects `not_found`. */
export function respondToMediaTag(item: MediaItem, tags: readonly MediaTag[], userId: UserId, accept: boolean, now: EpochMs): Result<MediaChange, ErrorCode> {
  const tag = tags.find((t) => t.userId === userId);
  if (tag?.status !== 'requested') return { ok: false, error: 'not_found' };
  const patch: Partial<MediaTag> = accept ? { status: 'accepted', decidedAt: toIso(now) } : { status: 'declined', vetoPublic: true, decidedAt: toIso(now) };
  return { ok: true, value: updateTag(item, tags, userId, patch, now) };
}

/**
 * The tagged user untags themselves at any time (VAULT-005). With
 * `removeFromPublic` the item also leaves (and can never re-enter)
 * `venue_public`. Rejects `not_found` when not tagged.
 */
export function untagMe(item: MediaItem, tags: readonly MediaTag[], userId: UserId, removeFromPublic: boolean, now: EpochMs): Result<MediaChange, ErrorCode> {
  const tag = tags.find((t) => t.userId === userId);
  if (!tag || tag.status === 'removed') return { ok: false, error: 'not_found' };
  return { ok: true, value: updateTag(item, tags, userId, { status: 'removed', vetoPublic: tag.vetoPublic || removeFromPublic, decidedAt: toIso(now) }, now) };
}

/** The uploader removes a tag (the "or is untagged" path of AC-VAULT-004). A prior veto persists. */
export function removeMediaTag(item: MediaItem, tags: readonly MediaTag[], actorId: UserId, userId: UserId, now: EpochMs): Result<MediaChange, ErrorCode> {
  if (actorId !== item.uploaderId) return { ok: false, error: 'forbidden' };
  const tag = tags.find((t) => t.userId === userId);
  if (!tag || tag.status === 'removed') return { ok: false, error: 'not_found' };
  return { ok: true, value: updateTag(item, tags, userId, { status: 'removed', decidedAt: toIso(now) }, now) };
}

/** VAULT-007: on account deletion every tag of the user is removed with a veto; visibility is recomputed per item. */
export function untagDeletedAccount(
  userId: UserId,
  items: readonly { item: MediaItem; tags: readonly MediaTag[] }[],
  now: EpochMs,
): Phase15Effect[] {
  const effects: Phase15Effect[] = [];
  for (const { item, tags } of items) {
    const tag = tags.find((t) => t.userId === userId);
    if (!tag || (tag.status === 'removed' && tag.vetoPublic)) continue;
    effects.push(...updateTag(item, tags, userId, { status: 'removed', vetoPublic: true, decidedAt: toIso(now) }, now).effects);
  }
  return effects;
}

/**
 * Applies the pre-publication verdict to a `processing` item (other statuses
 * are left unchanged). `publish` → `published` at the allowed visibility;
 * `block` → `blocked` + `media_blocked` notice; `csam` → `blocked`, evidence
 * preserved, account restricted, P0 `media_csam` review, audit, and no notice
 * to the uploader (AC-VAULT-003).
 */
export function applyMediaVerdict(item: MediaItem, tags: readonly MediaTag[], verdict: MediaModerationVerdict, now: EpochMs): MediaChange {
  if (item.status !== 'processing') return { item, tags: [...tags], effects: [] };
  const at = toIso(now);
  if (verdict.decision === 'publish') {
    const published = { ...item, status: 'published' as const, publishedAt: at };
    return withVisibility(published, [...tags], [{ type: 'SetMediaStatus', mediaId: item.id, status: 'published', dedupeKey: `media-status:${item.id}:published` }], now);
  }
  const blocked: MediaItem = { ...item, status: 'blocked', visibility: 'participants' };
  const effects: Phase15Effect[] = [{ type: 'SetMediaStatus', mediaId: item.id, status: 'blocked', dedupeKey: `media-status:${item.id}:blocked` }];
  if (verdict.decision === 'block') {
    effects.push({
      type: 'Notify15',
      userId: item.uploaderId,
      kind: 'media_blocked',
      params: { mediaId: item.id, reasonKey: verdict.reasonKey ?? 'media.blocked.policy' },
      gameId: item.gameId,
      seriesId: null,
      dedupeKey: `notify:media_blocked:${item.id}`,
    });
    return { item: blocked, tags: [...tags], effects };
  }
  const dedupeKey = `media_csam:${item.id}`;
  effects.push(
    { type: 'PreserveMediaEvidence', mediaId: item.id, uploaderId: item.uploaderId, dedupeKey: `preserve:${item.id}` },
    { type: 'RestrictAccountPendingReview', userId: item.uploaderId, reason: 'csam_match', dedupeKey: `restrict:${dedupeKey}` },
    {
      type: 'EnqueueReview',
      item: {
        kind: 'media_csam',
        priority: 'high',
        subjectUserId: item.uploaderId,
        venueId: item.venueId,
        gameId: item.gameId,
        sanctionId: null,
        appealId: null,
        reportIds: [],
        evidence: { mediaId: item.id, csamHashMatch: verdict.csamHashMatch, source: verdict.source },
        dueBy: toIso(now + SEVERE_REPORT_SLA_HOURS * HOUR_MS),
        dedupeKey,
      },
    },
    { type: 'Audit', action: 'media.csam_blocked', subjectUserId: item.uploaderId, data: { mediaId: item.id, gameId: item.gameId } },
  );
  return { item: blocked, tags: [...tags], effects };
}

/** Uploader (or moderator) deletion: `removed` + object deletion. Rejects `forbidden`, `not_found` (already removed). */
export function deleteMedia(item: MediaItem, actorId: UserId, isModerator: boolean, now: EpochMs): Result<{ item: MediaItem; effects: Phase15Effect[] }, ErrorCode> {
  if (actorId !== item.uploaderId && !isModerator) return { ok: false, error: 'forbidden' };
  if (item.status === 'removed') return { ok: false, error: 'not_found' };
  return { ok: true, value: removal(item, now) };
}

function removal(item: MediaItem, now: EpochMs): { item: MediaItem; effects: Phase15Effect[] } {
  const effects: Phase15Effect[] = [{ type: 'SetMediaStatus', mediaId: item.id, status: 'removed', dedupeKey: `media-status:${item.id}:removed` }];
  // CSAM evidence is under legal hold: blocked objects are never deleted here.
  if (item.status !== 'blocked') effects.push({ type: 'DeleteMediaObject', mediaId: item.id, storagePath: item.storagePath, dedupeKey: `media-delete:${item.id}` });
  return { item: { ...item, status: 'removed', visibility: 'participants', removedAt: toIso(now) }, effects };
}

/** Retention sweep (VAULT-007): every non-removed item with `expiresAt ≤ now`. */
export function expireMedia(items: readonly MediaItem[], now: EpochMs): Phase15Effect[] {
  return items
    .filter((i) => i.status !== 'removed' && i.status !== 'blocked' && toEpochMs(i.expiresAt) <= now)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) || (a.id < b.id ? -1 : 1))
    .flatMap((i) => removal(i, now).effects);
}
