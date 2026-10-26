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
 * - v3 (Phase 1.5, additive and backward compatible): recurring series and
 *   rosters (GAME-010/011), peer ratings and Glicko-2 (RATE-001..005,
 *   GLK-001..007), result confirmation (GAME-071), Media Vault
 *   (VAULT-001..009), network (played-with, friends, privacy), invite links
 *   and WhatsApp migration (PRD §5.4, GAME-030/031). New config lives in
 *   {@link Phase15Config} (not `TrustConfig`, whose SQL key parity is pinned);
 *   new effects in {@link Phase15Effect} and notifications in
 *   {@link Phase15NotificationKind}, so existing exhaustive maps keep compiling.
 *   `Game.seriesId` is optional. Nothing was renamed or removed.
 */
export const CONTRACT_VERSION = 3 as const;

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

/**
 * Minimum user age, worldwide (owner decision: 18+). Mirrors
 * `DEFAULT_TRUST_CONFIG.minAgeYears` / `trust_config.min_age_years`, which the
 * server enforces in `create_profile`.
 */
export const MIN_AGE_YEARS = 18;

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
  /**
   * The recurring series this game is an occurrence of (contract v3). Optional
   * for backward compatibility: absent or `null` means a one-off game.
   */
  seriesId?: SeriesId | null;
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
  | 'spoofing_suspected'
  /** Contract v3: an upload matched a CSAM hash (VAULT-003); P0, account restricted pending this review. */
  | 'media_csam'
  /** Contract v3: a user reported a gallery item (VAULT-008). */
  | 'media_report';

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
  // Eligibility
  /** Minimum age in completed years to create a profile (owner decision: 18+ worldwide). */
  minAgeYears: number;

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
  /** Accepted past-only step drift: the current step and this many previous steps; future steps are rejected. */
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
  minAgeYears: 18,

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
   * `participant.lateCancel` to warn the user. Kept in contract v3 for
   * backward compatibility; removal is deferred to the next breaking version.
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
  /**
   * Contract v3 (GAME-010): a non-regular asked to join a series occurrence
   * inside its roster-only window (`SeriesOccurrence.priorityUntil`).
   */
  | 'roster_priority'
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

// ===========================================================================
// Phase 1.5 (contract v3)
// ===========================================================================

/** `game_series.id` */
export type SeriesId = string;
/** `media_items.id` */
export type MediaId = string;

/** Wall-clock calendar date in a series' time zone, `YYYY-MM-DD`. */
export type LocalDate = string;
/** Wall-clock time of day in a series' time zone, 24 h `HH:MM`. */
export type LocalTime = string;
/** IANA time zone name, e.g. `Asia/Jerusalem`, `Europe/London`. */
export type IanaTimeZone = string;
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Phase 1.5 notifications. Kept apart from {@link NotificationKind} so the
 * existing exhaustive i18n maps keep compiling; i18n keys are
 * `notifications:<kind>.title|body` exactly like the MVP kinds.
 */
export type Phase15NotificationKind =
  /** Added to a series roster (params: `seriesTitle`, `via`). */
  | 'roster_added'
  /** "Always in" auto-join needs a reconfirmation (params: `seriesTitle`, `startsAt`, `deadline`). */
  | 'series_reconfirm'
  /** An unconfirmed auto-join was released at the deadline. No card (params: `seriesTitle`, `startsAt`). */
  | 'series_auto_released'
  /** GAME-011: N consecutive unconfirmed occurrences; offer to leave the roster. No card (params: `seriesTitle`, `misses`). */
  | 'roster_leave_offer'
  | 'occurrence_skipped'
  | 'occurrence_updated'
  | 'occurrence_rescheduled'
  /** Post-game peer rating is open until `deadline` (RATE-001). */
  | 'peer_rating_open'
  | 'friend_request'
  | 'friend_accepted'
  /** Someone tagged the user; invisible until accepted (VAULT-005). */
  | 'media_tag_request'
  /** The user's upload was blocked by the pre-publication pipeline (with SoR). */
  | 'media_blocked'
  /** The user's displayed Glicko level changed after a rating period (params: `sport`, `formatFamily`, `level`). */
  | 'rating_level_changed';

// ---------------------------------------------------------------------------
// Phase 1.5 configuration
// ---------------------------------------------------------------------------

/**
 * Phase 1.5 thresholds. Kept apart from {@link TrustConfig} (whose
 * `trust_config` key parity is pinned by SQL tests); persisted in its own
 * single-row table `phase15_config` with snake_case columns whose defaults equal
 * {@link DEFAULT_PHASE15_CONFIG} key-for-key (same mechanical mapping).
 */
