/**
 * @packageDocumentation
 * Sport Talent shared contract.
 *
 * This module is the one source of truth for the shapes passed between the pure
 * domain logic (`@st/domain`), the database adapters (Supabase / InMemory), the
 * Expo app and the Supabase Edge Functions. It has **zero dependencies** and is
 * safe to bundle into Deno (Edge Functions), Hermes (native) and the browser.
 *
 * ## Conventions (read before using)
 * - **Ids** are plain `string` aliases (UUID v4 in Supabase, any unique string in
 *   the InMemory adapter). They are aliases, not branded types, so fixtures and
 *   tests do not need casts. Keep the alias names in signatures for readability.
 * - **Time:** every persisted or wire timestamp is an {@link IsoDateTime} (UTC,
 *   `toISOString()` format). The two exceptions are {@link GpsSample.timestamp}
 *   (epoch ms, as reported by the OS) and the `now: EpochMs` parameter that pure
 *   domain functions take. Convert with `Date.parse` / `new Date(ms).toISOString()`.
 * - **Money** is always an integer amount in the currency's minor unit
 *   (see {@link Money}). Never use floats for money.
 * - **Casing:** TypeScript uses camelCase; Postgres uses snake_case. Adapters map
 *   between them. String literal values (enum members) are identical in both.
 * - **Coordinates:** {@link LatLng} is `{ lat, lng }`. PostGIS and GeoJSON use
 *   `[lng, lat]` order; adapters must swap explicitly.
 * - **Nullability:** `null` means "known to be absent" (stored as SQL NULL);
 *   optional (`?`) is used only for inputs and for genuinely optional sensor data.
 * - **Stability:** changes to this file must be additive. Renaming or removing a
 *   member is a breaking change and requires bumping {@link CONTRACT_VERSION} and
 *   coordinating with every owner listed in `docs/agents.md`.
 */

/**
 * Incremented on any breaking change to this contract.
 *
 * - v2 (contract reconciliation, M3): `Game.minPlayers`; waitlist offer and
 *   refill fields on `Participant`; `Sanction.appealPath` / `overturnedAt`;
 *   `LateCancelFinalized` event; `BanAccount` effect; `waitlist_offer`
 *   notification; `spoofing_suspected` review kind; `PeerConfirmation`;
 *   17 PRD v5 `TrustConfig` fields; `hostSuspensionDays` 30 → 14 (PRD TRUST-051);
 *   `CancelResult.sanction` is always `null` (late cancels are decided at finalisation).
 */
export const CONTRACT_VERSION = 2 as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Auth user id (`auth.users.id`, equal to `profiles.id`). */
export type UserId = string;
/** `games.id` */
export type GameId = string;
/** `venues.id` */
export type VenueId = string;
/** `sanctions.id` */
export type SanctionId = string;
/** `appeals.id` */
export type AppealId = string;
/** `user_reports.id` */
export type UserReportId = string;
/** `venue_reports.id` */
export type VenueReportId = string;
/** `review_queue.id` */
export type ReviewItemId = string;
/** `chat_messages.id` */
export type MessageId = string;
/** `payments.id` */
export type PaymentId = string;
/** `notifications.id` */
export type NotificationId = string;

/** UTC timestamp in ISO-8601 format, e.g. `2026-10-26T18:00:00.000Z`. */
export type IsoDateTime = string;
/** Milliseconds since the Unix epoch. Used for sensor data and `now` parameters only. */
export type EpochMs = number;
/** Phone number in E.164 format, e.g. `+972501234567`. */
export type PhoneE164 = string;
/** ISO 4217 currency code, upper case, e.g. `EUR`, `ILS`, `USD`. */
export type CurrencyCode = string;
/** ISO 3166-1 alpha-2 country code, upper case, e.g. `IL`. */
export type CountryCode = string;

/** Integer star rating used for venues, skills and hosts. */
export type Stars = 1 | 2 | 3 | 4 | 5;

/** Function returned by every subscription; calling it twice is a no-op. */
export type Unsubscribe = () => void;

/**
 * Removes keys from each member of a union separately (the built-in `Omit`
 * collapses discriminated unions).
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Discriminated success/failure value for pure functions that can fail expectedly. */
export type Result<T, E = ErrorCode> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// ---------------------------------------------------------------------------
// Locales
// ---------------------------------------------------------------------------

/**
 * The 13 supported UI locales (the PRD's "12 languages", with Chinese split into
 * Simplified and Traditional). `en` is the source locale.
 */
export const LOCALES = [
  'en',
  'he',
  'ar',
  'es',
  'zh-Hans',
  'zh-Hant',
  'ja',
  'pt',
  'ru',
  'fr',
  'it',
  'de',
  'hi',
] as const;

/** One of the 13 supported UI locales. */
export type Locale = (typeof LOCALES)[number];

/** Locale used when the device locale is unsupported. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Locales that render right-to-left. */
export const RTL_LOCALES = ['he', 'ar'] as const satisfies readonly Locale[];

/** Type guard for {@link Locale}. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** True when the locale is written right-to-left. */
export function isRtlLocale(locale: Locale): boolean {
  return (RTL_LOCALES as readonly Locale[]).includes(locale);
}

// ---------------------------------------------------------------------------
// Sports, positions and venue rating attributes
// ---------------------------------------------------------------------------

/**
 * Supported sports. To add a sport: append it here, add its entries to
 * {@link SPORT_POSITIONS} and {@link VENUE_RATING_ATTRIBUTES}, seed the `sports`
 * table, and add i18n keys `sports:<id>.*`. The compiler flags every missing entry.
 */
export const SPORT_IDS = ['football', 'basketball', 'tennis', 'padel', 'running', 'volleyball'] as const;

/** A sport identifier. Matches `sports.id`. */
export type SportId = (typeof SPORT_IDS)[number];

/** Type guard for {@link SportId}. */
export function isSportId(value: unknown): value is SportId {
  return typeof value === 'string' && (SPORT_IDS as readonly string[]).includes(value);
}

/**
 * Positions per sport, in display order. An empty list means the sport has no
 * positions (squad balancing then uses ratings only). `sports.positions` in the
 * database must match.
 */
export const SPORT_POSITIONS = {
  football: ['goalkeeper', 'defender', 'midfielder', 'forward'],
  basketball: ['point_guard', 'shooting_guard', 'small_forward', 'power_forward', 'center'],
  tennis: [],
  padel: ['left_side', 'right_side'],
  running: [],
  volleyball: ['setter', 'outside_hitter', 'opposite', 'middle_blocker', 'libero'],
} as const satisfies Record<SportId, readonly string[]>;

/** Positions valid for sport `S`, e.g. `Position<'football'>` is `'goalkeeper' | ...`. */
export type Position<S extends SportId = SportId> = S extends SportId
  ? (typeof SPORT_POSITIONS)[S][number]
  : never;

/** Any position of any sport. Prefer {@link Position} when the sport is known. */
export type PositionId = Position<SportId>;

/**
 * Positions that squad balancing must spread across teams first (e.g. one
 * goalkeeper per team). Sports not listed have none.
 */
