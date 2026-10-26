/**
 * InMemoryAdapter: a complete, deterministic fake backend (EXPO_PUBLIC_DATA=mock).
 *
 * Powers web e2e tests and demo mode. It mirrors the Supabase RPC/RLS behaviour
 * (visibility, masking of exact locations, participant visibility, error codes)
 * and takes every business rule from `@st/domain` (see ./mock/domain.ts), so
 * tests exercise the same rules as SQL and Edge Functions.
 *
 * Moderation: the domain blocklist + verdict combiner run with a local stand-in
 * for the server providers (omni-moderation / LLM), which only exist server side.
 * Not yet mirrored: report evaluation (visibility restriction) and card
 * escalation bans, which run in SQL in production.
 */
import {
  DEFAULT_TRUST_CONFIG,
  LOCALES,
  MAX_SPORT_FILTERS,
  MIN_AGE_YEARS,
  SPORT_IDS,
  SPORT_POSITIONS,
  StError,
  isRadiusKm,
  isStError,
  type Appeal,
  type AuthUser,
  type Block,
  type CancelResult,
  type ChatEvent,
  type ChatMessage,
  type CheckInRequest,
  type CheckInVerdict,
  type DepositSetup,
  type EpochMs,
  type GameCreateInput,
  type GameDetail,
  type GameId,
  type GameResult,
  type GameSummary,
  type IsoDateTime,
  type JoinDecision,
  type JoinResult,
  type LatLng,
  type Locale,
  type MessageId,
  type ModerationVerdict,
  type NearbyGame,
  type NearbyVenue,
  type Notification,
  type NotificationId,
  type NotificationKind,
  type NotificationParams,
  type Participant,
  type ParticipantView,
  type Payment,
  type PeerConfirmResult,
  type PhoneE164,
  type PositionId,
  type Profile,
  type ProfileCreateInput,
  type ProfileUpdateInput,
  type PublicProfile,
  type PushPlatform,
  type QrToken,
  type RadiusKm,
  type Sanction,
  type SanctionId,
  type SendMessageResult,
  type SportId,
  type Stars,
  type TeamIndex,
  type TranslatedMessage,
  type TrustConfig,
  type Unsubscribe,
  type UserId,
  type UserReport,
  type UserReportInput,
  type UserSport,
  type UserSportInput,
  type Venue,
  type VenueCreateInput,
  type VenueId,
  type VenueRating,
  type VenueRatingInput,
  type VenueReport,
  type VenueReportReason,
  type WaitlistOffer,
  type Effect,
} from '@st/domain';

import type { DataPort, ListMessagesOptions, NearbyGamesOptions, OtpSent, RequestJoinOptions } from './DataPort';
import { toStError } from './errors';
import {
  DAY_MS,
  HOUR_MS,
  acceptWaitlistOffer as acceptOffer,
  approximateLocation,
  buildSystemSanction,
  canDispute,
  canSubmitResult,
  chatExpiresAt,
  checkCreateGameEligibility,
  checkJoinEligibility,
  combineModerationVerdicts,
  decideJoinOutcome,
  evaluateChatBlocks,
  generateQrToken,
  haversineMeters,
  isChatOpen,
  isLateCancel,
  matchBlocklist,
  materializeSanction,
  promoteFromWaitlist,
  toEpochMs,
  toIso,
  verifyGps,
  verifyHost,
  verifyPeer,
  verifyQr,
  type ChatBlockRecord,
} from './mock/domain';
import { buildSeed, MOCK_OTP_CODES } from './mock/seed';
import type { MockGame, MockState, MockUser } from './mock/state';

export interface InMemoryAdapterOptions {
  /** Clock (epoch ms). Defaults to `Date.now`. */
  now?: () => EpochMs;
  /** Artificial latency per call, to surface loading states in demos. Default 0. */
  latencyMs?: number;
  config?: TrustConfig;
  /** Custom seed (tests). */
  seed?: (now: EpochMs) => MockState;
}

const E164 = /^\+[1-9]\d{6,14}$/;
const ACTIVE_STATUSES = new Set(['requested', 'approved', 'waitlisted']);

/** Stand-in for the server moderation providers: obvious threats are blocked. */
const MOCK_PROVIDER_THREATS = [/\bkill you\b/i, /\bi will hurt\b/i, /\bbeat you up\b/i];

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function fail(code: ConstructorParameters<typeof StError>[0], message?: string): never {
  throw new StError(code, message);
}

export class InMemoryAdapter implements DataPort {
  private state: MockState;
  private session: UserId | null = null;
  private readonly authListeners = new Set<(user: AuthUser | null) => void>();
  private readonly chatListeners = new Map<GameId, Set<(event: ChatEvent) => void>>();
  private readonly otpSent = new Map<PhoneE164, EpochMs>();
  /** Waitlist taker (`game|user`) → the late canceller (`game|user`) whose spot they took. */
  private readonly refills = new Map<string, string>();
  /** Blocked messages per sender (`moderation_retained` stand-in, for the 3-blocks-in-7-days rule). */
  private readonly chatBlocks = new Map<UserId, ChatBlockRecord[]>();
  private readonly clock: () => EpochMs;
  private readonly latencyMs: number;
  private readonly config: TrustConfig;

  constructor(options: InMemoryAdapterOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.latencyMs = options.latencyMs ?? 0;
    this.config = options.config ?? DEFAULT_TRUST_CONFIG;
    this.state = (options.seed ?? buildSeed)(this.clock());
  }

  // ---------------------------------------------------------------------------
  // Infrastructure
  // ---------------------------------------------------------------------------

