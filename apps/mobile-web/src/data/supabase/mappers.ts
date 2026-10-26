/**
 * snake_case Postgres rows → camelCase contract types (docs/architecture.md §3 rule 3).
 * Coordinates arrive as separate `lat`/`lng` columns from the definer views
 * (`game_views`, `venue_views`) and RPCs, never as raw PostGIS values.
 */
import type {
  Appeal,
  ChatMessage,
  GameResult,
  GameSummary,
  Notification,
  Participant,
  Payment,
  Profile,
  PublicProfile,
  QrToken,
  Sanction,
  UserReport,
  UserSport,
  Venue,
  VenueRating,
  VenueReport,
} from '@st/domain';

/** A loosely typed row as returned by PostgREST. */
export type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 't' || v === 'true';
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = <T extends object>(v: unknown): T => (v && typeof v === 'object' ? (v as T) : ({} as T));

export function mapProfile(r: Row): Profile {
  return {
    id: str(r.id),
    displayName: str(r.display_name),
    avatarUrl: strOrNull(r.avatar_url),
    bio: strOrNull(r.bio),
    locale: str(r.locale) as Profile['locale'],
    countryCode: strOrNull(r.country_code),
    reliability: {
      score: numOrNull(r.reliability_score),
      status: (str(r.reliability_status) || 'new') as Profile['reliability']['status'],
      verifiedCount: num(r.reliability_verified_count),
      commitmentCount: num(r.reliability_commitment_count),
      lateCancelCount: num(r.reliability_late_cancel_count),
      noShowCount: num(r.reliability_no_show_count),
      computedAt: str(r.reliability_computed_at),
    },
    verifiedHost: bool(r.verified_host),
    chatMutedUntil: strOrNull(r.chat_muted_until),
    joinBannedUntil: strOrNull(r.join_banned_until),
    hostSuspendedUntil: strOrNull(r.host_suspended_until),
    visibilityRestrictedUntil: strOrNull(r.visibility_restricted_until),
    permanentlyBanned: bool(r.permanently_banned),
    createdAt: str(r.created_at),
  };
}

export function mapPublicProfile(r: Row): PublicProfile {
  return {
    id: str(r.id),
    displayName: str(r.display_name),
    avatarUrl: strOrNull(r.avatar_url),
    reliabilityScore: numOrNull(r.reliability_score),
    reliabilityStatus: (str(r.reliability_status) || 'new') as PublicProfile['reliabilityStatus'],
    verifiedHost: bool(r.verified_host),
    memberSince: str(r.member_since ?? r.created_at),
  };
}

export function mapUserSport(r: Row): UserSport {
  return {
    userId: str(r.user_id),
    sport: str(r.sport),
    selfSkill: num(r.self_skill),
    attributes: obj(r.attributes),
    positions: arr<string>(r.positions),
  } as UserSport;
}

export function mapVenue(r: Row): Venue {
  return {
    id: str(r.id),
    name: str(r.name),
    location: { lat: num(r.lat), lng: num(r.lng) },
    address: strOrNull(r.address),
    countryCode: strOrNull(r.country_code),
    sports: arr(r.sports),
    status: str(r.status) as Venue['status'],
    ratingAvg: numOrNull(r.rating_avg),
    ratingCount: num(r.rating_count),
    createdBy: strOrNull(r.created_by),
    createdAt: str(r.created_at),
  };
}

export function mapGameSummary(r: Row): GameSummary {
  const hasExact = r.lat != null && r.lng != null;
  return {
    id: str(r.id),
    hostId: str(r.host_id),
    sport: str(r.sport) as GameSummary['sport'],
    title: str(r.title),
    notes: strOrNull(r.notes),
    visibility: str(r.visibility) as GameSummary['visibility'],
    venueId: strOrNull(r.venue_id),
    location: hasExact ? { lat: num(r.lat), lng: num(r.lng) } : null,
    approxLocation: { lat: num(r.approx_lat), lng: num(r.approx_lng) },
    hideExactLocation: bool(r.hide_exact_location),
    capacity: num(r.capacity),
    minPlayers: num(r.min_players ?? 2),
    startsAt: str(r.starts_at),
    endsAt: str(r.ends_at),
    depositMinor: num(r.deposit_minor),
    currency: str(r.currency),
    depositForfeitTo: (str(r.deposit_forfeit_to) || 'pot') as GameSummary['depositForfeitTo'],
    womenOnly: bool(r.women_only),
    status: str(r.status) as GameSummary['status'],
    teamCount: num(r.team_count),
    inviteToken: strOrNull(r.invite_token),
    createdAt: str(r.created_at),
    approvedCount: num(r.approved_count),
    waitlistCount: num(r.waitlist_count),
    seriesId: strOrNull(r.series_id),
  };
}