export const SCARCE_POSITIONS: { readonly [S in SportId]?: readonly Position<S>[] } = {
  football: ['goalkeeper'],
  basketball: ['center'],
  volleyball: ['setter', 'libero'],
};

/**
 * Descriptor of one venue rating attribute: `'score'` is rated 1–5 stars; an
 * array is a categorical choice between those values.
 */
export type VenueAttributeDescriptor = 'score' | readonly string[];

/**
 * Sport-specific venue rating attributes (PRD §2: grass, lighting, nets; tennis
 * surface clay/hard/grass; basketball hoops and nets). The DB trigger on
 * `venue_ratings` validates `attributes` against `sports.rating_attributes`, which
 * must mirror this table.
 */
export const VENUE_RATING_ATTRIBUTES = {
  football: {
    surface: ['natural_grass', 'artificial_turf', 'hard', 'indoor'],
    lighting: 'score',
    goals_nets: 'score',
  },
  basketball: {
    surface: ['outdoor_hard', 'indoor_wood', 'rubber'],
    hoops: 'score',
    nets: 'score',
    lighting: 'score',
  },
  tennis: {
    surface: ['clay', 'hard', 'grass', 'carpet'],
    nets: 'score',
    lighting: 'score',
  },
  padel: {
    walls: ['glass', 'masonry'],
    surface: ['artificial_turf', 'hard'],
    lighting: 'score',
  },
  running: {
    surface: ['track', 'road', 'trail', 'mixed'],
    lighting: 'score',
    water_access: 'score',
  },
  volleyball: {
    surface: ['sand', 'indoor', 'grass'],
    net: 'score',
    lighting: 'score',
  },
} as const satisfies Record<SportId, Record<string, VenueAttributeDescriptor>>;

type AttributeValue<D> = D extends 'score' ? Stars : D extends readonly (infer V)[] ? V : never;

/**
 * The attribute map for a rating of sport `S`. Every attribute is optional: a
 * rater may skip any of them.
 */
export type VenueRatingAttributes<S extends SportId = SportId> = S extends SportId
  ? {
      [K in keyof (typeof VENUE_RATING_ATTRIBUTES)[S]]?: AttributeValue<(typeof VENUE_RATING_ATTRIBUTES)[S][K]>;
    }
  : never;

// ---------------------------------------------------------------------------
// Geo and map
// ---------------------------------------------------------------------------

/** WGS-84 coordinate in decimal degrees. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Allowed map search radii (PRD §2). */
export const RADII_KM = [1, 2, 5, 10, 30, 50] as const;

/** A map search radius in kilometres. */
export type RadiusKm = (typeof RADII_KM)[number];

/** Radius used when the user has not picked one. */
export const DEFAULT_RADIUS_KM: RadiusKm = 5;

/** Type guard for {@link RadiusKm}. */
export function isRadiusKm(value: unknown): value is RadiusKm {
  return typeof value === 'number' && (RADII_KM as readonly number[]).includes(value);
}

/** Maximum number of sports in a map filter at once (PRD §2). Enforced by the RPCs too. */
export const MAX_SPORT_FILTERS = 3;

/** Minimum user age at launch (compliance: 16+). */
export const MIN_AGE_YEARS = 16;

// ---------------------------------------------------------------------------
// Profiles and users
// ---------------------------------------------------------------------------

/** Self-declared gender. Stored privately; used only to enforce women-only games. */
export type Gender = 'female' | 'male' | 'non_binary' | 'undisclosed';

/**
 * Reliability traffic light shown on profiles and join requests.
 * - `new`: fewer than {@link TrustConfig.reliabilityMinGames} commitments.
 * - `green`: no active yellow card and score ≥ {@link TrustConfig.reliabilityGreenMin}.
 * - `red`: an active join ban, or score < {@link TrustConfig.reliabilityRedBelow}.
 * - `yellow`: otherwise.
 */
export type ReliabilityStatus = 'green' | 'yellow' | 'red' | 'new';

/**
 * Reliability over the last {@link TrustConfig.reliabilityWindowDays} days.
 * `score = (verified + prior) / (commitments + prior)` where a late cancel adds
 * {@link TrustConfig.reliabilityLateCancelWeight} to `commitments` and a no-show
 * adds 1; `prior` is {@link TrustConfig.reliabilityPrior}.
 */
export interface ReliabilitySnapshot {
  /** 0..1, or `null` when status is `new`. */
  score: number | null;
  status: ReliabilityStatus;
  /** Approved participations with attendance `verified`. */
  verifiedCount: number;
  /** Approved participations whose game has ended, plus late cancels. */
  commitmentCount: number;
  lateCancelCount: number;
  noShowCount: number;
  computedAt: IsoDateTime;
}

/**
 * The signed-in user's own profile (`profiles` row). Trust columns are
 * read-only for clients and written only by SECURITY DEFINER RPCs / service role.
 */
export interface Profile {
  id: UserId;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  /** Preferred UI language. */
  locale: Locale;
  /** Home country (for currency and default payment methods), if known. */
  countryCode: CountryCode | null;
  reliability: ReliabilitySnapshot;
  /** Identity-verified host badge (manual / KYC via payments provider). */
  verifiedHost: boolean;
  /** Denormalised from active sanctions; `null` when not restricted. */
  chatMutedUntil: IsoDateTime | null;
  joinBannedUntil: IsoDateTime | null;
  hostSuspendedUntil: IsoDateTime | null;
  visibilityRestrictedUntil: IsoDateTime | null;
  /** True while a moderator-issued permanent ban is in force. */
  permanentlyBanned: boolean;
  createdAt: IsoDateTime;
}

/** Fields of another user anyone may see (`public_profiles` view). */
export interface PublicProfile {
  id: UserId;
  displayName: string;
  avatarUrl: string | null;
  reliabilityScore: number | null;
  reliabilityStatus: ReliabilityStatus;
  verifiedHost: boolean;
  memberSince: IsoDateTime;
}

/** Private profile data (`profile_private`, owner-only RLS). Never exposed to other users. */
export interface ProfilePrivate {
  userId: UserId;
  phone: PhoneE164 | null;
  birthYear: number;
  /** 1–12. */
  birthMonth: number;
  gender: Gender;
}

/** Input to create the profile during onboarding (age gate included). */
export interface ProfileCreateInput {
  displayName: string;
  locale: Locale;
  birthYear: number;
  birthMonth: number;
  gender: Gender;
  countryCode?: CountryCode | null;
  avatarUrl?: string | null;
  bio?: string | null;
}

/** Editable fields of an existing profile. Birth date cannot be changed by the user. */
export type ProfileUpdateInput = Partial<Pick<Profile, 'displayName' | 'avatarUrl' | 'bio' | 'locale' | 'countryCode'>> & {
  gender?: Gender;
};

/** Self-assessed attribute ratings for a sport (PRD §3: speed, control, overall). */
export interface SkillAttributes {
  speed: Stars;
  control: Stars;
  overall: Stars;
}

interface UserSportBase {
  userId: UserId;
  /** Self-assessed skill 1–5. A computed rating (Glicko) is a later phase. */
  selfSkill: Stars;
  attributes: SkillAttributes;
}

