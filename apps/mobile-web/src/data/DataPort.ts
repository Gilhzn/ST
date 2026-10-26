/**
 * DataPort: the app's only gateway to data and side effects.
 *
 * Screens and hooks depend on this interface, never on Supabase directly.
 * Implementations:
 * - `SupabaseAdapter` (production): RLS-protected selects, SECURITY DEFINER RPCs,
 *   Edge Functions (`send-message`, `translate-message`, `checkin-verify`,
 *   `create-deposit`, `delete-account`) and Realtime Broadcast for chat.
 * - `InMemoryAdapter` (`EXPO_PUBLIC_DATA=mock`): deterministic, used by e2e and
 *   offline development; must apply the same rules via `@st/domain`.
 *
 * Contract for every method:
 * - Async methods reject with `StError` (check with `isStError`); the `code`
 *   is a stable `ErrorCode` the UI maps to `errors:<code>`. No other error type
 *   may escape an adapter (wrap network/SDK errors as `network`/`unavailable`/`unknown`).
 * - The caller is the signed-in user unless a method says otherwise; methods
 *   other than auth reject with `unauthenticated` when signed out.
 * - Authorization is enforced server-side (RLS/RPC). Client-side checks are UX only.
 * - Returned objects are fresh snapshots; adapters must not mutate them later.
 */
import type {
  AuthUser,
  ConnectionView,
  EditScope,
  FriendUpcomingGame,
  GameSeries,
  GameSeriesCreateInput,
  GameSeriesDetail,
  InviteLink,
  InviteTarget,
  MediaId,
  MediaItem,
  MediaItemView,
  MediaTag,
  MediaUploadIntent,
  MediaUploadRequest,
  MediaVisibility,
  MigrationStats,
  NetworkPrivacy,
  PeerRating,
  PeerRatingInput,
  PeerSkillSummary,
  RatingEligibility,
  ResultConfirmationSummary,
  ResultVerdict,
  RosterMember,
  RosterMemberView,
  SeriesEdit,
  SeriesId,
  SeriesOccurrence,
  ShareMessage,
  SkillRating,
  GameRatingEligibility,
  UpcomingGamesAudience,
  Block,
  CancelResult,
  ChatEvent,
  ChatMessage,
  CheckInRequest,
  CheckInVerdict,
  Appeal,
  GameCreateInput,
  GameDetail,
  GameId,
  GameResult,
  IsoDateTime,
  JoinDecision,
  JoinResult,
  LatLng,
  Locale,
  MessageId,
  NearbyGame,
  NearbyVenue,
  Notification,
  NotificationId,
  Participant,
  ParticipantView,
  Payment,
  PeerConfirmResult,
  PhoneE164,
  PositionId,
  Profile,
  ProfileCreateInput,
  ProfileUpdateInput,
  PublicProfile,
  PushPlatform,
  QrToken,
  RadiusKm,
  Sanction,
  SanctionId,
  SendMessageResult,
  SportId,
  Stars,
  TeamIndex,
  TranslatedMessage,
  Unsubscribe,
  UserId,
  UserReport,
  UserReportInput,
  UserSport,
  UserSportInput,
  Venue,
  VenueCreateInput,
  VenueId,
  VenueRating,
  VenueRatingInput,
  VenueReport,
  VenueReportReason,
} from '@st/domain';

/** Options for {@link GamesApi.nearbyGames}. */
export interface NearbyGamesOptions {
  /** Earliest `startsAt` (inclusive). Defaults to now. Use future ranges for travel planning. */
  from?: IsoDateTime;
  /** Latest `startsAt` (exclusive). Defaults to `from + 14 days`. */
  to?: IsoDateTime;
  /** Include games the viewer can see but that are full (waitlist). Default `true`. */
  includeFull?: boolean;
}

/** Cursor pagination for chat history. */
export interface ListMessagesOptions {
  /** Return messages created strictly before this time (older page). */
  before?: IsoDateTime;
  /** Page size, default 50, max 200. */
  limit?: number;
}