export interface Phase15Config {
  // Series and roster (GAME-010/011)
  /** Occurrences are generated this many weeks ahead, rolling. */
  seriesHorizonWeeks: number;
  /** Default roster-only window after an occurrence opens. */
  rosterPriorityHoursDefault: number;
  rosterPriorityHoursMin: number;
  rosterPriorityHoursMax: number;
  /** "Always in" members are asked to reconfirm this long before start. */
  autoJoinReconfirmHours: number;
  /** Unconfirmed auto-joins are released (no card) this long before start (aligned with the GAME-050 T−24h reminder). */
  autoJoinReleaseHours: number;
  /** GAME-011: consecutive unconfirmed occurrences before a leave-the-roster offer. */
  rosterMissesBeforeLeaveOffer: number;
  /** GAME-004 duration bounds. */
  seriesMinDurationMinutes: number;
  seriesMaxDurationMinutes: number;

  // Glicko-2 (GLK-001..005)
  glickoInitialRating: number;
  glickoInitialRd: number;
  glickoInitialSigma: number;
  /** System constant τ (volatility change constraint). */
  glickoTau: number;
  /** Rating period length (weekly). */
  glickoRatingPeriodDays: number;
  /** GLK-003: verified / approved participants needed for a rated game. */
  glickoMinVerifiedRatio: number;
  /** GLK-004: players below this reliability are frozen (excluded from updates). */
  glickoFreezeBelowReliability: number;
  /** GLK-004: displayed (non-provisional) only at or above this reliability… */
  glickoDisplayMinReliability: number;
  /** …with at least this many rated games… */
  glickoDisplayMinGames: number;
  /** …and RD strictly below this. */
  glickoDisplayMaxRd: number;

  // Peer ratings (RATE-001..004)
  /** Ratings accepted until `endsAt` + this. */
  peerRatingWindowHours: number;
  /** Co-players one rater may rate per game. */
  peerRatingMaxRatees: number;
  peerRaterMinReliability: number;
  peerRaterMinVerifiedGames: number;
  /** RATE-003: a pair's weight decays after this many ratings… */
  peerPairDecayAfter: number;
  /** …within this many days… */
  peerPairDecayWindowDays: number;
  /** …each further rating multiplies the weight by this. */
  peerPairDecayFactor: number;
  /** Weight multiplier for reciprocal all-max ("10/10") pairs. */
  peerReciprocalWeight: number;
  /** Ratings beyond this many standard deviations from the consensus are trimmed. */
  peerOutlierSigma: number;
  /** Bayesian prior weight of the self-assessment. */
  peerSelfPriorWeight: number;

  // Media Vault (VAULT-001/002/007)
  /** Uploads accepted from `startsAt` to `endsAt` + this. */
  mediaUploadAfterEndHours: number;
  mediaPhotoMaxMb: number;
  mediaVideoMaxMb: number;
  mediaVideoMaxSeconds: number;
  mediaMaxItemsPerUserPerGame: number;
  /** Free retention in calendar months. */
  mediaRetentionMonths: number;
  /** Pro: retained while subscribed, then this grace (VAULT-007). */
  mediaProGraceDays: number;

  // Network (GAME-032)
  /** "Played with" counts co-verified games within this many days. */
  playedWithLookbackDays: number;
}

/** Phase 1.5 launch defaults (specs: PRD GAME-010/011/004, deferred-phases §4 and §7). */
export const DEFAULT_PHASE15_CONFIG: Readonly<Phase15Config> = Object.freeze({
  seriesHorizonWeeks: 4,
  rosterPriorityHoursDefault: 24,
  rosterPriorityHoursMin: 6,
  rosterPriorityHoursMax: 72,
  autoJoinReconfirmHours: 48,
  autoJoinReleaseHours: 24,
  rosterMissesBeforeLeaveOffer: 3,
  seriesMinDurationMinutes: 30,
  seriesMaxDurationMinutes: 240,

  glickoInitialRating: 1500,
  glickoInitialRd: 350,
  glickoInitialSigma: 0.06,
  glickoTau: 0.5,
  glickoRatingPeriodDays: 7,
  glickoMinVerifiedRatio: 0.7,
  glickoFreezeBelowReliability: 0.7,
  glickoDisplayMinReliability: 0.8,
  glickoDisplayMinGames: 10,
  glickoDisplayMaxRd: 100,

  peerRatingWindowHours: 48,
  peerRatingMaxRatees: 5,
  peerRaterMinReliability: 0.8,
  peerRaterMinVerifiedGames: 5,
  peerPairDecayAfter: 3,
  peerPairDecayWindowDays: 30,
  peerPairDecayFactor: 0.5,
  peerReciprocalWeight: 0.5,
  peerOutlierSigma: 2,
  peerSelfPriorWeight: 3,

  mediaUploadAfterEndHours: 2,
  mediaPhotoMaxMb: 20,
  mediaVideoMaxMb: 200,
  mediaVideoMaxSeconds: 60,
  mediaMaxItemsPerUserPerGame: 30,
  mediaRetentionMonths: 12,
  mediaProGraceDays: 90,

  playedWithLookbackDays: 365,
});