/** A sport the user plays (`user_sports`), discriminated by `sport`. */
export type UserSport = {
  [S in SportId]: UserSportBase & {
    sport: S;
    /** Preferred positions, most preferred first. Empty = flexible / not applicable. */
    positions: readonly Position<S>[];
  };
}[SportId];

/** Input for {@link UserSport} (the user id comes from the session). */
export type UserSportInput = DistributiveOmit<UserSport, 'userId'>;

/** The authenticated identity as seen by the app. */
export interface AuthUser {
  id: UserId;
  phone: PhoneE164 | null;
  /** False until onboarding has created a {@link Profile}. */
  hasProfile: boolean;
  createdAt: IsoDateTime;
}

/** A block between two users (`blocks`). Blocked pairs never see each other's content. */
export interface Block {
  blockerId: UserId;
  blockedId: UserId;
  createdAt: IsoDateTime;
}

/** Roles granted in `app_roles`. */
export type AppRole = 'moderator' | 'admin';

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

/**
 * - `active`: visible on the map.
 * - `hidden_pending_review`: auto-hidden after {@link TrustConfig.venueReportsToHide}
 *   distinct reports; awaiting a moderator.
 * - `removed`: confirmed fake or closed by a moderator.
 */
export type VenueStatus = 'active' | 'hidden_pending_review' | 'removed';

/** A playable place on the map (`venues`). */
export interface Venue {
  id: VenueId;
  name: string;
  location: LatLng;
  address: string | null;
  countryCode: CountryCode | null;
  sports: readonly SportId[];
  status: VenueStatus;
  /** Mean overall stars, or `null` when unrated. */
  ratingAvg: number | null;
  ratingCount: number;
  createdBy: UserId | null;
  createdAt: IsoDateTime;
}

/** A venue returned by a map query, with distance from the query centre. */
export interface NearbyVenue extends Venue {
  distanceM: number;
}

/** Input to add a venue from the map. */
export interface VenueCreateInput {
  name: string;
  location: LatLng;
  address?: string | null;
  sports: readonly SportId[];
}

interface VenueRatingBase {
  venueId: VenueId;
  userId: UserId;
  /** Overall stars. */
  overall: Stars;
  createdAt: IsoDateTime;
}

/** One user's rating of a venue for one sport (`venue_ratings`, unique per venue+user+sport). */
export type VenueRating = {
  [S in SportId]: VenueRatingBase & { sport: S; attributes: VenueRatingAttributes<S> };
}[SportId];

/** Input for {@link VenueRating}. */
export type VenueRatingInput = DistributiveOmit<VenueRating, 'userId' | 'createdAt'>;

/** Why a user reports a venue (Waze-style "no venue here"). */
export type VenueReportReason = 'no_venue_here' | 'wrong_location' | 'closed' | 'duplicate' | 'unsafe' | 'other';

