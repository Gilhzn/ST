/**
 * Phase 1.5 (contract v3) rows → contract types. Table/view rows are snake_case
 * (`series_views`, `series_occurrences`, `series_roster`, `media_tags`,
 * `peer_ratings`, `rating_updates`); JSONB RPC results (`st_media_json`,
 * `st_connection_view`, `dm_*` mirrors, `migration_stats`, `get_invite_preview`)
 * are already camelCase and only need defensive typing.
 */
import type {
  ConnectionView,
  GameSeries,
  MediaItem,
  MediaTag,
  NetworkPrivacy,
  PeerRating,
  PublicProfile,
  RatingUpdate,
  RosterMember,
  SeriesOccurrence,
  SkillRating,
} from '@st/domain';

import type { Row } from './mappers';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 't' || v === 'true';
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** `series_views` row → GameSeries (exact pin and token already masked by the view). */
export function mapSeries(r: Row): GameSeries {
  const hasExact = r.lat != null && r.lng != null;
  return {
    id: str(r.id),
    hostId: str(r.host_id),
    sport: str(r.sport) as GameSeries['sport'],
    title: str(r.title),
    notes: strOrNull(r.notes),
    visibility: (str(r.visibility) || 'public') as GameSeries['visibility'],
    venueId: strOrNull(r.venue_id),
    location: hasExact ? { lat: num(r.lat), lng: num(r.lng) } : null,
    approxLocation: { lat: num(r.approx_lat), lng: num(r.approx_lng) },
    hideExactLocation: bool(r.hide_exact_location),
    capacity: num(r.capacity),
    minPlayers: num(r.min_players ?? 2),
    depositMinor: num(r.deposit_minor),
    currency: str(r.currency),
    depositForfeitTo: (str(r.deposit_forfeit_to) || 'pot') as GameSeries['depositForfeitTo'],
    womenOnly: bool(r.women_only),
    teamCount: num(r.team_count ?? 2),
    recurrence: (str(r.recurrence) || 'weekly') as GameSeries['recurrence'],
    weekday: num(r.weekday) as GameSeries['weekday'],
    startTime: str(r.start_time).slice(0, 5),
    timeZone: str(r.time_zone),
    durationMinutes: num(r.duration_minutes),
    anchorDate: str(r.anchor_date),
    endDate: strOrNull(r.end_date),
    horizonWeeks: num(r.horizon_weeks ?? 4),
    rosterPriorityHours: num(r.roster_priority_hours ?? 24),
    autoJoinReconfirmHours: num(r.auto_join_reconfirm_hours ?? 48),
    skippedDates: arr<string>(r.skipped_dates),
    scheduleRevision: num(r.schedule_revision),
    status: (str(r.status) || 'active') as GameSeries['status'],
    inviteToken: strOrNull(r.invite_token),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at ?? r.created_at),
  };
}

/** `resolve_series_invite` JSON (masked like `series_views` for a non-member) → GameSeries. */
export function mapResolvedSeries(j: Record<string, unknown>): GameSeries {
  const approx = (j.approxLocation ?? {}) as { lat?: number; lng?: number };
  return {
    ...mapSeries({}),
    id: str(j.id),
    hostId: str(j.hostId),
    sport: str(j.sport) as GameSeries['sport'],
    title: str(j.title),
    visibility: (str(j.visibility) || 'public') as GameSeries['visibility'],
    approxLocation: { lat: num(approx.lat), lng: num(approx.lng) },
    hideExactLocation: bool(j.hideExactLocation),
    capacity: num(j.capacity),
    womenOnly: bool(j.womenOnly),
    recurrence: (str(j.recurrence) || 'weekly') as GameSeries['recurrence'],
    weekday: num(j.weekday) as GameSeries['weekday'],
    startTime: str(j.startTime),
    timeZone: str(j.timeZone),
    durationMinutes: num(j.durationMinutes),
    status: (str(j.status) || 'active') as GameSeries['status'],
    depositMinor: num(j.depositMinor),
    currency: str(j.currency),
  };
}

export function mapOccurrence(r: Row): SeriesOccurrence {
  return {
    seriesId: str(r.series_id),
    occurrenceKey: str(r.occurrence_key),
    slotDate: str(r.slot_date),
    scheduleRevision: num(r.schedule_revision),
    gameId: str(r.game_id),
    startsAt: str(r.starts_at),
    endsAt: str(r.ends_at),
    opensAt: str(r.opens_at),
    priorityUntil: str(r.priority_until),
    reconfirmAt: str(r.reconfirm_at),
    releaseAt: str(r.release_at),
    status: (str(r.status) || 'scheduled') as SeriesOccurrence['status'],
    overridden: bool(r.overridden),
  };
}