  private async run<T>(fn: () => T): Promise<T> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    else await Promise.resolve();
    try {
      return clone(fn());
    } catch (e) {
      throw isStError(e) ? e : toStError(e);
    }
  }

  private now(): EpochMs {
    return this.clock();
  }

  private nowIso(): IsoDateTime {
    return toIso(this.now());
  }

  private nextId(prefix: string): string {
    this.state.seq += 1;
    return `${prefix}-${this.state.seq}`;
  }

  private me(): UserId {
    if (!this.session) fail('unauthenticated');
    const u = this.state.users.get(this.session);
    if (!u || u.deleted) fail('unauthenticated');
    return this.session;
  }

  private meUser(): MockUser {
    return this.state.users.get(this.me()) as MockUser;
  }

  private myProfile(): Profile {
    const p = this.meUser().profile;
    if (!p) fail('forbidden', 'profile required');
    return p;
  }

  private authUser(u: MockUser): AuthUser {
    return { id: u.id, phone: u.phone, hasProfile: u.profile !== null, createdAt: u.createdAt };
  }

  private emitAuth(): void {
    const u = this.session ? this.state.users.get(this.session) : undefined;
    const value = u && !u.deleted ? this.authUser(u) : null;
    for (const l of [...this.authListeners]) l(clone(value));
  }

  private isBlocked(a: UserId, b: UserId): boolean {
    return this.state.blocks.some((x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a));
  }

  private isHiddenUser(id: UserId): boolean {
    const u = this.state.users.get(id);
    if (!u || u.deleted || !u.profile) return true;
    const p = u.profile;
    return p.permanentlyBanned || (p.visibilityRestrictedUntil !== null && toEpochMs(p.visibilityRestrictedUntil) > this.now());
  }

  private notify(userId: UserId, kind: NotificationKind, params: NotificationParams, gameId: GameId | null, sanctionId: SanctionId | null = null): void {
    this.state.notifications.push({
      id: this.nextId('n'),
      userId,
      kind,
      params,
      gameId,
      sanctionId,
      readAt: null,
      createdAt: this.nowIso(),
    });
  }

  // ---------------------------------------------------------------------------
  // Views (mirror game_views / participant_views / public_profiles)
  // ---------------------------------------------------------------------------

  private participant(gameId: GameId, userId: UserId): Participant | undefined {
    return this.state.participants.get(`${gameId}|${userId}`);
  }

  private participantsOf(gameId: GameId): Participant[] {
    return [...this.state.participants.values()].filter((p) => p.gameId === gameId);
  }

  private counts(gameId: GameId): { approved: number; waitlist: number } {
    let approved = 0;
    let waitlist = 0;
    for (const p of this.participantsOf(gameId)) {
      if (p.status === 'approved') approved++;
      else if (p.status === 'waitlisted') waitlist++;
    }
    return { approved, waitlist };
  }

  private canSeeGame(g: MockGame, viewer: UserId): boolean {
    if (g.hostId === viewer || this.participant(g.id, viewer)) return true;
    if (this.isBlocked(g.hostId, viewer) || this.isHiddenUser(g.hostId)) return false;
    return g.visibility === 'public' || this.state.inviteAccess.has(`${g.id}|${viewer}`);
  }

  private canSeeExact(g: MockGame, viewer: UserId): boolean {
    if (!g.hideExactLocation || g.hostId === viewer) return true;
    return this.participant(g.id, viewer)?.status === 'approved';
  }

  private summary(g: MockGame, viewer: UserId): GameSummary {
    const exact = this.canSeeExact(g, viewer);
    const { approved, waitlist } = this.counts(g.id);
    const { qrSecret: _secret, ...rest } = g;
    return {
      ...rest,
      venueId: exact ? g.venueId : null,
      location: exact ? g.location : null,
      approxLocation: g.hideExactLocation ? approximateLocation(g.location) : g.location,
      inviteToken: g.hostId === viewer ? g.inviteToken : null,
      approvedCount: approved,
      waitlistCount: waitlist,
    };
  }

  private publicOf(userId: UserId): PublicProfile {
    const u = this.state.users.get(userId);
    const p = u?.profile;
    if (!u || !p || u.deleted) {
      return {
        id: userId,
        displayName: '—',
        avatarUrl: null,
        reliabilityScore: null,
        reliabilityStatus: 'new',
        verifiedHost: false,
        memberSince: u?.createdAt ?? this.nowIso(),
      };
    }
    return {
      id: p.id,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      reliabilityScore: p.reliability.score,
      reliabilityStatus: p.reliability.status,
      verifiedHost: p.verifiedHost,
      memberSince: p.createdAt,
    };
  }

  private detail(g: MockGame, viewer: UserId): GameDetail {
    const s = this.summary(g, viewer);
    const venue = s.venueId ? (this.state.venues.get(s.venueId) ?? null) : null;
    return {
      ...s,
      host: this.publicOf(g.hostId),
      venue,
      myParticipation: (() => {
        const mine = this.participant(g.id, viewer);
        return mine ? this.withOffer(mine) : null;
      })(),
      isHost: g.hostId === viewer,
    };
  }

  private gameOr404(gameId: GameId, viewer: UserId): MockGame {
    const g = this.state.games.get(gameId);
    if (!g || !this.canSeeGame(g, viewer)) fail('not_found');
    return g;
  }

  private hostGame(gameId: GameId): MockGame {
    const me = this.me();
    const g = this.gameOr404(gameId, me);
    if (g.hostId !== me) fail('forbidden', 'host only');
    return g;
  }

  private visibleParticipants(g: MockGame, viewer: UserId): Participant[] {
    const isHost = g.hostId === viewer;
    const approvedViewer = this.participant(g.id, viewer)?.status === 'approved';
    return this.participantsOf(g.id).filter((p) => {
      if (p.userId === viewer || isHost) return true;
      return approvedViewer && (p.status === 'approved' || p.status === 'waitlisted') && !this.isBlocked(p.userId, viewer) && !this.isHiddenUser(p.userId);
    });
  }

  private rerankWaitlist(gameId: GameId): void {
    const waiting = this.participantsOf(gameId)
      .filter((p) => p.status === 'waitlisted')
      .sort((a, b) => (a.waitlistRank ?? 0) - (b.waitlistRank ?? 0) || a.requestedAt.localeCompare(b.requestedAt));
    waiting.forEach((p, i) => {
      p.waitlistRank = i + 1;
    });
  }

  private offersOf(gameId: GameId): WaitlistOffer[] {
    return [...this.state.offers.entries()].filter(([k]) => k.startsWith(`${gameId}|`)).map(([, o]) => o);
  }

  /** Applies the engine's Notify effects (other effect types are handled by the caller). */
  private applyNotify(effects: readonly Effect[], g: MockGame): void {
    for (const e of effects) {
      if (e.type !== 'Notify') continue;
      // The planner marks offers with `offer: 1`; contract v2 has a dedicated kind for them.
      const kind = e.params.offer ? 'waitlist_offer' : e.kind;
      this.notify(e.userId, kind, { gameTitle: g.title, time: g.startsAt, ...e.params }, e.gameId);
    }
  }

  /**
   * A spot freed up: plan waitlist offers with the domain rules (GAME-045: > 6 h the next player
   * gets 120 min, 6–1 h 20 min, < 1 h flash fill for everyone; none after start). Mirrors
   * `st_promote_waitlist`: nobody is moved automatically; players accept their offer.
   */
  private promoteWaitlist(g: MockGame): void {
    this.rerankWaitlist(g.id);
    const plan = promoteFromWaitlist({ game: g, participants: this.participantsOf(g.id), offers: this.offersOf(g.id) }, this.now());
    if (plan.freeSpots === 0) for (const k of [...this.state.offers.keys()]) if (k.startsWith(`${g.id}|`)) this.state.offers.delete(k);
    for (const o of plan.offers) this.state.offers.set(`${g.id}|${o.userId}`, o);
    this.applyNotify(plan.effects, g);
  }

  /** Participant snapshot with its active waitlist offer (participant_views offer columns). */
  private withOffer(p: Participant): Participant {
    const o = p.status === 'waitlisted' ? this.state.offers.get(`${p.gameId}|${p.userId}`) : undefined;
    return { ...p, offeredAt: o?.offeredAt ?? null, offerExpiresAt: o?.acceptBy ?? null, offerMode: o?.mode ?? null };
  }

  private settleDeposit(gameId: GameId, userId: UserId, outcome: 'released' | 'forfeited'): void {
    for (const p of this.state.payments) {
      if (p.gameId === gameId && p.userId === userId && (p.depositState === 'setup' || p.depositState === 'held')) {
        p.depositState = outcome;
        p.status = outcome === 'released' ? 'canceled' : 'succeeded';
        p.updatedAt = this.nowIso();
      }
    }
  }

  private issueSanction(args: Parameters<typeof buildSystemSanction>[0]): Sanction {
    return this.recordSanction(buildSystemSanction(args, this.now()));
  }

  /** Applies an `IssueSanction` effect: idempotent on `dedupeKey`, projects restrictions, notifies. */
  private recordSanction(newSanction: Parameters<typeof materializeSanction>[0]): Sanction {
    const existing = this.state.sanctions.find((x) => x.dedupeKey === newSanction.dedupeKey);
    if (existing) return existing;
    const s = {
      ...materializeSanction(newSanction, this.now()),
      appealPath: newSanction.disputeUntil ? 'dispute' : 'appeal',
      overturnedAt: null,
    } as Sanction;
    this.state.sanctions.push(s);
    this.notify(s.userId, 'sanction_issued', {}, s.gameId, s.id);
    const p = this.state.users.get(s.userId)?.profile;
    if (p && s.expiresAt) {
      if (s.kind === 'chat_mute') p.chatMutedUntil = s.expiresAt;
      if (s.kind === 'join_ban') p.joinBannedUntil = s.expiresAt;
      if (s.kind === 'yellow_card' && p.reliability.status === 'green') p.reliability.status = 'yellow';
    }
    return s;
  }

  private eligibilityUser(u: MockUser) {
    const p = u.profile;
    return {
      id: u.id,
      gender: u.privateData?.gender ?? 'undisclosed',
      permanentlyBanned: p?.permanentlyBanned ?? false,
      joinBannedUntil: p?.joinBannedUntil ?? null,
      visibilityRestrictedUntil: p?.visibilityRestrictedUntil ?? null,
      hostSuspendedUntil: p?.hostSuspendedUntil ?? null,
    };
  }

  private withDerivedStatus(s: Sanction): Sanction {
    if ((s.status === 'active' || s.status === 'upheld') && s.expiresAt && toEpochMs(s.expiresAt) <= this.now()) {
      return { ...s, status: 'expired' };
    }
    return s;
  }

  // ---------------------------------------------------------------------------
  // AuthApi
  // ---------------------------------------------------------------------------

  sendOtp(phone: PhoneE164): Promise<OtpSent> {
    return this.run(() => {
      if (!E164.test(phone)) fail('validation', 'phone');
      this.otpSent.set(phone, this.now());
      return { resendAfterSeconds: 30 };
    });
  }

  verifyOtp(phone: PhoneE164, code: string): Promise<AuthUser> {
    return this.run(() => {
      if (!E164.test(phone)) fail('validation', 'phone');
      const sentAt = this.otpSent.get(phone);
      if (sentAt === undefined || this.now() - sentAt > 10 * 60 * 1000) fail('otp_expired');
      if (!(MOCK_OTP_CODES as readonly string[]).includes(code.trim())) fail('otp_invalid');
      this.otpSent.delete(phone);
      let user = [...this.state.users.values()].find((u) => u.phone === phone && !u.deleted);
      if (!user) {
        user = { id: this.nextId('u-new'), phone, createdAt: this.nowIso(), profile: null, privateData: null, sports: [] };
        this.state.users.set(user.id, user);
      }
      this.session = user.id;
      const result = this.authUser(user);
      queueMicrotask(() => this.emitAuth());
      return result;
    });
  }

  signOut(): Promise<void> {
    return this.run(() => {
      this.session = null;
      queueMicrotask(() => this.emitAuth());
    });
  }

  currentUser(): Promise<AuthUser | null> {
    return this.run(() => {
      const u = this.session ? this.state.users.get(this.session) : undefined;
      return u && !u.deleted ? this.authUser(u) : null;
    });
  }

  onAuthStateChange(listener: (user: AuthUser | null) => void): Unsubscribe {
    this.authListeners.add(listener);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.authListeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // ProfileApi
  // ---------------------------------------------------------------------------

  getMyProfile(): Promise<Profile | null> {
    return this.run(() => this.meUser().profile);
  }

  createProfile(input: ProfileCreateInput): Promise<Profile> {
    return this.run(() => {
      const u = this.meUser();
      if (u.profile) fail('conflict');
      const name = input.displayName.trim();
      if (name.length < 1 || name.length > 40) fail('validation', 'displayName');
      if (!(LOCALES as readonly string[]).includes(input.locale)) fail('validation', 'locale');
      const now = new Date(this.now());
      const { birthYear: y, birthMonth: m } = input;
      if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < 1900 || y > now.getUTCFullYear()) {
        fail('validation', 'birth');
      }
      const monthsOld = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
      if (monthsOld < MIN_AGE_YEARS * 12) fail('age_restricted');
      const profile: Profile = {
        id: u.id,
        displayName: name,
        avatarUrl: input.avatarUrl ?? null,
        bio: input.bio ?? null,
        locale: input.locale,
        countryCode: input.countryCode ?? null,
        reliability: {
          score: null,
          status: 'new',
          verifiedCount: 0,
          commitmentCount: 0,
          lateCancelCount: 0,
          noShowCount: 0,
          computedAt: this.nowIso(),
        },
        verifiedHost: false,
        chatMutedUntil: null,
        joinBannedUntil: null,
        hostSuspendedUntil: null,
        visibilityRestrictedUntil: null,
        permanentlyBanned: false,
        createdAt: this.nowIso(),
      };
      u.profile = profile;
      u.privateData = { birthYear: y, birthMonth: m, gender: input.gender };
      queueMicrotask(() => this.emitAuth());
      return profile;
    });
  }

  updateProfile(patch: ProfileUpdateInput): Promise<Profile> {
    return this.run(() => {
      const u = this.meUser();
      const p = this.myProfile();
      if (patch.displayName !== undefined) {
        const name = patch.displayName.trim();
        if (name.length < 1 || name.length > 40) fail('validation', 'displayName');
        p.displayName = name;
      }
      if (patch.avatarUrl !== undefined) p.avatarUrl = patch.avatarUrl;
      if (patch.bio !== undefined) p.bio = patch.bio;
      if (patch.locale !== undefined) p.locale = patch.locale;
      if (patch.countryCode !== undefined) p.countryCode = patch.countryCode;
      if (patch.gender !== undefined && u.privateData) u.privateData.gender = patch.gender;
      return p;
    });
  }

  getPublicProfile(userId: UserId): Promise<PublicProfile | null> {
    return this.run(() => {
      const me = this.me();
      const u = this.state.users.get(userId);
      if (!u || u.deleted || !u.profile) return null;
      if (userId !== me && (this.isBlocked(me, userId) || this.isHiddenUser(userId))) return null;
      return this.publicOf(userId);
    });
  }

  listUserSports(userId: UserId): Promise<UserSport[]> {
    return this.run(() => {
      this.me();
      return this.state.users.get(userId)?.sports ?? [];
    });
  }

  setMySports(sports: readonly UserSportInput[]): Promise<UserSport[]> {
    return this.run(() => {
      const u = this.meUser();
      const seen = new Set<SportId>();
      for (const s of sports) {
        if (!(SPORT_IDS as readonly string[]).includes(s.sport) || seen.has(s.sport)) fail('validation', 'sport');
        seen.add(s.sport);
        const allowed = SPORT_POSITIONS[s.sport] as readonly string[];
        if (s.positions.some((p) => !allowed.includes(p)) || new Set(s.positions).size !== s.positions.length) {
          fail('validation', 'positions');
        }
      }
      u.sports = sports.map((s) => ({ ...s, userId: u.id }) as UserSport);
      return u.sports;
    });
  }

  deleteAccount(): Promise<void> {
    return this.run(() => {
      const u = this.meUser();
      const now = this.now();
      for (const p of this.state.participants.values()) {
        if (p.userId !== u.id || !ACTIVE_STATUSES.has(p.status)) continue;
        const g = this.state.games.get(p.gameId);
        if (!g || toEpochMs(g.endsAt) <= now) continue;
        const wasApproved = p.status === 'approved';
        p.status = 'cancelled';
        p.cancelledAt = toIso(now);
        this.settleDeposit(g.id, u.id, 'released');
        if (wasApproved) this.promoteWaitlist(g);
      }
      if (u.profile) {
        u.profile.displayName = 'Deleted user';
        u.profile.avatarUrl = null;
        u.profile.bio = null;
      }
      u.deleted = true;
      u.phone = null;
      u.privateData = null;
      u.sports = [];
      this.state.pushTokens = this.state.pushTokens.filter((t) => t.userId !== u.id);
      this.state.messages = this.state.messages.filter((m) => m.senderId !== u.id);
      this.session = null;
      queueMicrotask(() => this.emitAuth());
    });
  }

  // ---------------------------------------------------------------------------
  // VenuesApi
  // ---------------------------------------------------------------------------

  private validateMapQuery(radiusKm: RadiusKm, sports: readonly SportId[]): void {
    if (!isRadiusKm(radiusKm)) fail('invalid_radius');
    if (sports.length > MAX_SPORT_FILTERS) fail('too_many_sports');
    if (sports.some((s) => !(SPORT_IDS as readonly string[]).includes(s))) fail('validation', 'sport');
  }

  nearbyVenues(center: LatLng, radiusKm: RadiusKm, sports: readonly SportId[]): Promise<NearbyVenue[]> {
    return this.run(() => {
      this.me();
      this.validateMapQuery(radiusKm, sports);
      const out: NearbyVenue[] = [];
      for (const v of this.state.venues.values()) {
        if (v.status !== 'active') continue;
        if (sports.length && !v.sports.some((s) => sports.includes(s))) continue;
        const d = haversineMeters(center, v.location);
        if (d <= radiusKm * 1000) out.push({ ...v, distanceM: Math.round(d) });
      }
      return out.sort((a, b) => a.distanceM - b.distanceM);
    });
  }

  getVenue(venueId: VenueId): Promise<Venue | null> {
    return this.run(() => {
      this.me();
      const v = this.state.venues.get(venueId);
      return v && v.status !== 'removed' ? v : null;
    });
  }

  createVenue(input: VenueCreateInput): Promise<Venue> {
    return this.run(() => {
      const me = this.me();
      const name = input.name.trim();
      if (name.length < 1 || name.length > 120) fail('validation', 'name');
      if (!input.sports.length || input.sports.some((s) => !(SPORT_IDS as readonly string[]).includes(s))) fail('validation', 'sports');
      const venue: Venue = {
        id: this.nextId('v-new'),
        name,
        location: input.location,
        address: input.address ?? null,
        countryCode: this.myProfile().countryCode,
        sports: [...new Set(input.sports)],
        status: 'active',
        ratingAvg: null,
        ratingCount: 0,
        createdBy: me,
        createdAt: this.nowIso(),
      };
      this.state.venues.set(venue.id, venue);
      return venue;
    });
  }

  rateVenue(input: VenueRatingInput): Promise<VenueRating> {
    return this.run(() => {
      const me = this.me();
      const v = this.state.venues.get(input.venueId);
      if (!v || v.status !== 'active') fail('not_found');
      if (!v.sports.includes(input.sport)) fail('validation', 'sport');
      if (!Number.isInteger(input.overall) || input.overall < 1 || input.overall > 5) fail('validation', 'overall');
      const rating = { ...input, userId: me, createdAt: this.nowIso() } as VenueRating;
      const previous = this.state.venueRatings.find((r) => r.venueId === input.venueId && r.userId === me && r.sport === input.sport);
      this.state.venueRatings = this.state.venueRatings.filter((r) => r !== previous);
      this.state.venueRatings.push(rating);
      // Running mean over seeded + live ratings (an upsert replaces the caller's previous stars).
      const total = (v.ratingAvg ?? 0) * v.ratingCount - (previous?.overall ?? 0) + rating.overall;
      v.ratingCount += previous ? 0 : 1;
      v.ratingAvg = Math.round((total / v.ratingCount) * 1000) / 1000;
      return rating;
    });
  }

  reportVenue(venueId: VenueId, reason: VenueReportReason, note?: string): Promise<VenueReport> {
    return this.run(() => {
      const me = this.me();
      const v = this.state.venues.get(venueId);
      if (!v || v.status === 'removed') fail('not_found');
      if (this.state.venueReports.some((r) => r.venueId === venueId && r.reporterId === me)) fail('already_reported');
      const report: VenueReport = {
        id: this.nextId('vr'),
        venueId,
        reporterId: me,
        reason,
        note: note?.trim() || null,
        createdAt: this.nowIso(),
      };
      this.state.venueReports.push(report);
      const distinct = new Set(this.state.venueReports.filter((r) => r.venueId === venueId).map((r) => r.reporterId));
      if (distinct.size >= this.config.venueReportsToHide && v.status === 'active') v.status = 'hidden_pending_review';
      return report;
    });
  }

  // ---------------------------------------------------------------------------
  // GamesApi
  // ---------------------------------------------------------------------------

  nearbyGames(center: LatLng, radiusKm: RadiusKm, sports: readonly SportId[], options: NearbyGamesOptions = {}): Promise<NearbyGame[]> {
    return this.run(() => {
      const me = this.me();
      this.validateMapQuery(radiusKm, sports);
      const now = this.now();
      const from = options.from ? toEpochMs(options.from) : now;
      const to = options.to ? toEpochMs(options.to) : from + 14 * DAY_MS;
      const includeFull = options.includeFull ?? true;
      const out: NearbyGame[] = [];
      for (const g of this.state.games.values()) {
        if (g.status !== 'scheduled' || g.visibility !== 'public') continue;
        const start = toEpochMs(g.startsAt);
        if (start < from || start >= to || toEpochMs(g.endsAt) <= now) continue;
        if (sports.length && !sports.includes(g.sport)) continue;
        if (!this.canSeeGame(g, me)) continue;
        const s = this.summary(g, me);
        if (!includeFull && s.approvedCount >= s.capacity) continue;
        const d = haversineMeters(center, s.location ?? s.approxLocation);
        if (d <= radiusKm * 1000) out.push({ ...s, distanceM: Math.round(d) });
      }
      return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
    });
  }

  getGame(gameId: GameId): Promise<GameDetail | null> {
    return this.run(() => {
      const me = this.me();
      const g = this.state.games.get(gameId);
      return g && this.canSeeGame(g, me) ? this.detail(g, me) : null;
    });
  }

  resolveInvite(inviteToken: string): Promise<GameDetail | null> {
    return this.run(() => {
      const me = this.me();
      const g = [...this.state.games.values()].find((x) => x.inviteToken === inviteToken);
      if (!g || g.status === 'cancelled' || this.isBlocked(g.hostId, me)) return null;
      this.state.inviteAccess.add(`${g.id}|${me}`);
      return this.detail(g, me);
    });
  }

  listMyGames(): Promise<GameDetail[]> {
    return this.run(() => {
      const me = this.me();
      const now = this.now();
      const mine = [...this.state.games.values()].filter((g) => {
        if (g.hostId === me) return true;
        const p = this.participant(g.id, me);
        return !!p && (ACTIVE_STATUSES.has(p.status) || p.attendance !== 'unknown');
      });
      const upcoming = mine.filter((g) => toEpochMs(g.endsAt) > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const past = mine.filter((g) => toEpochMs(g.endsAt) <= now).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
      return [...upcoming, ...past].map((g) => this.detail(g, me));
    });
  }

  createGame(input: GameCreateInput): Promise<GameDetail> {
    return this.run(() => {
      const me = this.me();
      this.myProfile();
      const now = this.now();
      const eligible = checkCreateGameEligibility(this.eligibilityUser(this.meUser()), input, now);
      if (!eligible.ok) fail(eligible.error);
      const title = input.title.trim();
      if (title.length < 1 || title.length > 80) fail('validation', 'title');
      if (!(SPORT_IDS as readonly string[]).includes(input.sport)) fail('validation', 'sport');
      if (!Number.isInteger(input.capacity) || input.capacity < 2 || input.capacity > 200) fail('validation', 'capacity');
      if (!Number.isInteger(input.teamCount) || input.teamCount < 1 || input.teamCount > 16 || input.teamCount > input.capacity) {
        fail('validation', 'teamCount');
      }
      const start = toEpochMs(input.startsAt);
      const end = toEpochMs(input.endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > DAY_MS) fail('validation', 'time');
      if (start < now - 5 * 60 * 1000) fail('validation', 'startsAt');
      if (!Number.isInteger(input.depositMinor) || input.depositMinor < 0) fail('validation', 'deposit');
      if (!/^[A-Z]{3}$/.test(input.currency)) fail('validation', 'currency');
      let location: LatLng;
      if (input.venueId) {
        const v = this.state.venues.get(input.venueId);
        if (!v || v.status !== 'active') fail('validation', 'venueId');
        location = v.location;
      } else if (input.location) {
        location = input.location;
      } else {
        fail('validation', 'location');
      }
      const game: MockGame = {
        id: this.nextId('g-new'),
        hostId: me,
        sport: input.sport,
        title,
        notes: input.notes?.trim() || null,
        visibility: input.visibility,
        venueId: input.venueId,
        location,
        approxLocation: approximateLocation(location),
        hideExactLocation: input.hideExactLocation,
        capacity: input.capacity,
        startsAt: toIso(start),
        endsAt: toIso(end),
        depositMinor: input.depositMinor,
        currency: input.currency,
        depositForfeitTo: input.depositForfeitTo ?? 'pot',
        womenOnly: input.womenOnly,
        status: 'scheduled',
        minPlayers: input.minPlayers ?? 2,
        teamCount: input.teamCount,
        inviteToken: `inv-${this.state.seq}-${Math.floor(now / 1000).toString(36)}`,
        createdAt: toIso(now),
        qrSecret: `qr-secret-${this.state.seq}-${now}`,
      };
      this.state.games.set(game.id, game);
      this.state.participants.set(`${game.id}|${me}`, {
        gameId: game.id,
        userId: me,
        status: 'approved',
        attendance: 'unknown',
        team: null,
        position: null,
        waitlistRank: null,
        lateCancel: false,
        lateCancelRefilled: false,
        offeredAt: null,
        offerExpiresAt: null,
        offerMode: null,
        paymentReady: true,
        checkInMethod: null,
        checkedInAt: null,
        requestedAt: toIso(now),
        decidedAt: toIso(now),
        cancelledAt: null,
      });
      return this.detail(game, me);
    });
  }

  cancelGame(gameId: GameId): Promise<GameDetail> {
    return this.run(() => {
      const me = this.me();
      const g = this.hostGame(gameId);
      if (g.status !== 'scheduled') fail('conflict');
      g.status = 'cancelled';
      for (const p of this.participantsOf(g.id)) {
        if (!ACTIVE_STATUSES.has(p.status) || p.userId === me) continue;
        this.settleDeposit(g.id, p.userId, 'released');
        this.notify(p.userId, 'game_cancelled', { gameTitle: g.title, time: g.startsAt }, g.id);
      }
      return this.detail(g, me);
    });
  }

  requestJoin(gameId: GameId, options: RequestJoinOptions = {}): Promise<JoinResult> {
    return this.run(() => {
      const me = this.me();
      const profile = this.myProfile();
      const now = this.now();
      const raw = this.state.games.get(gameId);
      if (raw && options.inviteToken && options.inviteToken === raw.inviteToken) this.state.inviteAccess.add(`${gameId}|${me}`);
      const g = this.gameOr404(gameId, me);
      const existing = this.participant(gameId, me) ?? null;
      const eligible = checkJoinEligibility(
        {
          game: g,
          user: this.eligibilityUser(this.meUser()),
          existing,
          approvedUserIds: this.participantsOf(gameId).filter((p) => p.status === 'approved').map((p) => p.userId),
          blocks: this.state.blocks,
        },
        now,
      );
      if (!eligible.ok) fail(eligible.error);
      const position = options.position ?? null;
      if (position && !(SPORT_POSITIONS[g.sport] as readonly string[]).includes(position)) fail('validation', 'position');
      const participant: Participant = {
        gameId,
        userId: me,
        status: 'requested',
        attendance: 'unknown',
        team: null,
        position: position as PositionId | null,
        waitlistRank: null,
        lateCancel: false,
        lateCancelRefilled: false,
        offeredAt: null,
        offerExpiresAt: null,
        offerMode: null,
        paymentReady: true,
        checkInMethod: null,
        checkedInAt: null,
        requestedAt: toIso(now),
        decidedAt: null,
        cancelledAt: null,
      };
      this.state.participants.set(`${gameId}|${me}`, participant);
      this.notify(g.hostId, 'join_requested', { gameTitle: g.title, name: profile.displayName }, g.id);
      let deposit: DepositSetup | null = null;
      if (g.depositMinor > 0) {
        const payment: Payment = {
          id: this.nextId('pay'),
          userId: me,
          gameId,
          purpose: 'deposit',
          amount: { amountMinor: g.depositMinor, currency: g.currency },
          provider: 'fake',
          providerRef: null,
          status: 'requires_payment_method',
          depositState: 'setup',
          idempotencyKey: `deposit:${gameId}:${me}:setup`,
          createdAt: toIso(now),
          updatedAt: toIso(now),
        };
        this.state.payments.push(payment);
        deposit = {
          paymentId: payment.id,
          provider: 'fake',
          amount: payment.amount,
          clientSecret: `fake_seti_${payment.id}`,
          status: payment.status,
        };
      }
      return { participant, deposit };
    });
  }

  decideJoin(gameId: GameId, userId: UserId, decision: JoinDecision): Promise<Participant> {
    return this.run(() => {
      const g = this.hostGame(gameId);
      const p = this.participant(gameId, userId);
      if (!p) fail('not_found');
      if (p.status !== 'requested') fail('conflict');
      p.decidedAt = this.nowIso();
      if (decision === 'reject') {
        p.status = 'rejected';
        this.settleDeposit(gameId, userId, 'released');
        this.notify(userId, 'join_rejected', { gameTitle: g.title }, g.id);
        return p;
      }
      if (decideJoinOutcome(this.counts(gameId).approved, g.capacity) === 'approved') {
        p.status = 'approved';
        this.notify(userId, 'join_approved', { gameTitle: g.title, time: g.startsAt }, g.id);
      } else {
        p.status = 'waitlisted';
        p.waitlistRank = this.counts(gameId).waitlist;
        this.rerankWaitlist(gameId);
        this.notify(userId, 'join_waitlisted', { gameTitle: g.title, position: p.waitlistRank ?? 1 }, g.id);
      }
      return p;
    });
  }

  removeParticipant(gameId: GameId, userId: UserId): Promise<Participant> {
    return this.run(() => {
      const g = this.hostGame(gameId);
      if (userId === g.hostId) fail('validation', 'host');
      const p = this.participant(gameId, userId);
      if (!p || (p.status !== 'approved' && p.status !== 'waitlisted')) fail('not_found');
      const wasApproved = p.status === 'approved';
      p.status = 'removed';
      p.waitlistRank = null;
      p.decidedAt = this.nowIso();
      this.settleDeposit(gameId, userId, 'released');
      this.notify(userId, 'participant_removed', { gameTitle: g.title }, g.id);
      if (wasApproved) this.promoteWaitlist(g);
      else this.rerankWaitlist(gameId);
      return p;
    });
  }

  /** A waitlisted player takes the spot they were offered (first to accept wins in flash fill). */
  acceptWaitlistOffer(gameId: GameId): Promise<Participant> {
    return this.run(() => {
      const me = this.me();
      const g = this.gameOr404(gameId, me);
      const res = acceptOffer({ game: g, participants: this.participantsOf(gameId), offers: this.offersOf(gameId) }, me, this.now());
      if (!res.ok) fail(res.error);
      for (const e of res.value) {
        if (e.type !== 'PromoteWaitlist') continue;
        const p = this.participant(gameId, e.userId);
        if (!p) continue;
        p.status = 'approved';
        p.waitlistRank = null;
        p.decidedAt = this.nowIso();
        this.state.offers.delete(`${gameId}|${e.userId}`);
        // Link the taker to the earliest late canceller whose spot is not yet taken (TRUST-021).
        const taken = new Set(this.refills.values());
        const refill = this.participantsOf(gameId)
          .filter((x) => x.lateCancel && !taken.has(`${gameId}|${x.userId}`))
          .sort((a, b) => (a.cancelledAt ?? '').localeCompare(b.cancelledAt ?? ''))[0];
        if (refill) this.refills.set(`${gameId}|${e.userId}`, `${gameId}|${refill.userId}`);
      }
      this.applyNotify(res.value, g);
      this.rerankWaitlist(gameId);
      if (this.counts(gameId).approved >= g.capacity) {
        for (const k of [...this.state.offers.keys()]) if (k.startsWith(`${gameId}|`)) this.state.offers.delete(k);
      }
      return this.participant(gameId, me) as Participant;
    });
  }

  cancelParticipation(gameId: GameId): Promise<CancelResult> {
    return this.run(() => {
      const me = this.me();
      const g = this.gameOr404(gameId, me);
      if (g.hostId === me) fail('forbidden', 'host must cancel the game');
      const p = this.participant(gameId, me);
      if (!p || !ACTIVE_STATUSES.has(p.status)) fail('not_found');
      const nowIso = this.nowIso();
      const wasApproved = p.status === 'approved';
      const late = wasApproved && g.status === 'scheduled' && isLateCancel(g.startsAt, nowIso, this.config);
      p.status = 'cancelled';
      p.waitlistRank = null;
      p.cancelledAt = nowIso;
      p.lateCancel = late;
      // Contract v2: the card is decided at finalisation (endsAt + finalizeAfterEndHours), and is
      // waived when the spot was refilled from the waitlist (TRUST-021). See finalizeLateCancels().
      if (late) {
        const rel = this.myProfile().reliability;
        rel.lateCancelCount += 1;
        rel.commitmentCount += this.config.reliabilityLateCancelWeight;
      } else {
        this.settleDeposit(gameId, me, 'released');
      }
      if (wasApproved) this.promoteWaitlist(g);
      else this.rerankWaitlist(gameId);
      return { participant: p, sanction: null };
    });
  }

  /** Mirrors the finalisation job for the caller: late cancels not refilled become disputable yellow cards. */
  private finalizeLateCancels(userId: UserId): void {
    const now = this.now();
    for (const p of this.state.participants.values()) {
      if (p.userId !== userId || !p.lateCancel || p.lateCancelRefilled) continue;
      const g = this.state.games.get(p.gameId);
      if (!g || g.status === 'cancelled' || toEpochMs(g.endsAt) + this.config.finalizeAfterEndHours * HOUR_MS > now) continue;
      // No card when a waitlisted player took the spot and checked in.
      const replacement = [...this.refills.entries()].find(([, c]) => c === `${p.gameId}|${userId}`)?.[0];
      const taker = replacement ? this.state.participants.get(replacement) : undefined;
      if (taker?.attendance === 'verified') {
        p.lateCancelRefilled = true;
        continue;
      }
      this.issueSanction({
        kind: 'yellow_card',
        userId,
        reasonCode: 'late_cancel',
        statementParams: { date: g.startsAt, gameTitle: g.title, hours: this.config.lateCancelWindowHours },
        durationMs: this.config.yellowCardLifetimeDays * DAY_MS,
        disputeMs: this.config.disputeWindowHours * HOUR_MS,
        gameId: g.id,
        dedupeKey: `late_cancel:${g.id}:${userId}`,
      });
    }
  }

  listParticipants(gameId: GameId): Promise<ParticipantView[]> {
    return this.run(() => {
      const me = this.me();
      const g = this.gameOr404(gameId, me);
      return this.visibleParticipants(g, me).map((p) => ({ ...this.withOffer(p), profile: this.publicOf(p.userId) }));
    });
  }

  saveTeams(gameId: GameId, assignments: Readonly<Record<UserId, TeamIndex>>): Promise<ParticipantView[]> {
    return this.run(() => {
      const me = this.me();
      const g = this.hostGame(gameId);
      for (const [, team] of Object.entries(assignments)) {
        if (!Number.isInteger(team) || team < 0 || team >= g.teamCount) fail('validation', 'team');
      }
      for (const p of this.participantsOf(gameId)) {
        p.team = p.status === 'approved' && assignments[p.userId] !== undefined ? (assignments[p.userId] as number) : null;
      }
      return this.visibleParticipants(g, me).map((p) => ({ ...this.withOffer(p), profile: this.publicOf(p.userId) }));
    });
  }

  submitResult(gameId: GameId, teamScores: readonly number[]): Promise<GameResult> {
    return this.run(() => {
      const me = this.me();
      const g = this.gameOr404(gameId, me);
      if (g.hostId !== me && this.participant(gameId, me)?.status !== 'approved') fail('forbidden');
      if (!canSubmitResult(g, this.now(), this.config)) fail('outside_window');
      if (teamScores.length < 1 || teamScores.length > 16 || teamScores.some((s) => !Number.isInteger(s) || s < 0)) {
        fail('validation', 'teamScores');
      }
      const result: GameResult = { gameId, teamScores: [...teamScores], submittedBy: me, submittedAt: this.nowIso() };
      this.state.results.set(gameId, result);
      return result;
    });
  }

  getResult(gameId: GameId): Promise<GameResult | null> {
    return this.run(() => {
      this.gameOr404(gameId, this.me());
      return this.state.results.get(gameId) ?? null;
    });
  }

  rateHost(gameId: GameId, stars: Stars): Promise<void> {
    return this.run(() => {
      const me = this.me();
      const g = this.gameOr404(gameId, me);
      const p = this.participant(gameId, me);
      if (g.hostId === me || !p || p.status !== 'approved' || p.attendance !== 'verified') fail('forbidden');
      if (toEpochMs(g.endsAt) > this.now()) fail('outside_window');
      if (this.state.hostRatings.some((r) => r.gameId === gameId && r.raterId === me)) fail('conflict');
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) fail('validation', 'stars');
      this.state.hostRatings.push({ gameId, raterId: me, hostId: g.hostId, stars, createdAt: this.nowIso() });
    });
  }

  getMyPayment(gameId: GameId): Promise<Payment | null> {
    return this.run(() => {
      const me = this.me();
      const mine = this.state.payments.filter((p) => p.gameId === gameId && p.userId === me);
      return mine[mine.length - 1] ?? null;
    });
  }

  // ---------------------------------------------------------------------------
  // CheckInApi
  // ---------------------------------------------------------------------------

  private markVerified(gameId: GameId, userId: UserId, verdict: CheckInVerdict): void {
    if (verdict.outcome !== 'verified') return;
    const p = this.participant(gameId, userId);
    if (!p) return;
    p.attendance = 'verified';
    p.checkInMethod = verdict.method;
    p.checkedInAt = this.nowIso();
  }

  submitCheckIn(gameId: GameId, request: CheckInRequest): Promise<CheckInVerdict> {
    return this.run(() => {
      const me = this.me();
      const g = this.gameOr404(gameId, me);
      const now = this.now();
      if (request.method === 'host') {
        const target = this.participant(gameId, request.targetUserId) ?? null;
        const verdict = verifyHost({ actorId: me, game: g, target }, now, this.config);
        this.markVerified(gameId, request.targetUserId, verdict);
        return verdict;
      }
      const p = this.participant(gameId, me);
      if (!p || p.status !== 'approved') {
        return { outcome: 'rejected', method: request.method, reason: 'not_participant', fallbacks: [], signals: [] };
      }
      if (p.attendance === 'verified') {
        return { outcome: 'rejected', method: request.method, reason: 'already_checked_in', fallbacks: [], signals: [] };
      }
      const verdict =
        request.method === 'gps'
          ? verifyGps(request.samples, g.location, g, now, null, this.config)
          : verifyQr(request.token, g.qrSecret, g.id, now, this.config, g);
      this.markVerified(gameId, me, verdict);
      return verdict;
    });
  }

  peerConfirm(gameId: GameId, targetUserId: UserId): Promise<PeerConfirmResult> {
    return this.run(() => {
      const me = this.me();
      const g = this.gameOr404(gameId, me);
      const confirmer = this.participant(gameId, me);
      if (!confirmer || confirmer.status !== 'approved' || confirmer.attendance !== 'verified') fail('forbidden');
      if (targetUserId === me) fail('validation', 'self');
      if (!this.state.peerConfirmations.some((c) => c.gameId === gameId && c.confirmerId === me && c.targetId === targetUserId)) {
        this.state.peerConfirmations.push({ gameId, confirmerId: me, targetId: targetUserId });
      }
      const participants = this.participantsOf(gameId);
      const result = verifyPeer(
        {
          targetUserId,
          participants,
          confirmations: this.state.peerConfirmations.filter((c) => c.gameId === gameId),
          blocks: this.state.blocks.filter((b) => participants.some((p) => p.userId === b.blockerId || p.userId === b.blockedId)),
          window: g,
        },
        this.now(),
        this.config,
      );
      this.markVerified(gameId, targetUserId, result.verdict);
      return result;
    });
  }

  getQrToken(gameId: GameId): Promise<QrToken> {
    return this.run(() => {
      const g = this.hostGame(gameId);
      return generateQrToken(g.qrSecret, g.id, this.now(), this.config);
    });
  }

  rotateQr(gameId: GameId): Promise<QrToken> {
    return this.run(() => {
      const g = this.hostGame(gameId);
      g.qrSecret = `qr-secret-${g.id}-${this.nextId('rot')}-${this.now()}`;
      return generateQrToken(g.qrSecret, g.id, this.now(), this.config);
    });
  }

  // ---------------------------------------------------------------------------
  // TrustApi
  // ---------------------------------------------------------------------------

  reportUser(input: UserReportInput): Promise<UserReport> {
    return this.run(() => {
      const me = this.me();
      if (input.targetUserId === me) fail('validation', 'self');
      if (!this.state.users.has(input.targetUserId)) fail('not_found');
      const report: UserReport = {
        id: this.nextId('ur'),
        reporterId: me,
        targetUserId: input.targetUserId,
        category: input.category,
        gameId: input.gameId ?? null,
        messageId: input.messageId ?? null,
        note: input.note?.trim() || null,
        createdAt: this.nowIso(),
      };
      this.state.userReports.push(report);
      return report;
    });
  }

  blockUser(userId: UserId): Promise<void> {
    return this.run(() => {
      const me = this.me();
      if (userId === me) fail('validation', 'self');
      if (!this.state.users.has(userId)) fail('not_found');
      if (!this.state.blocks.some((b) => b.blockerId === me && b.blockedId === userId)) {
        this.state.blocks.push({ blockerId: me, blockedId: userId, createdAt: this.nowIso() });
      }
    });
  }

  unblockUser(userId: UserId): Promise<void> {
    return this.run(() => {
      const me = this.me();
      this.state.blocks = this.state.blocks.filter((b) => !(b.blockerId === me && b.blockedId === userId));
    });
  }

  listBlocked(): Promise<Block[]> {
    return this.run(() => {
      const me = this.me();
      return this.state.blocks.filter((b) => b.blockerId === me);
    });
  }

  listMySanctions(): Promise<Sanction[]> {
    return this.run(() => {
      const me = this.me();
      this.finalizeLateCancels(me);
      return this.state.sanctions
        .filter((s) => s.userId === me)
        .map((s) => this.withDerivedStatus(s))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  getSanction(sanctionId: SanctionId): Promise<Sanction | null> {
    return this.run(() => {
      const me = this.me();
      this.finalizeLateCancels(me);
      const s = this.state.sanctions.find((x) => x.id === sanctionId && x.userId === me);
      return s ? this.withDerivedStatus(s) : null;
    });
  }

  fileAppeal(sanctionId: SanctionId, text: string): Promise<Appeal> {
    return this.run(() => {
      const me = this.me();
      const s = this.state.sanctions.find((x) => x.id === sanctionId && x.userId === me);
      if (!s) fail('not_found');
      const body = text.trim();
      if (body.length < 1 || body.length > 2000) fail('validation', 'text');
      if (this.state.appeals.some((a) => a.sanctionId === sanctionId && a.status === 'open')) fail('conflict');
      const isDispute = canDispute(s, this.now());
      const appeal: Appeal = {
        id: this.nextId('ap'),
        sanctionId,
        userId: me,
        text: body,
        isDispute,
        status: 'open',
        decidedBy: null,
        decisionNote: null,
        decidedAt: null,
        createdAt: this.nowIso(),
      };
      this.state.appeals.push(appeal);
      if (isDispute) s.status = 'disputed';
      return appeal;
    });
  }

  listMyAppeals(): Promise<Appeal[]> {
    return this.run(() => {
      const me = this.me();
      return this.state.appeals.filter((a) => a.userId === me).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  // ---------------------------------------------------------------------------
  // ChatApi
  // ---------------------------------------------------------------------------

  private chatGame(gameId: GameId): MockGame {
    const me = this.me();
    const g = this.gameOr404(gameId, me);
    if (g.hostId !== me && this.participant(gameId, me)?.status !== 'approved') fail('forbidden');
    return g;
  }

  listMessages(gameId: GameId, options: ListMessagesOptions = {}): Promise<ChatMessage[]> {
    return this.run(() => {
      const me = this.me();
      const g = this.chatGame(gameId);
      if (!isChatOpen(g, this.now(), this.config)) return [];
      const limit = Math.max(1, Math.min(200, options.limit ?? 50));
      return this.state.messages
        .filter((m) => m.gameId === gameId && (!options.before || m.createdAt < options.before) && !this.isBlocked(me, m.senderId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    });
  }

  sendMessage(gameId: GameId, body: string, clientMsgId: string): Promise<SendMessageResult> {
    return this.run(() => {
      const me = this.me();
      const g = this.chatGame(gameId);
      const profile = this.myProfile();
      const now = this.now();
      if (profile.chatMutedUntil && toEpochMs(profile.chatMutedUntil) > now) fail('chat_muted');
      if (!isChatOpen(g, now, this.config)) fail('outside_window');
      const text = body.trim();
      if (text.length < 1 || text.length > 1000) fail('validation', 'body');
      const dup = this.state.messages.find((m) => m.gameId === gameId && m.senderId === me && m.clientMsgId === clientMsgId);
      if (dup) return { verdict: { decision: dup.moderation, categories: [], source: 'combined', reasonKey: null }, message: dup, mutedUntil: null };

      // Providers (omni-moderation + LLM) run server side; the stand-in flags obvious threats.
      const threat = MOCK_PROVIDER_THREATS.some((re) => re.test(text));
      const provider: ModerationVerdict = threat
        ? { decision: 'block', categories: ['threat'], source: 'omni', reasonKey: 'moderation.block.threat' }
        : { decision: 'allow', categories: [], source: 'omni', reasonKey: null };
      const verdict = combineModerationVerdicts({
        blocklist: matchBlocklist(text, profile.locale),
        omni: provider,
        llm: { ...provider, source: 'llm' },
      });
      if (verdict.decision === 'block') {
        const records = [...(this.chatBlocks.get(me) ?? []), { gameId, at: toIso(now) }];
        this.chatBlocks.set(me, records);
        const evaluation = evaluateChatBlocks(me, records, this.state.sanctions, now, this.config);
        let mutedUntil: IsoDateTime | null = null;
        for (const effect of evaluation.effects) {
          if (effect.type === 'IssueSanction') {
            const issued = this.recordSanction(effect.sanction);
            if (issued.kind === 'chat_mute') mutedUntil = issued.expiresAt;
          }
        }
        return { verdict, message: null, mutedUntil };
      }
      const message: ChatMessage = {
        id: this.nextId('m'),
        gameId,
        senderId: me,
        body: text,
        lang: null,
        clientMsgId,
        moderation: verdict.decision === 'nudge' ? 'nudge' : 'allow',
        retractedAt: null,
        createdAt: toIso(now),
        expiresAt: chatExpiresAt(g, this.config),
      };
      this.state.messages.push(message);
      const listeners = this.chatListeners.get(gameId);
      if (listeners) {
        const event: ChatEvent = { type: 'message', message: clone(message) };
        queueMicrotask(() => {
          for (const l of [...listeners]) l(clone(event));
        });
      }
      return { verdict, message, mutedUntil: null };
    });
  }

  subscribeChat(gameId: GameId, listener: (event: ChatEvent) => void): Unsubscribe {
    let set = this.chatListeners.get(gameId);
    if (!set) {
      set = new Set();
      this.chatListeners.set(gameId, set);
    }
    set.add(listener);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.chatListeners.get(gameId)?.delete(listener);
    };
  }

  translateMessage(messageId: MessageId, target: Locale): Promise<TranslatedMessage> {
    return this.run(() => {
      const m = this.state.messages.find((x) => x.id === messageId);
      if (!m) fail('not_found');
      this.chatGame(m.gameId);
      const cached = this.state.translations.find((t) => t.messageId === messageId && t.target === target);
      if (cached) return cached;
      const t: TranslatedMessage = { messageId, target, text: `[${target}] ${m.body}`, provider: 'google' };
      this.state.translations.push(t);
      return t;
    });
  }

  // ---------------------------------------------------------------------------
  // NotificationsApi
  // ---------------------------------------------------------------------------

  registerPushToken(token: string, platform: PushPlatform): Promise<void> {
    return this.run(() => {
      const me = this.me();
      if (token.length < 8 || token.length > 512) fail('validation', 'token');
      this.state.pushTokens = this.state.pushTokens.filter((t) => t.token !== token);
      this.state.pushTokens.push({ userId: me, token, platform });
    });
  }

  unregisterPushToken(token: string): Promise<void> {
    return this.run(() => {
      this.me();
      this.state.pushTokens = this.state.pushTokens.filter((t) => t.token !== token);
    });
  }

  listNotifications(options: { before?: IsoDateTime; limit?: number } = {}): Promise<Notification[]> {
    return this.run(() => {
      const me = this.me();
      const limit = Math.max(1, Math.min(200, options.limit ?? 50));
      return this.state.notifications
        .filter((n) => n.userId === me && (!options.before || n.createdAt < options.before))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    });
  }

  markNotificationsRead(ids: readonly NotificationId[]): Promise<void> {
    return this.run(() => {
      const me = this.me();
      const at = this.nowIso();
      for (const n of this.state.notifications) {
        if (n.userId === me && ids.includes(n.id) && !n.readAt) n.readAt = at;
      }
    });
  }
}