/** A venue report (`venue_reports`, unique per venue+reporter). */
export interface VenueReport {
  id: VenueReportId;
  venueId: VenueId;
  reporterId: UserId;
  reason: VenueReportReason;
  note: string | null;
  createdAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Games and participants
// ---------------------------------------------------------------------------

/** `public` games appear on the map; `private` ones only to participants and invite holders. */
export type GameVisibility = 'public' | 'private';

/** Lifecycle of a game. "Live" and "full" are derived from time and counts, not stored. */
export type GameStatus = 'scheduled' | 'cancelled' | 'completed';

/** Where a forfeited no-show deposit goes. */
export type DepositForfeitTarget = 'host' | 'pot';

/**
 * A game as visible to the current viewer (`games`). Secrets (`qr_secret`) are
 * never part of this type.
 *
 * Location privacy: when `hideExactLocation` is true and the viewer is neither the
 * host nor an approved participant, `venueId` and `location` are `null` and only
 * `approxLocation` (rounded to roughly 500 m) is provided.
 */
export interface Game {
  id: GameId;
  hostId: UserId;
  sport: SportId;
  title: string;
  notes: string | null;
  visibility: GameVisibility;
  venueId: VenueId | null;
  location: LatLng | null;
  approxLocation: LatLng;
  hideExactLocation: boolean;
  /** Maximum approved players, host included. Further joiners are waitlisted. */
  capacity: number;
  /**
   * Minimum players for the game to go ahead (PRD GAME-001; ≥ 2, ≤ `capacity`).
   * The game *happened* when at least `max(2, ⌈minPlayers / 2⌉)` participants
   * were verified (TRUST-011); otherwise nobody gets a card.
   */
  minPlayers: number;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  /** Deposit per player in minor units; `0` means no deposit. */
  depositMinor: number;
  /** Currency of `depositMinor`. Meaningful only when `depositMinor > 0`. */
  currency: CurrencyCode;
  depositForfeitTo: DepositForfeitTarget;
  /** Only users with `gender = 'female'` may request to join. Enforced server side. */
  womenOnly: boolean;
  status: GameStatus;
  /** Number of teams for squad balancing (≥ 1; 1 for non-team sports like running). */
  teamCount: number;
  /** Present only for the host. */
  inviteToken: string | null;
  createdAt: IsoDateTime;
}

/** A game with aggregate counts, as listed on the map or in lists. */
export interface GameSummary extends Game {
  approvedCount: number;
  waitlistCount: number;
}

/** A game returned by a map query, with distance from the query centre. */
export interface NearbyGame extends GameSummary {
  distanceM: number;
}

/** Everything the game screen needs for the current viewer. */
export interface GameDetail extends GameSummary {
  host: PublicProfile;
  venue: Venue | null;
  /** The viewer's own participation, if any. */
  myParticipation: Participant | null;
  isHost: boolean;
}

/** Input to create a game. The host is approved automatically and counts toward capacity. */
export interface GameCreateInput {
  sport: SportId;
  title: string;
  notes?: string | null;
  visibility: GameVisibility;
  venueId: VenueId | null;
  /** Required when `venueId` is null; otherwise the venue location is used. */
  location?: LatLng | null;
  hideExactLocation: boolean;
  capacity: number;
  /** Defaults to 2. Must be ≤ `capacity`. */
  minPlayers?: number;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  depositMinor: number;
  currency: CurrencyCode;
  depositForfeitTo?: DepositForfeitTarget;
  womenOnly: boolean;
  teamCount: number;
}

/**
 * - `requested`: awaiting host decision.
 * - `approved`: in the game (counts toward capacity).
 * - `waitlisted`: approved by the host but capacity is full; auto-promoted in order.
 * - `rejected`: declined by the host.
 * - `cancelled`: the player withdrew (may be a late cancel).
 * - `removed`: removed by the host after approval.
 */
export type ParticipantStatus = 'requested' | 'approved' | 'waitlisted' | 'rejected' | 'cancelled' | 'removed';

/**
 * - `unknown`: not yet determined (before/within the check-in window).
 * - `verified`: checked in by any {@link CheckInMethod}.
 * - `no_show_unverified`: game ended with no verified check-in (yields a disputable yellow card).
 * - `excused`: a no-show that was excused by the host or overturned on dispute.
 */
export type AttendanceStatus = 'unknown' | 'verified' | 'no_show_unverified' | 'excused';

/** 0-based team index, `< Game.teamCount`. */
export type TeamIndex = number;

/** A user's participation in a game (`game_participants`, unique per game+user). */
export interface Participant {
  gameId: GameId;
  userId: UserId;
  status: ParticipantStatus;
  attendance: AttendanceStatus;
  team: TeamIndex | null;
  position: PositionId | null;
  /** 1-based rank while `waitlisted`, otherwise `null`. */
  waitlistRank: number | null;
  /**
   * True when cancelled less than {@link TrustConfig.lateCancelWindowHours} before
   * start. The card itself is decided at finalisation (`endsAt + finalizeAfterEndHours`).
   */
  lateCancel: boolean;
  /** A late cancel whose spot was refilled from the waitlist by a player who checked in (no card, TRUST-021). */
  lateCancelRefilled: boolean;
  /** When the current waitlist offer was made; `null` without an active offer. */
  offeredAt: IsoDateTime | null;
  /** Deadline to accept the active offer (`DataPort.acceptWaitlistOffer`); `null` without one. */
  offerExpiresAt: IsoDateTime | null;
  /** Window of the active offer (GAME-045); `null` without one. */
  offerMode: WaitlistOfferMode | null;
  /** The deposit payment method is secured (always true for games without a deposit). */
  paymentReady: boolean;
  checkInMethod: CheckInMethod | null;
  checkedInAt: IsoDateTime | null;
  requestedAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
}

/**
 * Waitlist offer windows (PRD GAME-045), chosen by lead time to `startsAt`:
 * - `standard`: more than {@link TrustConfig.waitlistLongThresholdHours} → {@link TrustConfig.waitlistConfirmLongMinutes} to accept;
 * - `short`: down to {@link TrustConfig.waitlistFlashFillHours} → {@link TrustConfig.waitlistConfirmShortMinutes};
 * - `flash`: less than that → the whole list is offered, first to accept wins.
 */
export type WaitlistOfferMode = 'standard' | 'short' | 'flash';

/** A participant joined with their public profile, for lists. */
export interface ParticipantView extends Participant {
  profile: PublicProfile;
}

/** Host decision on a join request. */
export type JoinDecision = 'approve' | 'reject';

/** Final score of a game (`game_results`). Allowed until {@link TrustConfig.resultWindowHours} after end. */
export interface GameResult {
  gameId: GameId;
  /** One score per team, indexed by {@link TeamIndex}. */
  teamScores: readonly number[];
  submittedBy: UserId;
  submittedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

/**
 * - `gps`: precise foreground GPS samples (stage 2 of the two-stage check-in).
 * - `qr`: scanning the host's rotating QR code (works on web).
 * - `host`: the host marks the player present.
 * - `peer`: confirmed by ≥ {@link TrustConfig.peerMinConfirmations} verified attendees.
 */
export type CheckInMethod = 'gps' | 'qr' | 'host' | 'peer';

/** One location fix from the device. */
export interface GpsSample {
  lat: number;
  lng: number;
  /** Horizontal accuracy radius in metres (68% confidence, as reported by the OS). */
  accuracyM: number;
  /** When the fix was taken, epoch ms (device clock). */
  timestamp: EpochMs;
  /** Android `Location.isMock()`; undefined when the platform cannot tell. */
  isMock?: boolean;
}

/** A check-in submission. Peer confirmations use `DataPort.peerConfirm` instead. */
export type CheckInRequest =
  | { method: 'gps'; samples: readonly GpsSample[] }
  | { method: 'qr'; token: string }
  | { method: 'host'; targetUserId: UserId };

/** Why a check-in attempt was rejected. */
export type CheckInRejectReason =
  | 'not_participant'
  | 'already_checked_in'
  | 'outside_window'
  | 'insufficient_samples'
  | 'samples_too_close'
  | 'low_accuracy'
  | 'too_far'
  | 'spread_too_large'
  | 'suspected_spoofing'
  | 'invalid_qr'
  | 'expired_qr'
  | 'not_host'
  | 'insufficient_peers'
  | 'reciprocal_only'
  | 'blocked_pair';

/**
 * Anti-spoofing heuristics observed during verification. Signals are recorded
 * for audit and route the user to a fallback; they **never** cause a sanction
 * on their own.
 */
export type SpoofSignal = 'mock_location' | 'impossible_speed' | 'inconsistent_spread' | 'clock_skew';

/** Outcome of one check-in attempt. */
export type CheckInVerdict =
  | {
      outcome: 'verified';
      method: CheckInMethod;
      /** Best distance from the pin in metres (GPS only), else `null`. */
      distanceM: number | null;
      signals: readonly SpoofSignal[];
    }
  | {
      outcome: 'rejected';
      method: CheckInMethod;
      reason: CheckInRejectReason;
      /** Methods the UI should offer next, in order of preference. */
      fallbacks: readonly CheckInMethod[];
      signals: readonly SpoofSignal[];
    };

/** Current QR code for a game, host only. Tokens rotate every {@link TrustConfig.qrStepSeconds}. */
export interface QrToken {
  /** Opaque string to encode in the QR (`HMAC(qr_secret, gameId‖step)` based). */
  token: string;
  /** Time step index `⌊t / qrStepSeconds⌋`. */
  step: number;
  expiresAt: IsoDateTime;
}

/** A stored peer confirmation (`peer_confirmations`, unique per game+confirmer+target). */
export interface PeerConfirmation {
  gameId: GameId;
  /** A GPS/QR-verified attendee vouching for `targetId`. */
  confirmerId: UserId;
  targetId: UserId;
  createdAt: IsoDateTime;
}

/** Result of one peer confirmation. */
export interface PeerConfirmResult {
  /** Distinct qualifying confirmations the target now has. */
  confirmations: number;
  /** The target's check-in verdict after this confirmation. */
  verdict: CheckInVerdict;
}

// ---------------------------------------------------------------------------
// Trust: sanctions, appeals, reports, review queue
// ---------------------------------------------------------------------------

/**
 * - `yellow_card`: warning, disputable for {@link TrustConfig.disputeWindowHours}; lives {@link TrustConfig.yellowCardLifetimeDays}.
 * - `join_ban`: cannot request to join games (7 or 30 days).
 * - `chat_mute`: cannot send chat messages (24 h).
 * - `visibility_restriction`: hidden from the map and others' lists (72 h). Always notified with reasons.
 * - `host_suspension`: cannot create games; review queued.
 * - `permanent_ban`: account disabled. **Only** a moderator can issue it.
 */
export type SanctionKind =
  | 'yellow_card'
  | 'join_ban'
  | 'chat_mute'
  | 'visibility_restriction'
  | 'host_suspension'
  | 'permanent_ban';

/** Machine-readable cause of a sanction; drives the statement of reasons (DSA Art. 17). */
export type SanctionReasonCode =
  | 'late_cancel'
  | 'no_show'
  | 'chat_blocks'
  | 'escalation_two_cards'
  | 'escalation_three_cards'
  | 'toxicity_reports'
  | 'fake_venue'
  | 'low_host_rating'
  | 'moderator_decision';

/**
 * i18n key (namespace `trust`) of the statement of reasons, e.g.
 * `sanctions.reason.late_cancel`. Parameters go in `Sanction.statementParams`.
 */
export type SanctionStatementKey = `sanctions.reason.${SanctionReasonCode}`;

/**
 * - `active`: in force.
 * - `disputed`: the user filed a dispute/appeal; remains in force until decided.
 * - `upheld`: a moderator confirmed it; in force until `expiresAt`.
 * - `overturned`: a moderator reversed it; no effect and excluded from escalation counts.
 * - `expired`: past `expiresAt`.
 */
export type SanctionStatus = 'active' | 'disputed' | 'upheld' | 'overturned' | 'expired';

/** Who decided a sanction. Automated decisions are always temporary. */
export type SanctionDecider = 'system' | 'moderator';

/**
 * How a sanction is contested (statement of reasons, DSA Art. 17): `dispute`
 * for sanctions with a dispute window (yellow cards; after `disputeUntil` the
 * route becomes an appeal), `appeal` for everything else (DSA Art. 20).
 * Equals `disputeUntil !== null ? 'dispute' : 'appeal'`.
 */
export type AppealPath = 'dispute' | 'appeal';

interface SanctionCommon {
  id: SanctionId;
  userId: UserId;
  reasonCode: SanctionReasonCode;
  statementKey: SanctionStatementKey;
  /**
   * ICU parameters for the statement (e.g. `{ gameTitle, hours }`). Always
   * includes `appealPath` (same value as {@link SanctionCommon.appealPath}) so
   * the copy can render the contest route.
   */
  statementParams: Readonly<Record<string, string | number>>;
  /** Derived read-model field; see {@link AppealPath}. */
  appealPath: AppealPath;
  startsAt: IsoDateTime;
  /** End of the dispute window (yellow cards only), else `null`. */
  disputeUntil: IsoDateTime | null;
  status: SanctionStatus;
  /** When a moderator (or the overturn cascade) overturned it; `null` otherwise. */
  overturnedAt: IsoDateTime | null;
  /** Game that caused it, if any. */
  gameId: GameId | null;
  /** Earlier sanctions that caused this one (escalation), for cascade on overturn. */
  causedBy: readonly SanctionId[];
  /**
   * Idempotency key; unique in the DB. The row id is derived from it:
   * `id = stableUuid('sanction:' + dedupeKey)` (`deriveSanctionId`), so effects
   * can reference a sanction before it is inserted.
   */
  dedupeKey: string;
  createdAt: IsoDateTime;
}

/**
 * A sanction (`sanctions`). The union encodes the compliance rule that only a
 * moderator may issue an indefinite (permanent) measure; every system-issued
 * sanction has a non-null `expiresAt`.
 */
export type Sanction = SanctionCommon &
  (
    | { kind: Exclude<SanctionKind, 'permanent_ban'>; expiresAt: IsoDateTime; decidedBy: SanctionDecider }
    | { kind: 'permanent_ban'; expiresAt: null; decidedBy: 'moderator' }
  );

/**
 * A sanction to be created. `id` is derived from `dedupeKey`; `status` starts
 * `active`; `appealPath`, `overturnedAt` and `createdAt` are read-model fields.
 */
export type NewSanction = DistributiveOmit<Sanction, 'id' | 'status' | 'appealPath' | 'overturnedAt' | 'createdAt'>;

/** - `open`: awaiting a moderator. `upheld`/`overturned` mirror the sanction outcome. */
export type AppealStatus = 'open' | 'upheld' | 'overturned' | 'withdrawn';

/**
 * A dispute or appeal against a sanction (`appeals`). Filed before
 * `Sanction.disputeUntil` it is a dispute and moves the sanction to `disputed`;
 * later it is an appeal (DSA Art. 20). Both are decided by a human.
 */
export interface Appeal {
  id: AppealId;
  sanctionId: SanctionId;
  userId: UserId;
  text: string;
  /** True when filed within the dispute window. */
  isDispute: boolean;
  status: AppealStatus;
  decidedBy: UserId | null;
  decisionNote: string | null;
  decidedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** Category of a user report (PRD §1: violent / unsportsmanlike). */
export type UserReportCategory = 'violence' | 'unsportsmanlike' | 'harassment' | 'spam' | 'other';

/** A report about a user (`user_reports`). */
export interface UserReport {
  id: UserReportId;
  reporterId: UserId;
  targetUserId: UserId;
  category: UserReportCategory;
  gameId: GameId | null;
  /** Reported chat message; reported messages are copied to 90-day retention. */
  messageId: MessageId | null;
  note: string | null;
  createdAt: IsoDateTime;
}

/** Input to report a user. */
export interface UserReportInput {
  targetUserId: UserId;
  category: UserReportCategory;
  gameId?: GameId | null;
  messageId?: MessageId | null;
  note?: string | null;
}

/** What a review queue item is about. */
export type ReviewKind =
  | 'toxicity_reports'
  | 'collusion_suspected'
  | 'permanent_ban_candidate'
  | 'host_reliability'
  | 'venue_reports'
  | 'sanction_dispute'
  | 'appeal'
  | 'chat_recheck'
  /** Repeated spoofing signals on check-in. Review only: signals never sanction on their own. */
  | 'spoofing_suspected';

export type ReviewStatus = 'open' | 'in_review' | 'resolved';
export type ReviewPriority = 'low' | 'normal' | 'high';

/** A moderator's resolution of a review item. */
export type ModeratorDecision =
  | 'dismiss'
  | 'uphold'
  | 'overturn'
  | 'permanent_ban'
  | 'lift_restriction'
  | 'remove_venue'
  | 'restore_venue';

/** Human review work item (`review_queue`). Created by the engine, resolved via `moderator_decide`. */
export interface ReviewQueueItem {
  id: ReviewItemId;
  kind: ReviewKind;
  status: ReviewStatus;
  priority: ReviewPriority;
  subjectUserId: UserId | null;
  venueId: VenueId | null;
  gameId: GameId | null;
  sanctionId: SanctionId | null;
  appealId: AppealId | null;
  reportIds: readonly UserReportId[];
  /** Free-form machine context for the moderator (counts, signals). No message bodies. */
  evidence: Readonly<Record<string, string | number | boolean | null>>;
  /** Target handling time (SLA). */
  dueBy: IsoDateTime;
  /** Idempotency key; unique in the DB. `id = stableUuid('review:' + dedupeKey)` (`deriveReviewItemId`). */
  dedupeKey: string;
  resolution: ModeratorDecision | null;
  resolvedBy: UserId | null;
  resolvedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** A review item to be created. */
export type NewReviewQueueItem = Omit<
  ReviewQueueItem,
  'id' | 'status' | 'resolution' | 'resolvedBy' | 'resolvedAt' | 'createdAt'
>;

// ---------------------------------------------------------------------------
// Trust configuration
// ---------------------------------------------------------------------------

/**
 * Every trust threshold. Persisted in `trust_config` (snake_case columns) so
 * that it can be tuned without a release; pure functions receive it as a
 * parameter. Units are part of each name.
 */
export interface TrustConfig {
  // Cancellations and cards
  /** Cancelling less than this before start is a late cancel (yellow card). */
  lateCancelWindowHours: number;
  /** A yellow card can be disputed for this long after issue. */
  disputeWindowHours: number;
  /** A yellow card counts toward escalation for this long. */
  yellowCardLifetimeDays: number;
  /** Active cards that trigger the short join ban. */
  joinBanShortAtCards: number;
  joinBanShortDays: number;
  /** Active cards that trigger the long join ban. */
  joinBanLongAtCards: number;
  joinBanLongDays: number;
  /** Active cards that enqueue a permanent-ban review (never automatic). */
  reviewAtCards: number;
  /** Attendance, no-show and late-cancel cards are finalised this long after `endsAt` (TRUST-010); host marks are accepted until then. */
  finalizeAfterEndHours: number;