export function mapParticipant(r: Row): Participant {
  return {
    gameId: str(r.game_id),
    userId: str(r.user_id),
    status: str(r.status) as Participant['status'],
    attendance: (str(r.attendance) || 'unknown') as Participant['attendance'],
    team: numOrNull(r.team),
    position: strOrNull(r.position) as Participant['position'],
    waitlistRank: numOrNull(r.waitlist_rank),
    lateCancel: bool(r.late_cancel),
    lateCancelRefilled: bool(r.late_cancel_refilled),
    offeredAt: strOrNull(r.offered_at),
    offerExpiresAt: strOrNull(r.offer_expires_at),
    offerMode: strOrNull(r.offer_mode) as Participant['offerMode'],
    paymentReady: r.payment_ready == null ? true : bool(r.payment_ready),
    checkInMethod: strOrNull(r.check_in_method) as Participant['checkInMethod'],
    checkedInAt: strOrNull(r.checked_in_at),
    requestedAt: str(r.requested_at),
    decidedAt: strOrNull(r.decided_at),
    cancelledAt: strOrNull(r.cancelled_at),
  };
}

export function mapSanction(r: Row): Sanction {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    kind: str(r.kind),
    reasonCode: str(r.reason_code),
    statementKey: str(r.statement_key || `sanctions.reason.${str(r.reason_code)}`),
    statementParams: obj(r.statement_params),
    startsAt: str(r.starts_at),
    expiresAt: strOrNull(r.expires_at),
    disputeUntil: strOrNull(r.dispute_until),
    appealPath: str(r.appeal_path) || (r.dispute_until ? 'dispute' : 'appeal'),
    overturnedAt: strOrNull(r.overturned_at),
    status: str(r.status),
    gameId: strOrNull(r.game_id),
    causedBy: arr<string>(r.caused_by),
    dedupeKey: str(r.dedupe_key),
    createdAt: str(r.created_at),
    decidedBy: str(r.decided_by) || 'system',
  } as unknown as Sanction;
}

export function mapAppeal(r: Row): Appeal {
  return {
    id: str(r.id),
    sanctionId: str(r.sanction_id),
    userId: str(r.user_id),
    text: str(r.text),
    isDispute: bool(r.is_dispute),
    status: str(r.status) as Appeal['status'],
    decidedBy: strOrNull(r.decided_by),
    decisionNote: strOrNull(r.decision_note),
    decidedAt: strOrNull(r.decided_at),
    createdAt: str(r.created_at),
  };
}

export function mapMessage(r: Row): ChatMessage {
  return {
    id: str(r.id),
    gameId: str(r.game_id),
    senderId: str(r.sender_id),
    body: str(r.body),
    lang: strOrNull(r.lang),
    clientMsgId: str(r.client_msg_id),
    moderation: (str(r.moderation) || 'allow') as ChatMessage['moderation'],
    retractedAt: strOrNull(r.retracted_at),
    createdAt: str(r.created_at),
    expiresAt: str(r.expires_at),
  };
}

export function mapNotification(r: Row): Notification {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    kind: str(r.kind) as Notification['kind'],
    params: obj(r.params),
    gameId: strOrNull(r.game_id),
    sanctionId: strOrNull(r.sanction_id),
    readAt: strOrNull(r.read_at),
    createdAt: str(r.created_at),
  };
}

export function mapPayment(r: Row): Payment {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    gameId: str(r.game_id),
    purpose: 'deposit',
    amount: { amountMinor: num(r.amount_minor), currency: str(r.currency) },
    provider: str(r.provider) as Payment['provider'],
    providerRef: strOrNull(r.provider_ref),
    status: str(r.status) as Payment['status'],
    depositState: str(r.deposit_state) as Payment['depositState'],
    idempotencyKey: str(r.idempotency_key),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function mapResult(r: Row): GameResult {
  return {
    gameId: str(r.game_id),
    teamScores: arr<number>(r.team_scores).map(Number),
    submittedBy: str(r.submitted_by),
    submittedAt: str(r.submitted_at),
  };
}

export function mapVenueRating(r: Row): VenueRating {
  return {
    venueId: str(r.venue_id),
    userId: str(r.user_id),
    sport: str(r.sport),
    overall: num(r.overall),
    attributes: obj(r.attributes),
    createdAt: str(r.created_at),
  } as VenueRating;
}

export function mapVenueReport(r: Row): VenueReport {
  return {
    id: str(r.id),
    venueId: str(r.venue_id),
    reporterId: str(r.reporter_id),
    reason: str(r.reason) as VenueReport['reason'],
    note: strOrNull(r.note),
    createdAt: str(r.created_at),
  };
}

export function mapUserReport(r: Row): UserReport {
  return {
    id: str(r.id),
    reporterId: str(r.reporter_id),
    targetUserId: str(r.target_user_id),
    category: str(r.category) as UserReport['category'],
    gameId: strOrNull(r.game_id),
    messageId: strOrNull(r.message_id),
    note: strOrNull(r.note),
    createdAt: str(r.created_at),
  };
}

export function mapQrToken(r: Row): QrToken {
  return { token: str(r.token), step: num(r.step), expiresAt: str(r.expires_at ?? r.expiresAt) };
}