export function mapRosterMember(r: Row): RosterMember {
  return {
    seriesId: str(r.series_id),
    userId: str(r.user_id),
    status: (str(r.status) || 'regular') as RosterMember['status'],
    alwaysIn: bool(r.always_in),
    joinedVia: (str(r.joined_via) || 'invite_link') as RosterMember['joinedVia'],
    consecutiveMisses: num(r.consecutive_misses),
    leaveOfferedAt: strOrNull(r.leave_offered_at),
    joinedAt: str(r.joined_at),
    leftAt: strOrNull(r.left_at),
  };
}

export function mapPeerRating(r: Row): PeerRating {
  return {
    gameId: str(r.game_id),
    sport: str(r.sport) as PeerRating['sport'],
    raterId: str(r.rater_id),
    rateeId: str(r.ratee_id),
    scores: (r.scores && typeof r.scores === 'object' ? r.scores : {}) as PeerRating['scores'],
    createdAt: str(r.created_at),
  };
}

export function mapRatingUpdate(r: Row): RatingUpdate {
  return {
    userId: str(r.user_id),
    sport: str(r.sport) as RatingUpdate['sport'],
    formatFamily: str(r.format_family) as RatingUpdate['formatFamily'],
    period: str(r.period),
    before: { r: num(r.r_before), rd: num(r.rd_before), sigma: num(r.sigma_before) },
    after: { r: num(r.r_after), rd: num(r.rd_after), sigma: num(r.sigma_after) },
    gamesAdded: num(r.games_added),
    frozen: bool(r.frozen),
    dedupeKey: str(r.dedupe_key),
  };
}

/** `my_skill_ratings` element (camelCase, plus `frozen`). */
export function mapSkillRating(j: Record<string, unknown>): SkillRating {
  return {
    userId: str(j.userId),
    sport: str(j.sport) as SkillRating['sport'],
    formatFamily: str(j.formatFamily) as SkillRating['formatFamily'],
    r: num(j.r),
    rd: num(j.rd),
    sigma: num(j.sigma),
    games: num(j.games),
    provisional: bool(j.provisional),
    level: num(j.level),
    lastPeriod: strOrNull(j.lastPeriod),
    updatedAt: str(j.updatedAt),
  };
}

export function mapMediaTag(r: Row): MediaTag {
  return {
    mediaId: str(r.media_id ?? r.mediaId),
    userId: str(r.user_id ?? r.userId),
    taggedBy: str(r.tagged_by ?? r.taggedBy),
    status: (str(r.status) || 'requested') as MediaTag['status'],
    vetoPublic: bool(r.veto_public ?? r.vetoPublic),
    createdAt: str(r.created_at ?? r.createdAt),
    decidedAt: strOrNull(r.decided_at ?? r.decidedAt),
  };
}

/** `st_media_json` (camelCase) or a `media_items` row (snake_case) → MediaItem. */
export function mapMediaItem(j: Row): MediaItem & { thumbnailPath: string | null; pendingUserIds: string[]; acceptedTags: string[] } {
  const pick = (camel: string, snake: string) => (j[camel] !== undefined ? j[camel] : j[snake]);
  return {
    id: str(j.id),
    gameId: str(pick('gameId', 'game_id')),
    venueId: strOrNull(pick('venueId', 'venue_id')),
    uploaderId: str(pick('uploaderId', 'uploader_id')),
    kind: (str(j.kind) || 'photo') as MediaItem['kind'],
    status: (str(j.status) || 'processing') as MediaItem['status'],
    visibility: (str(j.visibility) || 'participants') as MediaItem['visibility'],
    publicOptIn: bool(pick('publicOptIn', 'public_opt_in')),
    mimeType: str(pick('mimeType', 'mime_type')),
    sizeBytes: num(pick('sizeBytes', 'size_bytes')),
    durationSeconds: numOrNull(pick('durationSeconds', 'duration_seconds')),
    storagePath: str(pick('storagePath', 'published_path') ?? j.storage_path),
    createdAt: str(pick('createdAt', 'created_at')),
    publishedAt: strOrNull(pick('publishedAt', 'published_at')),
    expiresAt: str(pick('expiresAt', 'expires_at')),
    removedAt: strOrNull(pick('removedAt', 'removed_at')),
    thumbnailPath: strOrNull(pick('thumbnailPath', 'thumbnail_path')),
    pendingUserIds: arr<string>(j.pendingUserIds),
    acceptedTags: arr<string>(j.acceptedTags),
  };
}

export function mapConnectionView(j: Record<string, unknown>): ConnectionView {
  return {
    user: j.user as PublicProfile,
    playedWith: bool(j.playedWith),
    gamesTogether: num(j.gamesTogether),
    lastPlayedAt: strOrNull(j.lastPlayedAt),
    friend: (str(j.friend) || 'none') as ConnectionView['friend'],
  };
}

export function mapNetworkPrivacy(j: Record<string, unknown>): NetworkPrivacy {
  return {
    userId: str(j.userId),
    upcomingGamesVisibleTo: (str(j.upcomingGamesVisibleTo) || 'friends') as NetworkPrivacy['upcomingGamesVisibleTo'],
    updatedAt: str(j.updatedAt),
  };
}