  // Disputes (TRUST-023)
  /** A dispute not decided within this many days voids the card (fairness by default). */
  disputeAutoVoidDays: number;
  /** Auto-void applies only to a user's first N disputes in 90 days; later ones wait for a human. */
  disputeAutoVoidMaxPer90Days: number;

  // Toxicity reports
  /** Distinct qualifying reporters needed for a visibility restriction. */
  toxicityReporters: number;
  toxicityWindowDays: number;
  /** Reporters with younger accounts do not count. */
  minReporterAccountAgeDays: number;
  /** Reporters whose accounts were all created within this window are treated as colluding (queue only). */
  collusionCreationWindowHours: number;
  visibilityRestrictionHours: number;
  /** After an overturned restriction, new report-based restrictions are review-only for this long (TRUST-048). */
  postOverturnProtectionDays: number;
  /** Reporters whose resolved-report accuracy is below this do not count (TRUST-041)... */
  reporterMinAccuracy: number;
  /** ...once they have at least this many resolved reports. */
  reporterAccuracyMinReports: number;

  // Chat moderation
  chatBlocksForCard: number;
  chatBlocksWindowDays: number;
  chatMuteHours: number;
  /** Server moderation providers race against this timeout; on timeout the message is allow-pending. */
  moderationTimeoutMs: number;