/** Options for {@link GamesApi.requestJoin}. */
export interface RequestJoinOptions {
  /** Position the player wants to play (must belong to the game's sport). */
  position?: PositionId | null;
  /** Required for private games when joining from an invite link. */
  inviteToken?: string;
}

/** Result of {@link AuthApi.sendOtp}. */
export interface OtpSent {
  /** Seconds until another code may be requested. */
  resendAfterSeconds: number;
}

// ---------------------------------------------------------------------------
// Sub-interfaces (adapters may implement them separately and compose)
// ---------------------------------------------------------------------------

/** Phone OTP authentication (Supabase Auth). */
export interface AuthApi {
  /** Sends an SMS code. Rejects `validation` for a malformed number, `rate_limited` when throttled. */
  sendOtp(phone: PhoneE164): Promise<OtpSent>;
  /** Verifies the code and starts a session. Rejects `otp_invalid` / `otp_expired`. */
  verifyOtp(phone: PhoneE164, code: string): Promise<AuthUser>;
  /** Ends the session and unregisters this device's push token. */
  signOut(): Promise<void>;
  /** The signed-in user, or `null`. Never rejects with `unauthenticated`. */
  currentUser(): Promise<AuthUser | null>;
  /** Fires on sign-in, sign-out, token refresh and profile creation. Returns synchronously. */
  onAuthStateChange(listener: (user: AuthUser | null) => void): Unsubscribe;
}

/** Profiles, sports and account lifecycle. */
export interface ProfileApi {
  /** The caller's profile, or `null` before onboarding. */
  getMyProfile(): Promise<Profile | null>;
  /**
   * Creates the caller's profile (onboarding). Rejects `age_restricted` when under
   * `MIN_AGE_YEARS`, `conflict` if a profile exists.
   */
  createProfile(input: ProfileCreateInput): Promise<Profile>;
  updateProfile(patch: ProfileUpdateInput): Promise<Profile>;
  /** Another user's public card, or `null` if not found, blocked or visibility-restricted. */
  getPublicProfile(userId: UserId): Promise<PublicProfile | null>;
  listUserSports(userId: UserId): Promise<UserSport[]>;
  /** Replaces the caller's sports with `sports` (at most one entry per sport). */
  setMySports(sports: readonly UserSportInput[]): Promise<UserSport[]>;
  /**
   * Deletes the account in-app (Apple 5.1.1(v), Play): personal data erased,
   * sanctions kept pseudonymised, deposits released, session ended.
   * Irreversible; the UI must confirm first.
   */
  deleteAccount(): Promise<void>;
}

/** Venues on the map. */
export interface VenuesApi {
  /**
   * Active venues within `radiusKm` of `center` offering any of `sports`
   * (empty = all sports). Rejects `too_many_sports` above `MAX_SPORT_FILTERS`,
   * `invalid_radius` for a radius outside `RADII_KM`. Sorted by distance.
   */
  nearbyVenues(center: LatLng, radiusKm: RadiusKm, sports: readonly SportId[]): Promise<NearbyVenue[]>;
  getVenue(venueId: VenueId): Promise<Venue | null>;
  createVenue(input: VenueCreateInput): Promise<Venue>;
  /** Upserts the caller's rating for (venue, sport). Attributes are validated per sport. */
  rateVenue(input: VenueRatingInput): Promise<VenueRating>;
  /** Reports a venue once per user (`already_reported` otherwise). The third distinct report hides it pending review. */
  reportVenue(venueId: VenueId, reason: VenueReportReason, note?: string): Promise<VenueReport>;
}