// ---------------------------------------------------------------------------
// Recurring series and roster (GAME-010, GAME-011)
// ---------------------------------------------------------------------------

export type SeriesRecurrence = 'weekly' | 'biweekly';

/** - `active`: occurrences are generated. `paused`: none generated. `ended`: closed for good. */
export type SeriesStatus = 'active' | 'paused' | 'ended';

/** Fields copied from the series template into each generated game. */
export interface SeriesTemplate {
  sport: SportId;
  title: string;
  notes: string | null;
  visibility: GameVisibility;
  venueId: VenueId | null;
  location: LatLng | null;
  hideExactLocation: boolean;
  capacity: number;
  minPlayers: number;
  depositMinor: number;
  currency: CurrencyCode;
  depositForfeitTo: DepositForfeitTarget;
  womenOnly: boolean;
  teamCount: number;
}

/** The schedule of a series, in the series' local time zone (DST-correct). */
export interface SeriesSchedule {
  recurrence: SeriesRecurrence;
  weekday: Weekday;
  /** Local start time `HH:MM`. A time that does not exist on a DST-forward day is shifted forward by the gap. */
  startTime: LocalTime;
  timeZone: IanaTimeZone;
  /** 30–240 (GAME-004). */
  durationMinutes: number;
}

/**
 * A recurring game (`game_series`). Occurrence slots are
 * `anchorDate + k · (7 | 14)` days for `k ≥ 0`, up to `endDate`, generated
 * {@link GameSeries.horizonWeeks} ahead on a rolling basis.
 */