  // Host reliability and venues
  /** Average host rating at or below this... */
  hostLowRatingMax: number;
  /** ...over at least this many ratings triggers a host suspension + review. */
  hostLowRatingMinCount: number;
  /** Automatic host suspension length (TRUST-051); always paired with a review. */
  hostSuspensionDays: number;
  /** Players may rate the host for this long after `endsAt`. */
  hostRatingWindowHours: number;
  /** Host ratings older than this do not count toward the low-rating rule. */
  hostRatingLookbackDays: number;
  /** Distinct reports that auto-hide a venue pending review. */
  venueReportsToHide: number;

  // GPS check-in
  /** OS wake-up geofence radius (native stage 1). */
  wakeGeofenceRadiusM: number;
  gpsMaxAccuracyM: number;
  /** Accepted distance is `gpsBaseRadiusM + accuracyM`. */
  gpsBaseRadiusM: number;
  gpsMinSamples: number;
  gpsMinSampleSpacingSeconds: number;
  /** All samples must fall within this window. */
  gpsSampleWindowSeconds: number;
  gpsMaxSpreadM: number;
  gpsMaxSpeedKmh: number;
  /** Check-in opens this long before `startsAt` and closes at `endsAt`. */
  checkInOpensMinutesBeforeStart: number;

  // QR and peer fallbacks
  qrStepSeconds: number;
  /** Accepted step drift either side of the current step. */
  qrAllowedDriftSteps: number;
  peerMinConfirmations: number;

  // Game windows and retention
  /** Results can be submitted until this long after `endsAt`. */
  resultWindowHours: number;
  /** Chat messages are purged this long after `endsAt`. */
  chatTtlHoursAfterEnd: number;
  /** Reported/blocked content retention for abuse handling. */
  moderationRetentionDays: number;
  /** Deposit hold is placed this long before start (card holds expire after ~7 days). */
  depositHoldLeadHours: number;

  // Waitlist offers (GAME-045, see WaitlistOfferMode)
  /** Lead time above which an offer is `standard`. */
  waitlistLongThresholdHours: number;
  waitlistConfirmLongMinutes: number;
  waitlistConfirmShortMinutes: number;
  /** Lead time below which every waitlisted player is offered at once (`flash`). */
  waitlistFlashFillHours: number;

  // Retention (compliance.md)
  /** Location-derived check-in data (best distance, signals). */
  locationSamplesRetentionDays: number;
  /** QR secrets and invite tokens are erased this long after `endsAt`. */
  qrSecretRetentionHours: number;
  /** Reporter identity on user reports is pseudonymised after this long. */
  userReportRetentionDays: number;
  auditLogRetentionDays: number;
  /** Pseudonymised trust rows of deleted accounts are erased after this long. */
  sanctionRetentionAfterDeletionDays: number;