/** Games, joining and hosting. */
export interface GamesApi {
  /**
   * Visible games within `radiusKm` of `center` for any of `sports` (empty = all),
   * excluding blocked hosts and visibility-restricted users' games. Same
   * validation as {@link VenuesApi.nearbyVenues}. Sorted by `startsAt`.
   */
  nearbyGames(
    center: LatLng,
    radiusKm: RadiusKm,
    sports: readonly SportId[],
    options?: NearbyGamesOptions,
  ): Promise<NearbyGame[]>;
  /** `null` when the game does not exist or the caller may not see it. */
  getGame(gameId: GameId): Promise<GameDetail | null>;
  /** Resolves an invite link token to its game (grants visibility of a private game). */
  resolveInvite(inviteToken: string): Promise<GameDetail | null>;
  /** Games the caller hosts or participates in, upcoming first. */
  listMyGames(): Promise<GameDetail[]>;
  /**
   * Rejects `host_suspended`, `account_banned`, `validation` (including
   * `minPlayers` outside 2..capacity). The caller becomes host and an approved participant.
   */
  createGame(input: GameCreateInput): Promise<GameDetail>;
  /** Host only. Releases deposits and notifies participants. */
  cancelGame(gameId: GameId): Promise<GameDetail>;
  /**
   * Requests to join; the host is notified by push. Rejects `join_banned`,
   * `women_only`, `blocked`, `game_not_open`. When the game has a deposit the
   * result carries a {@link JoinResult.deposit} the UI must complete via the
   * payment sheet.
   */
  requestJoin(gameId: GameId, options?: RequestJoinOptions): Promise<JoinResult>;
  /**
   * Host only. Approving when full puts the player on the waitlist
   * (`waitlisted`); the player is notified either way.
   */
  decideJoin(gameId: GameId, userId: UserId, decision: JoinDecision): Promise<Participant>;
  /** Host only. Removes an approved/waitlisted player (`removed`), promoting the waitlist. */
  removeParticipant(gameId: GameId, userId: UserId): Promise<Participant>;
  /**
   * The caller withdraws and the freed spot is offered to the waitlist. Within
   * `lateCancelWindowHours` of start this is a late cancel
   * (`participant.lateCancel`); the yellow card is decided only at finalisation
   * (`endsAt + finalizeAfterEndHours`) and is skipped if a waitlisted player
   * took the spot and checked in (TRUST-021). `CancelResult.sanction` is always `null`.
   */
  cancelParticipation(gameId: GameId): Promise<CancelResult>;
  /**
   * A waitlisted caller accepts the spot offered to them (`participant.offerExpiresAt`,
   * notification `waitlist_offer`) and becomes `approved` (SQL `accept_waitlist_offer`).
   * In a flash fill the first to accept wins. Rejects `game_not_open` (cancelled or
   * started), `not_found` (no offer), `outside_window` (offer expired), `game_full`
   * (someone else took it). With a deposit, the payment method must then be secured
   * (`participant.paymentReady`).
   */
  acceptWaitlistOffer(gameId: GameId): Promise<Participant>;
  /** Participants visible to the caller (approved players see each other; host sees requests too). */
  listParticipants(gameId: GameId): Promise<ParticipantView[]>;
  /** Host only. Saves team assignments (e.g. from squad balancing). Missing users become unassigned. */
  saveTeams(gameId: GameId, assignments: Readonly<Record<UserId, TeamIndex>>): Promise<ParticipantView[]>;
  /** Approved participant or host, until `resultWindowHours` after end (`outside_window` otherwise). */
  submitResult(gameId: GameId, teamScores: readonly number[]): Promise<GameResult>;
  getResult(gameId: GameId): Promise<GameResult | null>;
  /** Approved, verified participants only, once per game, after the game ends. */
  rateHost(gameId: GameId, stars: Stars): Promise<void>;
  /** The caller's deposit for a game, if any. */
  getMyPayment(gameId: GameId): Promise<Payment | null>;
}

/** Attendance verification. */
export interface CheckInApi {
  /**
   * Verifies attendance server side (`checkin-verify`). A rejected verdict is
   * returned (not thrown) and lists fallbacks; spoofing signals never sanction.
   * `host` requests must come from the host.
   */
  submitCheckIn(gameId: GameId, request: CheckInRequest): Promise<CheckInVerdict>;
  /** A verified attendee vouches for `targetUserId`. */
  peerConfirm(gameId: GameId, targetUserId: UserId): Promise<PeerConfirmResult>;
  /** Host only. The current rotating QR token; poll or refresh at `expiresAt`. */
  getQrToken(gameId: GameId): Promise<QrToken>;
  /** Host only. Replaces the game's QR secret (invalidates screenshots) and returns a fresh token. */
  rotateQr(gameId: GameId): Promise<QrToken>;
}