export interface GameSeries extends SeriesTemplate, SeriesSchedule {
  id: SeriesId;
  hostId: UserId;
  /** Approximate (≈500 m) location shown before approval, like `Game.approxLocation`. */
  approxLocation: LatLng;
  /** First slot. Re-based when a "this and following" edit changes the schedule. */
  anchorDate: LocalDate;
  /** Last possible slot (inclusive), or `null` for open-ended. */
  endDate: LocalDate | null;
  /** Default 4. */
  horizonWeeks: number;
  /** Roster-only window after an occurrence opens. Default 24, range 6–72. */
  rosterPriorityHours: number;
  /** "Always in" reconfirmation lead time. Default 48. */
  autoJoinReconfirmHours: number;
  /** Slots skipped before (or after) they were generated. */
  skippedDates: readonly LocalDate[];
  /** Incremented by every schedule change; part of occurrence keys. Starts at 0. */
  scheduleRevision: number;
  status: SeriesStatus;
  /** Present only for the host. */
  inviteToken: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Input to create a series. */
export interface GameSeriesCreateInput extends SeriesSchedule {
  sport: SportId;
  title: string;
  notes?: string | null;
  visibility: GameVisibility;
  venueId: VenueId | null;
  location?: LatLng | null;
  hideExactLocation: boolean;
  capacity: number;
  minPlayers?: number;
  depositMinor: number;
  currency: CurrencyCode;
  depositForfeitTo?: DepositForfeitTarget;
  womenOnly: boolean;
  teamCount: number;
  /** First slot is the first `weekday` on or after this local date. */
  startDate: LocalDate;
  endDate?: LocalDate | null;
  rosterPriorityHours?: number;
  autoJoinReconfirmHours?: number;
}

/** Scope of an edit (GAME-010): one occurrence, or it and all later ones. */
export type EditScope = 'this' | 'following';

/** Fields editable for a single occurrence (`scope: 'this'`). */
export interface OccurrencePatch {
  title?: string;
  notes?: string | null;
  capacity?: number;
  minPlayers?: number;
  venueId?: VenueId | null;
  location?: LatLng | null;
  hideExactLocation?: boolean;
  /** Moves this occurrence only. */
  startsAt?: IsoDateTime;
  durationMinutes?: number;
}

/**
 * Fields editable for "this and following". Changing any {@link SeriesSchedule}
 * field is a *reschedule*: later generated occurrences are cancelled (reason
 * `rescheduled`) and regenerated under a new `scheduleRevision`.
 * `womenOnly` cannot be edited (participants were admitted under it).
 */
export type SeriesPatch = Partial<Omit<SeriesTemplate, 'sport' | 'womenOnly'>> &
  Partial<SeriesSchedule> & {
    rosterPriorityHours?: number;
    autoJoinReconfirmHours?: number;
    endDate?: LocalDate | null;
  };

/** An edit request; `occurrenceKey` is the pivot occurrence. */
export type SeriesEdit =
  | { scope: 'this'; occurrenceKey: string; patch: OccurrencePatch }
  | { scope: 'following'; occurrenceKey: string; patch: SeriesPatch };

/**
 * - `regular`: on the roster (priority window, auto-join if `alwaysIn`).
 * - `invited`: the host invited them (e.g. from "played with"); not yet accepted.
 * - `left`: left or removed.
 */
export type RosterStatus = 'regular' | 'invited' | 'left';

/** How a member reached the roster (PRD §5.4 step 4: invite-link joiners are added automatically). */
export type RosterJoinSource = 'invite_link' | 'host' | 'played_with';

/** A series roster entry (`series_roster`, unique per series+user). */
export interface RosterMember {
  seriesId: SeriesId;
  userId: UserId;
  status: RosterStatus;
  /** "I'm always in": auto-joined to each new occurrence, reconfirmed at T−`autoJoinReconfirmHours`. */
  alwaysIn: boolean;
  joinedVia: RosterJoinSource;
  /** GAME-011: consecutive occurrences released for not reconfirming. Reset by any reconfirmation or attendance. */
  consecutiveMisses: number;
  /** When the leave-the-roster offer was sent, if it was. */
  leaveOfferedAt: IsoDateTime | null;
  joinedAt: IsoDateTime;
  leftAt: IsoDateTime | null;
}

/** A roster entry with the member's public card. */
export interface RosterMemberView extends RosterMember {
  profile: PublicProfile;
}

/** - `scheduled`: a live game. `skipped`: skipped by the host. `cancelled`: cancelled (incl. rescheduled). */
export type OccurrenceStatus = 'scheduled' | 'skipped' | 'cancelled';

/** One generated (or planned) occurrence of a series (`series_occurrences`). */
export interface SeriesOccurrence {
  seriesId: SeriesId;
  /** `${seriesId}:${scheduleRevision}:${slotDate}`; unique. */
  occurrenceKey: string;
  /** The schedule slot (local date) this occurrence fills. */
  slotDate: LocalDate;
  scheduleRevision: number;
  /** `stableUuid('occurrence:' + occurrenceKey)`, so effects can reference the game before it is inserted. */
  gameId: GameId;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  /** When the occurrence was generated and became joinable (≈ `startsAt − horizonWeeks` in steady state). */
  opensAt: IsoDateTime;
  /** Roster-only until here: `opensAt + rosterPriorityHours` (capped at `startsAt`). */
  priorityUntil: IsoDateTime;
  /** Auto-joined members are asked to reconfirm here: `startsAt − autoJoinReconfirmHours`. */
  reconfirmAt: IsoDateTime;
  /** Unconfirmed auto-joins are released here: `startsAt − autoJoinReleaseHours`. */
  releaseAt: IsoDateTime;
  status: OccurrenceStatus;
  /** Edited with scope `this` (later "following" edits still apply to it). */
  overridden: boolean;
}

/** A roster member auto-joined to an occurrence (`series_auto_joins`, unique per game+user). */
export interface AutoJoinRecord {
  gameId: GameId;
  seriesId: SeriesId;
  userId: UserId;
  /** `approved` or `waitlisted` at auto-join time. */
  joinedAs: 'approved' | 'waitlisted';
  reconfirmRequestedAt: IsoDateTime | null;
  reconfirmedAt: IsoDateTime | null;
  /** Declined or released (no card); `null` while held. */
  releasedAt: IsoDateTime | null;
}

/** Everything the series screen needs. */
export interface GameSeriesDetail {
  series: GameSeries;
  host: PublicProfile;
  /** Upcoming occurrences inside the horizon, earliest first. */
  upcoming: readonly SeriesOccurrence[];
  rosterCount: number;
  myRoster: RosterMember | null;
  isHost: boolean;
}

// ---------------------------------------------------------------------------
// Result confirmation (GAME-071)
// ---------------------------------------------------------------------------

export type ResultVerdict = 'confirm' | 'dispute';

/** A verified participant's verdict on the submitted result (`result_confirmations`). */
export interface ResultConfirmation {
  gameId: GameId;
  userId: UserId;
  verdict: ResultVerdict;
  createdAt: IsoDateTime;
}

/**
 * - `pending`: no majority yet. `confirmed`: confirms > half of verified participants
 *   (the submitter counts as a confirm). `disputed`: disputes > half (excluded from stats and ratings).
 */
export type ResultStatus = 'pending' | 'confirmed' | 'disputed';

export interface ResultConfirmationSummary {
  gameId: GameId;
  status: ResultStatus;
  confirms: number;
  disputes: number;
  verifiedCount: number;
  myVerdict: ResultVerdict | null;
}

// ---------------------------------------------------------------------------
// Peer ratings (RATE-001..005) and Glicko-2 (GLK-001..007)
// ---------------------------------------------------------------------------

/**
 * Peer-rated attributes per sport (RATE-001; mirrors `sports.rating_attributes`
 * for players). Every sport has `overall`, used for squad balancing.
 */
export const PLAYER_RATING_ATTRIBUTES = {
  football: ['speed', 'ball_control', 'passing', 'defence', 'overall'],
  basketball: ['shooting', 'handling', 'defence', 'athleticism', 'overall'],
  tennis: ['serve', 'groundstrokes', 'net_play', 'movement', 'overall'],
  padel: ['serve', 'volley', 'walls', 'positioning', 'overall'],
  running: ['pace', 'endurance', 'overall'],
  volleyball: ['serve', 'passing', 'attack', 'defence', 'overall'],
} as const satisfies Record<SportId, readonly string[]>;

/** A player attribute of sport `S`. */
export type PlayerRatingAttribute<S extends SportId = SportId> = S extends SportId
  ? (typeof PLAYER_RATING_ATTRIBUTES)[S][number]
  : never;

/** One rater's scores for one co-player in one game (`peer_ratings`, unique per game+rater+ratee). */
export interface PeerRating {
  gameId: GameId;
  sport: SportId;
  raterId: UserId;
  rateeId: UserId;
  /** 1–5 per attribute; a rater may skip attributes. */
  scores: Readonly<Partial<Record<PlayerRatingAttribute, Stars>>>;
  createdAt: IsoDateTime;
}

/** Input for one co-player. */
export interface PeerRatingInput {
  rateeId: UserId;
  scores: Readonly<Partial<Record<PlayerRatingAttribute, Stars>>>;
}

/** Why a user may not rate (RATE-001/002). UI copy: `ratings:ineligible.<reason>`. */
export type RatingIneligibleReason =
  | 'not_verified'
  | 'low_reliability'
  | 'too_few_games'
  | 'active_sanction'
  | 'window_not_open'
  | 'window_closed';

/** Whether the caller may rate co-players of a game (AC-RATE-002). */
export interface RatingEligibility {
  canRate: boolean;
  /** Every failing gate, in a fixed order. */
  reasons: readonly RatingIneligibleReason[];
  verifiedGamesInSport: number;
  requiredGames: number;
  windowClosesAt: IsoDateTime;
  /** Ratees still allowed (max − already rated). */
  remainingRatees: number;
  /** Co-players the caller may rate (verified, not blocked, not self, not yet rated). */
  rateableUserIds: readonly UserId[];
}

/** Aggregated peer rating per attribute (RATE-004). Shown to the player privately. */
export interface PeerAttributeSummary {
  /** Bayesian mean 1–5 (self prior, weight `peerSelfPriorWeight`). */
  mean: number;
  /** Effective weight of the peer evidence after decay, down-weighting and trimming. */
  evidenceWeight: number;
  /** Ratings kept after outlier trimming. */
  ratingsUsed: number;
}

export interface PeerSkillSummary {
  userId: UserId;
  sport: SportId;
  attributes: Readonly<Partial<Record<PlayerRatingAttribute, PeerAttributeSummary>>>;
  /** Overall 1–5 band for hosts (rounded overall mean). */
  band: Stars;
  raterCount: number;
}

/** Glicko-2 format family (GLK-001), e.g. football small-sided vs full-sided. */
export type FormatFamily =
  | 'small_sided'
  | 'full_sided'
  | 'half_court'
  | 'full_court'
  | 'singles'
  | 'doubles'
  | 'pairs'
  | 'teams';

/** Glicko-2 parameters on the Glicko scale. */
export interface GlickoParams {
  /** Rating r (initial 1500). */
  r: number;
  /** Rating deviation RD (initial 350). */
  rd: number;
  /** Volatility σ (initial 0.06). */
  sigma: number;
}

/** A player's skill rating per sport and format family (`skill_ratings`). */
export interface SkillRating extends GlickoParams {
  userId: UserId;
  sport: SportId;
  formatFamily: FormatFamily;
  /** Rated games counted so far. */
  games: number;
  /** GLK-004: true unless reliability ≥ 80 %, games ≥ 10 and RD < 100. UI shows "Provisional". */
  provisional: boolean;
  /** GLK-005: `clamp((r − 900) / 200, 0, 7)`, one decimal. */
  level: number;
  /** Last processed rating period (`YYYY-Www`, ISO week), or `null`. */
  lastPeriod: string | null;
  updatedAt: IsoDateTime;
}

/** Outcome of one rated game for one side. Margin is never used (GLK-002). */
export type MatchOutcome = 'win' | 'draw' | 'loss';

/** Why a game produces no rating updates (GLK-003). UI copy: `ratings:notRated.<reason>`. */
export type GameNotRatedReason =
  | 'no_result'
  | 'result_not_confirmed'
  | 'result_disputed'
  | 'too_few_verified'
  | 'teams_not_published'
  | 'not_two_sides'
  | 'unrated_sport';

export type GameRatingEligibility =
  | { eligible: true; reason: null }
  | { eligible: false; reason: GameNotRatedReason };

/** One player's update for one rating period (`rating_updates`, unique per user+sport+family+period). */
export interface RatingUpdate {
  userId: UserId;
  sport: SportId;
  formatFamily: FormatFamily;
  /** ISO week `YYYY-Www`. */
  period: string;
  before: GlickoParams;
  after: GlickoParams;
  /** Rated games added in this period. */
  gamesAdded: number;
  /** GLK-004: excluded (reliability < 70 %); `after` equals `before`. */
  frozen: boolean;
  /** `rating:<userId>:<sport>:<family>:<period>`. */
  dedupeKey: string;
}

// ---------------------------------------------------------------------------
// Media Vault (VAULT-001..009)
// ---------------------------------------------------------------------------

export type MediaKind = 'photo' | 'video';

/**
 * - `processing`: in the pre-publication pipeline (EXIF strip → CSAM hash → moderation).
 * - `published`: visible per `visibility`.
 * - `blocked`: the pipeline blocked it (never shown; evidence preserved for CSAM).
 * - `removed`: deleted by the uploader, a moderator, or retention.
 */
export type MediaStatus = 'processing' | 'published' | 'blocked' | 'removed';

/** `participants` (default) or `venue_public` (venue vault, VAULT-004/006). */
export type MediaVisibility = 'participants' | 'venue_public';

/** A media item (`media_items`). */
export interface MediaItem {
  id: MediaId;
  gameId: GameId;
  venueId: VenueId | null;
  uploaderId: UserId;
  kind: MediaKind;
  status: MediaStatus;
  /** Effective visibility (promoted to `venue_public` only when allowed). */
  visibility: MediaVisibility;
  /** The uploader's opt-in to `venue_public` (VAULT-004). */
  publicOptIn: boolean;
  mimeType: string;
  sizeBytes: number;
  /** Videos only. */
  durationSeconds: number | null;
  /** Storage object key; the adapter signs URLs. */
  storagePath: string;
  createdAt: IsoDateTime;
  publishedAt: IsoDateTime | null;
  /** Retention end (`createdAt + mediaRetentionMonths`). */
  expiresAt: IsoDateTime;
  removedAt: IsoDateTime | null;
}

/** A published item with signed URLs and the viewer-visible (accepted) tags. */
export interface MediaItemView extends MediaItem {
  url: string;
  thumbnailUrl: string | null;
  acceptedTags: readonly UserId[];
}

/**
 * - `requested`: invisible until accepted (VAULT-005).
 * - `accepted` / `declined` by the tagged user.
 * - `removed`: untagged later (by the tagged user, the uploader or account deletion).
 */
export type MediaTagStatus = 'requested' | 'accepted' | 'declined' | 'removed';

/** A tag on a media item (`media_tags`, unique per media+user). */
export interface MediaTag {
  mediaId: MediaId;
  userId: UserId;
  taggedBy: UserId;
  status: MediaTagStatus;
  /**
   * The tagged user vetoed `venue_public` (declined the tag, or untagged with
   * "remove from public", or deleted their account). A vetoing tag blocks
   * promotion even after it is removed.
   */
  vetoPublic: boolean;
  createdAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
}

/** Input to start an upload. */
export interface MediaUploadRequest {
  gameId: GameId;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
}

/** A signed direct-upload slot. Finish with `DataPort.completeMediaUpload`. */
export interface MediaUploadIntent {
  mediaId: MediaId;
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers: Readonly<Record<string, string>>;
  expiresAt: IsoDateTime;
  maxBytes: number;
}

/** Why an upload or a visibility change was refused. */
export type MediaRejectReason =
  | 'not_verified_attendee'
  | 'window_not_open'
  | 'window_closed'
  | 'too_large'
  | 'too_long'
  | 'unsupported_type'
  | 'user_cap_reached'
  | 'not_uploader'
  | 'not_published'
  | 'tags_pending';

/** Pipeline outcome (VAULT-003). */
export interface MediaModerationVerdict {
  /** `publish`, `block` (policy) or `csam` (block + preserve + report + restrict). */
  decision: 'publish' | 'block' | 'csam';
  categories: readonly ModerationCategory[];
  exifStripped: boolean;
  csamHashMatch: boolean;
  source: 'hash' | 'vision' | 'combined' | 'fallback';
  /** i18n key explaining a block to the uploader, else `null`. */
  reasonKey: string | null;
}

// ---------------------------------------------------------------------------
// Network: played-with, friends, privacy
// ---------------------------------------------------------------------------

export type FriendStatus = 'requested' | 'accepted';

/**
 * A relationship between two users (`connections`, one row per unordered pair,
 * `userA < userB` by string order).
 * - played-with is auto-derived from co-verified attendance (GAME-032).
 * - friendship is mutual: one requests, the other accepts.
 * Blocks override everything (a blocked pair has no visible connection).
 */
export interface Connection {
  userA: UserId;
  userB: UserId;
  /** Co-verified games within `playedWithLookbackDays`. */
  gamesTogether: number;
  lastPlayedAt: IsoDateTime | null;
  friendStatus: FriendStatus | null;
  friendRequestedBy: UserId | null;
  friendRequestedAt: IsoDateTime | null;
  friendAcceptedAt: IsoDateTime | null;
}

/** The relationship as seen by the viewer. */
export type FriendState = 'none' | 'outgoing' | 'incoming' | 'friends';

export interface ConnectionView {
  user: PublicProfile;
  playedWith: boolean;
  gamesTogether: number;
  lastPlayedAt: IsoDateTime | null;
  friend: FriendState;
}

/** Who sees my upcoming games. */
export type UpcomingGamesAudience = 'friends' | 'nobody';

/** Default audience: friends (friendship is a mutual opt-in, so this stays private by default). */
export const DEFAULT_UPCOMING_GAMES_AUDIENCE: UpcomingGamesAudience = 'friends';

/** Network privacy settings (`network_privacy`; default {@link DEFAULT_UPCOMING_GAMES_AUDIENCE}). */
export interface NetworkPrivacy {
  userId: UserId;
  upcomingGamesVisibleTo: UpcomingGamesAudience;
  updatedAt: IsoDateTime;
}

/** A friend's upcoming game, as shown in "friends' games". */
export interface FriendUpcomingGame {
  friend: PublicProfile;
  game: GameSummary;
}

// ---------------------------------------------------------------------------
// Invites and WhatsApp migration (PRD §5.4, GAME-030/031)
// ---------------------------------------------------------------------------

export type InviteTarget = { kind: 'game'; gameId: GameId } | { kind: 'series'; seriesId: SeriesId };

/** OpenGraph rich-preview fields (GAME-030). No address when the location is hidden. */
export interface InvitePreview {
  sport: SportId;
  title: string;
  /** Next (or the game's) start, UTC; format with `timeZone`. */
  startsAt: IsoDateTime | null;
  timeZone: IanaTimeZone | null;
  recurrence: SeriesRecurrence | null;
  weekday: Weekday | null;
  localStartTime: LocalTime | null;
  /** Neighbourhood or area label; never the address of a hidden-location game. */
  areaLabel: string | null;
  spotsLeft: number | null;
  capacity: number;
  womenOnly: boolean;
  hostDisplayName: string;
  ogImageUrl: string | null;
}

/** An invite link (host only). */
export interface InviteLink {
  target: InviteTarget;
  token: string;
  url: string;
  preview: InvitePreview;
  createdAt: IsoDateTime;
  rotatedAt: IsoDateTime | null;
}

/** "How many of the group already moved" (PRD §5.4 step 5). */
export interface MigrationStats {
  target: InviteTarget;
  /** Distinct users who joined (game) or entered the roster (series) through the link. */
  joinedFromLink: number;
  /** Of those, how many have at least one verified attendance since. */
  activeFromLink: number;
  /** Current regulars (series) or approved participants (game), any source. */
  rosterSize: number;
  /** Everyone who ever joined, any source and status. */
  totalMembers: number;
  firstJoinAt: IsoDateTime | null;
  lastJoinAt: IsoDateTime | null;
}

/** A localisable share message: i18n key + ICU params (never raw text). */
export interface ShareMessage {
  /** e.g. `invite:share.series.weekly` (namespace `invite`). */
  key: string;
  params: Readonly<Record<string, string | number>>;
  locale: Locale;
  url: string;
}

// ---------------------------------------------------------------------------
// Phase 1.5 effects
// ---------------------------------------------------------------------------

/** Snapshot of the game an occurrence materialises as (insert as `games` row). */
export interface OccurrenceGameSnapshot extends SeriesTemplate {
  id: GameId;
  seriesId: SeriesId;
  hostId: UserId;
  approxLocation: LatLng;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
}

/**
 * Side effects of the Phase 1.5 pure modules, applied in order by an adapter.
 * Every effect carries a deterministic `dedupeKey`; apply with
 * `ON CONFLICT (dedupe_key) DO NOTHING` (or an equivalent idempotent upsert).
 */
export type Phase15Effect =
  // series
  | { type: 'CreateOccurrence'; occurrence: SeriesOccurrence; game: OccurrenceGameSnapshot; dedupeKey: string }
  | {
      type: 'UpdateOccurrence';
      occurrenceKey: string;
      gameId: GameId;
      /** Game fields to change; when the start moves, the occurrence's derived times move with it. */
      patch: Readonly<Partial<SeriesTemplate> & { startsAt?: IsoDateTime; endsAt?: IsoDateTime }>;
      /** The occurrence row after the change (status, times, `overridden`). */
      occurrence: SeriesOccurrence;
      dedupeKey: string;
    }
  | {
      type: 'CancelOccurrence';
      occurrenceKey: string;
      gameId: GameId;
      reason: 'skipped' | 'rescheduled' | 'series_ended';
      /** True when inside `lateCancelWindowHours` of start: route through the host late-cancel trust rule. */
      lateCancel: boolean;
      dedupeKey: string;
    }
  | { type: 'AutoJoin'; gameId: GameId; seriesId: SeriesId; userId: UserId; joinedAs: 'approved' | 'waitlisted'; dedupeKey: string }
  | { type: 'RequestReconfirm'; gameId: GameId; userId: UserId; deadline: IsoDateTime; dedupeKey: string }
  /** Cancel the auto-joined participation without a card and offer the spot to the waitlist. */
  | { type: 'ReleaseAutoJoin'; gameId: GameId; userId: UserId; dedupeKey: string }
  | { type: 'UpdateRosterMember'; seriesId: SeriesId; userId: UserId; patch: Readonly<Partial<RosterMember>>; dedupeKey: string }
  | { type: 'UpdateSeries'; seriesId: SeriesId; patch: Readonly<Partial<GameSeries>>; dedupeKey: string }
  // media
  | { type: 'SetMediaStatus'; mediaId: MediaId; status: MediaStatus; dedupeKey: string }
  | { type: 'SetMediaVisibility'; mediaId: MediaId; visibility: MediaVisibility; dedupeKey: string }
  | { type: 'SetMediaTagStatus'; mediaId: MediaId; userId: UserId; status: MediaTagStatus; dedupeKey: string }
  /** CSAM: preserve the original under legal hold and file the hotline report (VAULT-003). */
  | { type: 'PreserveMediaEvidence'; mediaId: MediaId; uploaderId: UserId; dedupeKey: string }
  | { type: 'DeleteMediaObject'; mediaId: MediaId; storagePath: string; dedupeKey: string }
  /**
   * CSAM match: restrict the account (no uploads, joins, chat or hosting) pending
   * the `media_csam` human review. Not a sanction; a moderator decides.
   */
  | { type: 'RestrictAccountPendingReview'; userId: UserId; reason: 'csam_match'; dedupeKey: string }
  // network
  | { type: 'UpsertConnection'; connection: Connection; dedupeKey: string }
  | { type: 'DeleteFriendship'; userA: UserId; userB: UserId; dedupeKey: string }
  // shared
  | {
      type: 'Notify15';
      userId: UserId;
      kind: Phase15NotificationKind;
      params: NotificationParams;
      gameId: GameId | null;
      seriesId: SeriesId | null;
      dedupeKey: string;
    }
  /** Hand a trust-relevant fact to the trust engine (e.g. a CSAM restriction review). */
  | { type: 'EnqueueReview'; item: NewReviewQueueItem }
  | { type: 'Audit'; action: string; subjectUserId: UserId | null; data: Readonly<Record<string, string | number | boolean | null>> };

/** Discriminant values of {@link Phase15Effect}. */
export type Phase15EffectType = Phase15Effect['type'];