  // Reliability
  reliabilityWindowDays: number;
  reliabilityGreenMin: number;
  reliabilityRedBelow: number;
  /** Bayesian prior added to numerator and denominator. */
  reliabilityPrior: number;
  /** Weight of a late cancel in the commitment count (a no-show weighs 1). */
  reliabilityLateCancelWeight: number;
  /** Fewer commitments than this shows status `new`. */
  reliabilityMinGames: number;
}

/**
 * Launch defaults (PRD v5 appendix A). Must equal the column defaults of
 * `trust_config` exactly (checked by the golden/SQL tests); field names are the
 * camelCase of the column names (`trust_config_json()` converts mechanically).
 */
export const DEFAULT_TRUST_CONFIG: Readonly<TrustConfig> = Object.freeze({
  lateCancelWindowHours: 2,
  disputeWindowHours: 48,
  yellowCardLifetimeDays: 30,
  joinBanShortAtCards: 2,
  joinBanShortDays: 7,
  joinBanLongAtCards: 3,
  joinBanLongDays: 30,
  reviewAtCards: 4,
  finalizeAfterEndHours: 2,

  disputeAutoVoidDays: 7,
  disputeAutoVoidMaxPer90Days: 3,

  toxicityReporters: 3,
  toxicityWindowDays: 14,
  minReporterAccountAgeDays: 7,
  collusionCreationWindowHours: 48,
  visibilityRestrictionHours: 72,
  postOverturnProtectionDays: 14,
  reporterMinAccuracy: 0.3,
  reporterAccuracyMinReports: 5,

  chatBlocksForCard: 3,
  chatBlocksWindowDays: 7,
  chatMuteHours: 24,
  moderationTimeoutMs: 1500,

  hostLowRatingMax: 2,
  hostLowRatingMinCount: 5,
  hostSuspensionDays: 14,
  hostRatingWindowHours: 48,
  hostRatingLookbackDays: 90,
  venueReportsToHide: 3,

  wakeGeofenceRadiusM: 150,
  gpsMaxAccuracyM: 25,
  gpsBaseRadiusM: 50,
  gpsMinSamples: 2,
  gpsMinSampleSpacingSeconds: 5,
  gpsSampleWindowSeconds: 60,
  gpsMaxSpreadM: 30,
  gpsMaxSpeedKmh: 250,
  checkInOpensMinutesBeforeStart: 30,

  qrStepSeconds: 20,
  qrAllowedDriftSteps: 1,
  peerMinConfirmations: 2,

  resultWindowHours: 2,
  chatTtlHoursAfterEnd: 3,
  moderationRetentionDays: 90,
  depositHoldLeadHours: 24,

  waitlistLongThresholdHours: 6,
  waitlistConfirmLongMinutes: 120,
  waitlistConfirmShortMinutes: 20,
  waitlistFlashFillHours: 1,

  locationSamplesRetentionDays: 30,
  qrSecretRetentionHours: 24,
  userReportRetentionDays: 365,
  auditLogRetentionDays: 730,
  sanctionRetentionAfterDeletionDays: 730,

  reliabilityWindowDays: 90,
  reliabilityGreenMin: 0.85,
  reliabilityRedBelow: 0.6,
  reliabilityPrior: 3,
  reliabilityLateCancelWeight: 0.5,
  reliabilityMinGames: 3,
});

// ---------------------------------------------------------------------------
// Chat and moderation
// ---------------------------------------------------------------------------

/**
 * - `allow`: delivered.
 * - `nudge`: delivered, sender shown a "please keep it friendly" hint.
 * - `block`: not delivered; counts toward {@link TrustConfig.chatBlocksForCard}.
 * - `pending`: providers failed or timed out; delivered and re-checked asynchronously
 *   (retracted if the re-check blocks).
 */
export type ModerationDecision = 'allow' | 'nudge' | 'block' | 'pending';

/** Harm categories, normalised across providers. */
export type ModerationCategory =
  | 'harassment'
  | 'hate'
  | 'threat'
  | 'violence'
  | 'sexual'
  | 'sexual_minors'
  | 'self_harm'
  | 'profanity'
  | 'spam'
  | 'personal_data'
  | 'other';

/** Which layer produced the decision. */
export type ModerationSource = 'client_blocklist' | 'omni' | 'llm' | 'combined' | 'fallback';

/** Result of moderating one message. */
export interface ModerationVerdict {
  decision: ModerationDecision;
  categories: readonly ModerationCategory[];
  source: ModerationSource;
  /** i18n key (namespace `chat`) explaining a nudge/block to the sender, else `null`. */
  reasonKey: string | null;
}

/** A chat message (`chat_messages`). Blocked messages are never stored here. */
export interface ChatMessage {
  id: MessageId;
  gameId: GameId;
  senderId: UserId;
  /** Plain text. Render inside a bidi-isolating component (FSI/PDI). */
  body: string;
  /** Detected BCP-47 language of `body`, or `null` if unknown. May be outside {@link Locale}. */
  lang: string | null;
  /** Client-generated id for optimistic UI and de-duplication. */
  clientMsgId: string;
  moderation: Exclude<ModerationDecision, 'block'>;
  /** Set when an async re-check retracted the message. */
  retractedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  /** `games.ends_at + chatTtlHoursAfterEnd`. */
  expiresAt: IsoDateTime;
}

/** Result of `DataPort.sendMessage`. */
export interface SendMessageResult {
  verdict: ModerationVerdict;
  /** The stored message, or `null` when blocked. */
  message: ChatMessage | null;
  /** Set when this block caused a chat mute. */
  mutedUntil: IsoDateTime | null;
}

/** Events delivered to a chat subscriber (Realtime Broadcast). */
export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'retracted'; messageId: MessageId; at: IsoDateTime };

/** Translation providers, in fallback order. */
export type TranslationProvider = 'deepl' | 'google' | 'llm';

/** A cached translation (`message_translations`, unique per message+target). */
export interface TranslatedMessage {
  messageId: MessageId;
  target: Locale;
  text: string;
  provider: TranslationProvider;
}

// ---------------------------------------------------------------------------
// Notifications and push
// ---------------------------------------------------------------------------

/** Kinds of in-app/push notification. Each maps to i18n key `notifications:<kind>.title|body`. */
export type NotificationKind =
  | 'join_requested'
  | 'join_approved'
  | 'join_rejected'
  | 'join_waitlisted'
  /** A spot is offered to a waitlisted player (params: `mode`, `acceptBy`). */
  | 'waitlist_offer'
  /** The player accepted an offer and is now approved. */
  | 'waitlist_promoted'
  | 'participant_removed'
  | 'game_cancelled'
  | 'game_reminder'
  | 'checkin_open'
  | 'result_requested'
  | 'sanction_issued'
  | 'sanction_decided'
  | 'appeal_decided'
  | 'visibility_restricted'
  | 'chat_muted'
  | 'venue_hidden'
  | 'deposit_action_required';

/** ICU parameters for notification copy. */
export type NotificationParams = Readonly<Record<string, string | number>>;

/** A stored notification (`notifications`). Push delivery is best effort; this row is the record. */
export interface Notification {
  id: NotificationId;
  userId: UserId;
  kind: NotificationKind;
  params: NotificationParams;
  gameId: GameId | null;
  sanctionId: SanctionId | null;
  readAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export type PushPlatform = 'ios' | 'android' | 'web';

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** An amount in the currency's minor unit (cents, agorot; yen has none). Always an integer ≥ 0. */
export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

/** Normalised payment intent status (Stripe vocabulary; other PSPs map onto it). */
export type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'succeeded'
  | 'canceled'
  | 'failed';

/** Payment provider adapters. `fake` is for tests and the mock adapter. Local PSPs are added here. */
export type PaymentProviderId = 'stripe' | 'fake' | 'payplus';

/** What a payment is for. Only deposits are in the MVP. */
export type PaymentPurpose = 'deposit';

/**
 * Deposit lifecycle: `setup` (method saved at join) → `held` (manual-capture
 * hold at T−24h) → `released` (attended / excused / game cancelled) or
 * `forfeited` (no-show upheld).
 */
export type DepositState = 'setup' | 'held' | 'released' | 'forfeited' | 'failed';

/** A payment record (`payments`, unique `idempotencyKey`). */
export interface Payment {
  id: PaymentId;
  userId: UserId;
  gameId: GameId;
  purpose: PaymentPurpose;
  amount: Money;
  provider: PaymentProviderId;
  /** Provider object id (e.g. Stripe PaymentIntent / SetupIntent id). */
  providerRef: string | null;
  status: PaymentIntentStatus;
  depositState: DepositState;
  idempotencyKey: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** What the client needs to collect a payment method for a deposit. */
export interface DepositSetup {
  paymentId: PaymentId;
  provider: PaymentProviderId;
  amount: Money;
  /** Provider client secret (Stripe SetupIntent/PaymentIntent) for the payment sheet. */
  clientSecret: string;
  status: PaymentIntentStatus;
}

/** Result of `DataPort.requestJoin`. */
export interface JoinResult {
  participant: Participant;
  /** Non-null when the game requires a deposit and a payment method must be collected. */
  deposit: DepositSetup | null;
}

/** Result of `DataPort.cancelParticipation`. */
export interface CancelResult {
  participant: Participant;
  /**
   * @deprecated Always `null`: a late cancel is decided at finalisation
   * (`endsAt + finalizeAfterEndHours`, TRUST-021), not at cancel time. Use
   * `participant.lateCancel` to warn the user. Will be removed in contract v3.
   */
  sanction: null;
}

// ---------------------------------------------------------------------------
// Trust engine events and effects
// ---------------------------------------------------------------------------

/**
 * Inputs to the trust engine. Pure functions have the shape
 * `(state, event, config: TrustConfig, now: EpochMs) => { state, effects: Effect[] }`;
 * the state type is owned by the domain package. Additive changes only.
 */
export type TrustEvent =
  /** A player withdrew. Records a pending late cancel; no card is issued yet. */
  | { type: 'ParticipationCancelled'; gameId: GameId; userId: UserId; startsAt: IsoDateTime; cancelledAt: IsoDateTime }
  /**
   * Emitted by attendance finalisation (`endsAt + finalizeAfterEndHours`) for each
   * late canceller. Issues the late-cancel card unless `refilled` (TRUST-020(b)/021)
   * or the game did not happen.
   */
  | {
      type: 'LateCancelFinalized';
      gameId: GameId;
      userId: UserId;
      startsAt: IsoDateTime;
      cancelledAt: IsoDateTime;
      /** A waitlisted replacement took the spot before `startsAt` and checked in. */
      refilled: boolean;
    }
  | { type: 'AttendanceFinalized'; gameId: GameId; userId: UserId; attendance: AttendanceStatus; endsAt: IsoDateTime }
  | {
      type: 'ChatMessageBlocked';
      gameId: GameId;
      userId: UserId;
      at: IsoDateTime;
      categories: readonly ModerationCategory[];
      /**
       * Id of the blocked message (its `moderation_retained` row, or the client's
       * `clientMsgId`). When present, blocks are de-duplicated by it instead of by
       * `(gameId, at)`. Optional for backwards compatibility.
       */
      messageId?: MessageId;
    }
  | { type: 'UserReported'; report: UserReport }
  | { type: 'VenueReported'; report: VenueReport }
  | { type: 'HostRated'; hostId: UserId; gameId: GameId; raterId: UserId; stars: Stars; at: IsoDateTime }
  | { type: 'AppealFiled'; appeal: Appeal }
  | {
      type: 'ModeratorDecided';
      itemId: ReviewItemId;
      decision: ModeratorDecision;
      moderatorId: UserId;
      at: IsoDateTime;
      note: string | null;
    }
  | { type: 'Tick'; at: IsoDateTime };

/** Create a sanction. Adapters insert with `ON CONFLICT (dedupe_key) DO NOTHING`. */
export interface IssueSanctionEffect {
  type: 'IssueSanction';
  /**
   * `dedupeKey` must be deterministic for the cause (e.g.
   * `late_cancel:<gameId>:<userId>`), so re-processing an event is idempotent.
   */
  sanction: NewSanction;
}

/**
 * Side effects emitted by the pure engine and applied by an adapter (SQL RPC,
 * Edge Function or InMemory) in array order. Every effect must be idempotent.
 *
 * `MuteChat`, `BanJoins`, `RestrictVisibility` and `SuspendHost` project an
 * issued sanction onto the denormalised `profiles.*_until` columns; apply them
 * as `greatest(current, until)`. `BanAccount` projects a permanent ban onto
 * `profiles.permanently_banned`; `LiftRestrictions` clears projections.
 * Sanctions remain the source of truth.
 */
export type Effect =
  | IssueSanctionEffect
  | { type: 'SetSanctionStatus'; sanctionId: SanctionId; status: SanctionStatus }
  | { type: 'EnqueueReview'; item: NewReviewQueueItem }
  | {
      type: 'Notify';
      userId: UserId;
      kind: NotificationKind;
      params: NotificationParams;
      gameId: GameId | null;
      /** Dedupe key of the related sanction (its id is unknown to the pure engine). */
      sanctionDedupeKey: string | null;
    }
  | { type: 'UpdateReliability'; userId: UserId; reliability: ReliabilitySnapshot }
  | { type: 'MuteChat'; userId: UserId; until: IsoDateTime }
  | { type: 'BanJoins'; userId: UserId; until: IsoDateTime }
  | { type: 'RestrictVisibility'; userId: UserId; until: IsoDateTime }
  | { type: 'SuspendHost'; userId: UserId; until: IsoDateTime }
  /**
   * Projects a moderator's `permanent_ban` onto `profiles.permanently_banned`.
   * Emitted only after a moderator decision; `apply_effects` (Edge Functions)
   * refuses it together with the permanent-ban `IssueSanction`.
   */
  | { type: 'BanAccount'; userId: UserId }
  | { type: 'LiftRestrictions'; userId: UserId; kinds: readonly SanctionKind[] }
  | { type: 'SetVenueStatus'; venueId: VenueId; status: VenueStatus }
  | { type: 'SetAttendance'; gameId: GameId; userId: UserId; attendance: AttendanceStatus }
  | { type: 'PromoteWaitlist'; gameId: GameId; userId: UserId }
  | { type: 'SettleDeposit'; gameId: GameId; userId: UserId; outcome: 'release' | 'forfeit' }
  | { type: 'Audit'; action: string; subjectUserId: UserId | null; data: Readonly<Record<string, string | number | boolean | null>> };

/** Discriminant values of {@link Effect}. */
export type EffectType = Effect['type'];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Stable error codes shared by RPCs (raised as `ST:<code>` in the Postgres error
 * message), Edge Functions (JSON `{ code }`) and adapters. The UI maps each code
 * to i18n key `errors:<code>`.
 */
export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'age_restricted'
  | 'otp_invalid'
  | 'otp_expired'
  | 'join_banned'
  | 'chat_muted'
  | 'host_suspended'
  | 'account_banned'
  | 'women_only'
  | 'blocked'
  | 'game_full'
  | 'game_not_open'
  | 'outside_window'
  | 'too_many_sports'
  | 'invalid_radius'
  | 'dispute_window_closed'
  | 'already_reported'
  | 'payment_failed'
  | 'payment_required'
  | 'network'
  | 'unavailable'
  | 'unknown';

/**
 * Error thrown by every DataPort method and adapter. Use {@link isStError} rather
 * than `instanceof` (bundles may hold separate copies of this class).
 */
export class StError extends Error {
  override readonly name = 'StError';
  readonly code: ErrorCode;
  /** Optional structured detail (field names, limits). Never user-facing text. */
  readonly details: Readonly<Record<string, string | number | boolean | null>> | undefined;

  constructor(code: ErrorCode, message?: string, details?: Readonly<Record<string, string | number | boolean | null>>) {
    super(message ?? code);
    this.code = code;
    this.details = details;
  }
}

/** Duck-typed guard for {@link StError}. */
export function isStError(value: unknown): value is StError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'StError' &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}