/** Reports, blocks, sanctions and appeals. */
export interface TrustApi {
  reportUser(input: UserReportInput): Promise<UserReport>;
  /** Blocking hides both users from each other everywhere and excludes the pair from peer check-in. */
  blockUser(userId: UserId): Promise<void>;
  unblockUser(userId: UserId): Promise<void>;
  listBlocked(): Promise<Block[]>;
  /** The caller's sanctions, newest first, including expired and overturned ones. */
  listMySanctions(): Promise<Sanction[]>;
  getSanction(sanctionId: SanctionId): Promise<Sanction | null>;
  /**
   * Disputes (within `disputeUntil`) or appeals a sanction; a human decides.
   * Rejects `conflict` when an open appeal exists.
   */
  fileAppeal(sanctionId: SanctionId, text: string): Promise<Appeal>;
  listMyAppeals(): Promise<Appeal[]>;
}

/** Ephemeral game chat. Readable by approved participants until `expiresAt`. */
export interface ChatApi {
  /** Newest first. */
  listMessages(gameId: GameId, options?: ListMessagesOptions): Promise<ChatMessage[]>;
  /**
   * Sends through the moderation pipeline (`send-message`). A block is a
   * resolved result with `message: null`, not a rejection. Rejects `chat_muted`
   * while muted. `clientMsgId` makes retries idempotent.
   */
  sendMessage(gameId: GameId, body: string, clientMsgId: string): Promise<SendMessageResult>;
  /**
   * Live chat events for one game. Returns synchronously; the subscription
   * reconnects internally. The listener may receive a message also returned by
   * `sendMessage`/`listMessages`; dedupe by `id`.
   */
  subscribeChat(gameId: GameId, listener: (event: ChatEvent) => void): Unsubscribe;
  /** Translates into `target` (cached per message+language). */
  translateMessage(messageId: MessageId, target: Locale): Promise<TranslatedMessage>;
}

/** Push tokens and the in-app notification inbox. */
export interface NotificationsApi {
  /** Idempotent per (token, platform). Call after permission is granted and on token refresh. */
  registerPushToken(token: string, platform: PushPlatform): Promise<void>;
  unregisterPushToken(token: string): Promise<void>;
  /** Newest first. */
  listNotifications(options?: { before?: IsoDateTime; limit?: number }): Promise<Notification[]>;
  markNotificationsRead(ids: readonly NotificationId[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Phase 1.5 (contract v3)
// ---------------------------------------------------------------------------

/** Recurring series, occurrences and rosters (GAME-010/011). */
export interface SeriesApi {
  /**
   * Creates a series and its first `horizonWeeks` of occurrences (the host is
   * on the roster and approved in each). Rejects `validation` (duration outside
   * 30–240, `rosterPriorityHours` outside 6–72, unknown time zone, …),
   * `host_suspended`, `account_banned`.
   */
  createSeries(input: GameSeriesCreateInput): Promise<GameSeriesDetail>;
  /** `null` when missing or not visible. */
  getSeries(seriesId: SeriesId): Promise<GameSeriesDetail | null>;
  /** Series the caller hosts or is a regular of. */
  listMySeries(): Promise<GameSeries[]>;
  /**
   * Host only. `scope: 'this'` edits one occurrence; `'following'` edits the
   * template from the pivot on (schedule changes reschedule later occurrences).
   * Rejects `outside_window` for an occurrence that has started (or, when moving
   * it, is within `lateCancelWindowHours`), `validation` for invalid fields.
   */
  editSeries(seriesId: SeriesId, edit: SeriesEdit): Promise<GameSeriesDetail>;
  /** Host only. Ends the series; later occurrences are cancelled (`series_ended`). */
  endSeries(seriesId: SeriesId): Promise<GameSeries>;
  /** Generated occurrences, earliest first (`from` inclusive / `to` exclusive on `startsAt`). */
  listOccurrences(seriesId: SeriesId, options?: { from?: IsoDateTime; to?: IsoDateTime }): Promise<SeriesOccurrence[]>;
  /**
   * Host only. Skips the occurrence on `occurrenceKey` (generated or not yet).
   * Inside `lateCancelWindowHours` with participants this counts as a host late
   * game cancellation (TRUST-051(c)).
   */
  skipOccurrence(seriesId: SeriesId, occurrenceKey: string): Promise<SeriesOccurrence>;
  /** Roster (host sees all; regulars see regulars). */
  listRoster(seriesId: SeriesId): Promise<RosterMemberView[]>;
  /** Host only. Invites a user (e.g. from "played with"); they become `invited` until they accept. */
  inviteToRoster(seriesId: SeriesId, userId: UserId): Promise<RosterMember>;
  /** The caller accepts a roster invite (`invited` → `regular`). */
  acceptRosterInvite(seriesId: SeriesId): Promise<RosterMember>;
  /** Host only. Removes a member (`left`). Rejects `forbidden` for the host. */
  removeFromRoster(seriesId: SeriesId, userId: UserId): Promise<RosterMember>;
  /** The caller leaves the roster (no card, GAME-011). */
  leaveRoster(seriesId: SeriesId): Promise<RosterMember>;
  /** The caller's "I'm always in" flag. Applies to occurrences generated from now on. */
  setAlwaysIn(seriesId: SeriesId, alwaysIn: boolean): Promise<RosterMember>;
  /**
   * The caller answers the T−48h reconfirmation of an auto-join: `true` keeps
   * the spot, `false` releases it without a card (before the late window).
   */
  reconfirmAutoJoin(gameId: GameId, attending: boolean): Promise<Participant>;
}

/** Result confirmation, peer ratings and Glicko skill ratings (GAME-071, RATE-*, GLK-*). */
export interface RatingsApi {
  /** A verified participant confirms or disputes the submitted result (once; may change until the window closes). */
  confirmResult(gameId: GameId, verdict: ResultVerdict): Promise<ResultConfirmationSummary>;
  getResultConfirmation(gameId: GameId): Promise<ResultConfirmationSummary | null>;
  /** Whether the game counts for Glicko (GLK-003), e.g. "Not rated: too few verified players". */
  getGameRatingStatus(gameId: GameId): Promise<GameRatingEligibility>;
  /** Whether and whom the caller may rate after this game (RATE-001/002). */
  getRatingEligibility(gameId: GameId): Promise<RatingEligibility>;
  /** Rejects `forbidden` when ineligible, `outside_window` after `endsAt + 48h`, `validation` for >5 ratees. */
  submitPeerRatings(gameId: GameId, ratings: readonly PeerRatingInput[]): Promise<PeerRating[]>;
  /** The caller's Glicko ratings, one per sport and format family. */
  listMySkillRatings(): Promise<SkillRating[]>;
  /** The caller's private peer summary for a sport (RATE-004), or `null` without ratings. */
  getMyPeerSummary(sport: SportId): Promise<PeerSkillSummary | null>;
  /** Host only: 1–5 bands of the game's participants for balancing (never public). */
  getSkillBands(gameId: GameId): Promise<Readonly<Record<UserId, Stars>>>;
}

/** Media Vault (VAULT-001..009). */
export interface MediaApi {
  /** Published items of a game visible to the caller (participants), newest first. */
  listGameMedia(gameId: GameId): Promise<MediaItemView[]>;
  /** The venue vault: `venue_public` items only, newest first. */
  listVenueMedia(venueId: VenueId, options?: { from?: IsoDateTime; to?: IsoDateTime }): Promise<MediaItemView[]>;
  /**
   * Starts a direct upload. Rejects `forbidden` (not a verified attendee),
   * `outside_window` (before `startsAt` or after `endsAt + 2h`), `validation`
   * (size, duration or type; details carry the `MediaRejectReason`),
   * `rate_limited` (30 items per user per game).
   */
  createMediaUploadIntent(request: MediaUploadRequest): Promise<MediaUploadIntent>;
  /** Hands the uploaded object to the pre-publication pipeline; the item starts `processing`. */
  completeMediaUpload(mediaId: MediaId): Promise<MediaItem>;
  /** Uploader only. Creates tag *requests* (invisible until accepted). */
  tagMedia(mediaId: MediaId, userIds: readonly UserId[]): Promise<MediaTag[]>;
  /** The tagged caller accepts or declines a tag request. */
  respondToMediaTag(mediaId: MediaId, accept: boolean): Promise<MediaTag>;
  /** The tagged caller untags themselves; the item leaves `venue_public` when `removeFromPublic`. */
  untagMe(mediaId: MediaId, removeFromPublic: boolean): Promise<MediaTag>;
  /** Pending tag requests for the caller. */
  listMyTagRequests(): Promise<MediaTag[]>;
  /**
   * Uploader only. `venue_public` is applied only when every tag is accepted;
   * otherwise the opt-in is stored and the item stays `participants` (AC-VAULT-004/005).
   */
  setMediaVisibility(mediaId: MediaId, visibility: MediaVisibility): Promise<MediaItem>;
  /** Uploader (or moderator) only. */
  deleteMedia(mediaId: MediaId): Promise<void>;
}

/** Played-with, friends and network privacy. */
export interface NetworkApi {
  /** The caller's connections (blocked pairs excluded), most recent first. */
  listConnections(filter?: 'all' | 'friends' | 'played_with' | 'requests'): Promise<ConnectionView[]>;
  /** Rejects `blocked`, `conflict` when already friends or requested. Accepts an incoming request instead of duplicating. */
  requestFriend(userId: UserId): Promise<ConnectionView>;
  respondFriendRequest(userId: UserId, accept: boolean): Promise<ConnectionView>;
  /** Removes a friendship or withdraws a request; played-with stays. */
  removeFriend(userId: UserId): Promise<void>;
  getNetworkPrivacy(): Promise<NetworkPrivacy>;
  setNetworkPrivacy(audience: UpcomingGamesAudience): Promise<NetworkPrivacy>;
  /** Upcoming games of friends who share them with friends (blocks and visibility rules applied). */
  listFriendsUpcomingGames(): Promise<FriendUpcomingGame[]>;
}

/** Invite links, share messages and WhatsApp migration stats (PRD §5.4). */
export interface InviteApi {
  /** Host only. The current link with its rich preview. */
  getInviteLink(target: InviteTarget): Promise<InviteLink>;
  /** Host only. Rotates the token; old links stop working. */
  rotateInviteLink(target: InviteTarget): Promise<InviteLink>;
  /** The localisable share text (key + params) for the share sheet / `wa.me`. */
  getShareMessage(target: InviteTarget, locale: Locale): Promise<ShareMessage>;
  /** Resolves a series invite token (grants visibility of a private series). */
  resolveSeriesInvite(inviteToken: string): Promise<GameSeriesDetail | null>;
  /** Joins the series roster through its link (`joinedVia: 'invite_link'`). */
  joinSeriesViaInvite(inviteToken: string): Promise<RosterMember>;
  /** Host only. */
  getMigrationStats(target: InviteTarget): Promise<MigrationStats>;
}

/** Edit scope re-exported for screens that build {@link SeriesEdit}s. */
export type { EditScope };

/**
 * The complete data access surface used by the app. Obtain the active
 * implementation from the data provider (`useData()`); never instantiate an
 * adapter inside a screen.
 */
export interface DataPort
  extends AuthApi,
    ProfileApi,
    VenuesApi,
    GamesApi,
    CheckInApi,
    TrustApi,
    ChatApi,
    NotificationsApi,
    SeriesApi,
    RatingsApi,
    MediaApi,
    NetworkApi,
    InviteApi {}
