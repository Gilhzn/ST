/**
 * SupabaseAdapter: production DataPort over supabase-js.
 *
 * Reads go through RLS-protected definer views (`game_views`, `participant_views`,
 * `public_profiles`, `venue_views`) or tables; every business write is a
 * SECURITY DEFINER RPC (raising `ST:<code>`) or an Edge Function (answering
 * `{ code }`). Chat is Realtime Broadcast on the private channel `game:<id>`;
 * messages are broadcast by `send-message`, never by clients.
 *
 * Server surface expected (parameter names use the `p_` convention of the migrations):
 *   RPC  nearby_venues(p_lat, p_lng, p_radius_km, p_sports)          → venue rows + lat, lng, distance_m
 *   RPC  nearby_games(p_lat, p_lng, p_radius_km, p_sports, p_from, p_to, p_include_full) → game_views rows + distance_m
 *   RPC  create_profile(p_display_name, p_locale, p_birth_year, p_birth_month, p_gender, p_country_code, p_avatar_url, p_bio)
 *   (user_sports: owner insert/delete under RLS)
 *   RPC  create_venue(p_name, p_lat, p_lng, p_sports, p_address)    → venue_views row
 *   RPC  rate_venue(p_venue_id, p_sport, p_overall, p_attributes)
 *   RPC  report_venue(p_venue_id, p_reason, p_note)
 *   RPC  create_game(p_sport, p_title, p_notes, p_visibility, p_venue_id, p_lat, p_lng, p_hide_exact_location,
 *                    p_capacity, p_starts_at, p_ends_at, p_deposit_minor, p_currency, p_deposit_forfeit_to,
 *                    p_women_only, p_team_count, p_min_players)       → game_views row
 *   RPC  cancel_game(p_game_id) · resolve_invite(p_token)               → game_views row | null
 *   RPC  request_join(p_game_id, p_position, p_invite_token)          → participant row
 *   RPC  decide_join(p_game_id, p_user_id, p_decision) · remove_participant(p_game_id, p_user_id)
 *   RPC  cancel_participation(p_game_id)                              → { participant, sanction: null }
 *   RPC  accept_waitlist_offer(p_game_id)                             → participant_views row
 *   RPC  save_teams(p_game_id, p_assignments jsonb) · submit_result(p_game_id, p_team_scores) · rate_host(p_game_id, p_stars)
 *   RPC  peer_confirm(p_game_id, p_target_user_id)                    → { confirmations, verdict }
 *   RPC  get_qr_token(p_game_id) · rotate_qr(p_game_id)               → { token, step, expires_at }
 *   RPC  report_user(p_target_user_id, p_category, p_game_id, p_message_id, p_note) · block_user / unblock_user(p_user_id)
 *   RPC  register_push_token(p_token, p_platform)
 *   RPC  file_appeal(p_sanction_id, p_text)
 *   EF   checkin-verify {gameId, request} → CheckInVerdict (uses submit_checkin internally)
 *   EF   create-deposit {gameId} → DepositSetup · send-message · translate-message · delete-account
 */
import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import {
  StError,
  buildShareMessage,
  inviteUrl,
  type ConnectionView,
  type FriendUpcomingGame,
  type GameNotRatedReason,
  type GameRatingEligibility,
  type GameSeries,
  type GameSeriesCreateInput,
  type GameSeriesDetail,
  type InviteLink,
  type InvitePreview,
  type InviteTarget,
  type MediaId,
  type MediaItem,
  type MediaItemView,
  type MediaTag,
  type MediaUploadIntent,
  type MediaUploadRequest,
  type MediaVisibility,
  type MigrationStats,
  type NetworkPrivacy,
  type PeerRating,
  type PeerRatingInput,
  type PeerSkillSummary,
  type RatingEligibility,
  type RatingUpdate,
  type ResultConfirmationSummary,
  type ResultVerdict,
  type RosterMember,
  type RosterMemberView,
  type SeriesEdit,
  type SeriesId,
  type SeriesOccurrence,
  type ShareMessage,
  type SkillRating,
  type UpcomingGamesAudience,
  type Appeal,
  type AuthUser,
  type Block,
  type CancelResult,
  type ChatEvent,
  type ChatMessage,
  type CheckInRequest,
  type CheckInVerdict,
  type DepositSetup,
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
  type NearbyGame,
  type NearbyVenue,
  type Notification,
  type NotificationId,
  type Participant,
  type ParticipantView,
  type Payment,
  type PeerConfirmResult,
  type PhoneE164,
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
} from '@st/domain';

import type { BlockedEntry, BlockedNameCache, BlockedNamesExtension } from './blocked';
import type { DataPort, ListMessagesOptions, NearbyGamesOptions, OtpSent, RequestJoinOptions } from './DataPort';
import { isErrorCode, toStError } from './errors';
import {
  mapAppeal,
  mapGameSummary,
  mapMessage,
  mapNotification,
  mapParticipant,
  mapPayment,
  mapProfile,
  mapPublicProfile,
  mapQrToken,
  mapResult,
  mapSanction,
  mapUserReport,
  mapUserSport,
  mapVenue,
  mapVenueRating,
  mapVenueReport,
  type Row,
} from './supabase/mappers';
import {
  mapConnectionView,
  mapMediaItem,
  mapMediaTag,
  mapNetworkPrivacy,
  mapOccurrence,
  mapPeerRating,
  mapRatingUpdate,
  mapResolvedSeries,
  mapRosterMember,
  mapSeries,
  mapSkillRating,
} from './supabase/mappers15';

export interface SupabaseAdapterOptions {
  url: string;
  anonKey: string;
}

interface QueryResult {
  data: unknown;
  error: unknown;
}

const OTP_RESEND_SECONDS = 30;
/** Private Storage bucket of the Media Vault (0191_storage_media.sql). */
const MEDIA_BUCKET = 'media';
/** Public web origin for invite links (`<origin>/invite/<token>`, `<origin>/invite/series/<token>`). */
const WEB_ORIGIN =
  process.env.EXPO_PUBLIC_WEB_ORIGIN ?? (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://sporttalent.app');

/** The device's IANA zone (one-off games carry it for invite previews and share texts). */
function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export class SupabaseAdapter implements DataPort, BlockedNamesExtension {
  private readonly sb: SupabaseClient;
  private readonly channels = new Map<GameId, { channel: RealtimeChannel; listeners: Set<(e: ChatEvent) => void> }>();

  constructor({ url, anonKey }: SupabaseAdapterOptions) {
    this.sb = createClient(url, anonKey, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: Platform.OS === 'web',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------

  /** Awaits a PostgREST/RPC builder and throws `StError` on failure. */
  private async q<T = unknown>(promise: PromiseLike<QueryResult>): Promise<T> {
    let res: QueryResult;
    try {
      res = await promise;
    } catch (e) {
      throw toStError(e, 'network');
    }
    if (res.error) throw toStError(res.error);
    return res.data as T;
  }

  private rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.q<T>(this.sb.rpc(fn, args));
  }

  /** Invokes an Edge Function; non-2xx bodies carry `{ code }`. */
  private async fn<T>(name: string, body: Record<string, unknown>): Promise<T> {
    let res: { data: unknown; error: unknown };
    try {
      res = await this.sb.functions.invoke(name, { body });
    } catch (e) {
      throw toStError(e, 'network');
    }
    if (res.error) {
      const ctx = (res.error as { context?: { json?: () => Promise<unknown> } }).context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          const payload = (await ctx.json()) as { code?: unknown; message?: unknown };
          if (isErrorCode(payload.code)) throw new StError(payload.code, typeof payload.message === 'string' ? payload.message : undefined);
        } catch (e) {
          if (e instanceof StError) throw e;
        }
      }
      throw toStError(res.error, 'unavailable');
    }
    return res.data as T;
  }

  private async session(): Promise<Session | null> {
    const { data, error } = await this.sb.auth.getSession();
    if (error) throw toStError(error);
    return data.session;
  }

  private async uid(): Promise<UserId> {
    const s = await this.session();
    if (!s) throw new StError('unauthenticated');
    return s.user.id;
  }

  private async toAuthUser(session: Session | null): Promise<AuthUser | null> {
    if (!session) return null;
    const rows = await this.q<Row[]>(this.sb.from('profiles').select('id').eq('id', session.user.id).limit(1));
    return {
      id: session.user.id,
      phone: session.user.phone ? `+${session.user.phone.replace(/^\+/, '')}` : null,
      hasProfile: rows.length > 0,
      createdAt: session.user.created_at,
    };
  }

  private async publicProfiles(ids: readonly UserId[]): Promise<Map<UserId, PublicProfile>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.q<Row[]>(this.sb.from('public_profiles').select('*').in('id', unique));
    return new Map(rows.map((r) => [String(r.id), mapPublicProfile(r)]));
  }

  private fallbackProfile(id: UserId): PublicProfile {
    return { id, displayName: '—', avatarUrl: null, reliabilityScore: null, reliabilityStatus: 'new', verifiedHost: false, memberSince: '' };
  }

  private async details(summaries: GameSummary[]): Promise<GameDetail[]> {
    if (!summaries.length) return [];
    const me = await this.uid();
    const ids = summaries.map((g) => g.id);
    const venueIds = summaries.map((g) => g.venueId).filter((v): v is string => !!v);
    const [hosts, venueRows, myRows] = await Promise.all([
      this.publicProfiles(summaries.map((g) => g.hostId)),
      venueIds.length ? this.q<Row[]>(this.sb.from('venue_views').select('*').in('id', venueIds)) : Promise.resolve([] as Row[]),
      this.q<Row[]>(this.sb.from('participant_views').select('*').eq('user_id', me).in('game_id', ids)),
    ]);
    const venues = new Map(venueRows.map((r) => [String(r.id), mapVenue(r)]));
    const mine = new Map(myRows.map((r) => [String(r.game_id), mapParticipant(r)]));
    return summaries.map((g) => ({
      ...g,
      host: hosts.get(g.hostId) ?? this.fallbackProfile(g.hostId),
      venue: g.venueId ? (venues.get(g.venueId) ?? null) : null,
      myParticipation: mine.get(g.id) ?? null,
      isHost: g.hostId === me,
    }));
  }

  private async gameById(gameId: GameId): Promise<GameDetail | null> {
    const rows = await this.q<Row[]>(this.sb.from('game_views').select('*').eq('id', gameId).limit(1));
    const row = rows[0];
    if (!row) return null;
    const [detail] = await this.details([mapGameSummary(row)]);
    return detail ?? null;
  }

  // ---------------------------------------------------------------------------
  // AuthApi
  // ---------------------------------------------------------------------------

  async sendOtp(phone: PhoneE164): Promise<OtpSent> {
    const { error } = await this.sb.auth.signInWithOtp({ phone });
    if (error) throw toStError(error);
    return { resendAfterSeconds: OTP_RESEND_SECONDS };
  }

  async verifyOtp(phone: PhoneE164, code: string): Promise<AuthUser> {
    const { data, error } = await this.sb.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (error) throw toStError(error, 'otp_invalid');
    const user = await this.toAuthUser(data.session);
    if (!user) throw new StError('otp_invalid');
    return user;
  }

  async signOut(): Promise<void> {
    for (const { channel } of this.channels.values()) void this.sb.removeChannel(channel);
    this.channels.clear();
    const { error } = await this.sb.auth.signOut();
    if (error) throw toStError(error);
  }

  async currentUser(): Promise<AuthUser | null> {
    try {
      return await this.toAuthUser(await this.session());
    } catch {
      return null;
    }
  }

  onAuthStateChange(listener: (user: AuthUser | null) => void): Unsubscribe {
    const { data } = this.sb.auth.onAuthStateChange((_event, session) => {
      // Never call supabase inside the callback synchronously (auth-js deadlock); defer.
      setTimeout(() => {
        this.toAuthUser(session)
          .then(listener)
          .catch(() => listener(null));
      }, 0);
    });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      data.subscription.unsubscribe();
    };
  }

  // ---------------------------------------------------------------------------
  // ProfileApi
  // ---------------------------------------------------------------------------

  async getMyProfile(): Promise<Profile | null> {
    const me = await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('profiles').select('*').eq('id', me).limit(1));
    return rows[0] ? mapProfile(rows[0]) : null;
  }

  async createProfile(input: ProfileCreateInput): Promise<Profile> {
    await this.uid();
    const row = await this.rpc<Row>('create_profile', {
      p_display_name: input.displayName,
      p_locale: input.locale,
      p_birth_year: input.birthYear,
      p_birth_month: input.birthMonth,
      p_gender: input.gender,
      p_country_code: input.countryCode ?? null,
      p_avatar_url: input.avatarUrl ?? null,
      p_bio: input.bio ?? null,
    });
    // Profile creation changes `hasProfile`; refresh so onAuthStateChange listeners fire.
    void this.sb.auth.refreshSession();
    return mapProfile(row);
  }

  async updateProfile(patch: ProfileUpdateInput): Promise<Profile> {
    const me = await this.uid();
    const { gender, ...rest } = patch;
    const columns: Row = {};
    if (rest.displayName !== undefined) columns.display_name = rest.displayName;
    if (rest.avatarUrl !== undefined) columns.avatar_url = rest.avatarUrl;
    if (rest.bio !== undefined) columns.bio = rest.bio;
    if (rest.locale !== undefined) columns.locale = rest.locale;
    if (rest.countryCode !== undefined) columns.country_code = rest.countryCode;
    if (gender !== undefined) await this.q(this.sb.from('profile_private').update({ gender }).eq('user_id', me));
    const rows = Object.keys(columns).length
      ? await this.q<Row[]>(this.sb.from('profiles').update(columns).eq('id', me).select('*'))
      : await this.q<Row[]>(this.sb.from('profiles').select('*').eq('id', me));
    if (!rows[0]) throw new StError('not_found');
    return mapProfile(rows[0]);
  }

  async getPublicProfile(userId: UserId): Promise<PublicProfile | null> {
    await this.uid();
    return (await this.publicProfiles([userId])).get(userId) ?? null;
  }

  async listUserSports(userId: UserId): Promise<UserSport[]> {
    await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('user_sports').select('*').eq('user_id', userId));
    return rows.map(mapUserSport);
  }

  async setMySports(sports: readonly UserSportInput[]): Promise<UserSport[]> {
    const me = await this.uid();
    const payload = sports.map((s) => ({ user_id: me, sport: s.sport, self_skill: s.selfSkill, attributes: s.attributes, positions: s.positions }));
    await this.q(this.sb.from('user_sports').delete().eq('user_id', me));
    if (!payload.length) return [];
    const rows = await this.q<Row[]>(this.sb.from('user_sports').insert(payload).select('*'));
    return rows.map(mapUserSport);
  }

  async deleteAccount(): Promise<void> {
    await this.uid();
    await this.fn('delete-account', {});
    await this.sb.auth.signOut({ scope: 'local' });
  }

  // ---------------------------------------------------------------------------
  // VenuesApi
  // ---------------------------------------------------------------------------

  async nearbyVenues(center: LatLng, radiusKm: RadiusKm, sports: readonly SportId[]): Promise<NearbyVenue[]> {
    await this.uid();
    const rows = await this.rpc<Row[]>('nearby_venues', {
      p_lat: center.lat,
      p_lng: center.lng,
      p_radius_km: radiusKm,
      p_sports: sports,
    });
    return (rows ?? []).map((r) => ({ ...mapVenue(r), distanceM: Number(r.distance_m ?? 0) }));
  }

  async getVenue(venueId: VenueId): Promise<Venue | null> {
    await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('venue_views').select('*').eq('id', venueId).limit(1));
    return rows[0] ? mapVenue(rows[0]) : null;
  }

  async createVenue(input: VenueCreateInput): Promise<Venue> {
    await this.uid();
    const row = await this.rpc<Row>('create_venue', {
      p_name: input.name,
      p_lat: input.location.lat,
      p_lng: input.location.lng,
      p_address: input.address ?? null,
      p_sports: input.sports,
    });
    return mapVenue(row);
  }

  async rateVenue(input: VenueRatingInput): Promise<VenueRating> {
    await this.uid();
    const row = await this.rpc<Row>('rate_venue', {
      p_venue_id: input.venueId,
      p_sport: input.sport,
      p_overall: input.overall,
      p_attributes: input.attributes,
    });
    return mapVenueRating(row);
  }

  async reportVenue(venueId: VenueId, reason: VenueReportReason, note?: string): Promise<VenueReport> {
    await this.uid();
    const row = await this.rpc<Row>('report_venue', { p_venue_id: venueId, p_reason: reason, p_note: note ?? null });
    return mapVenueReport(row);
  }

  // ---------------------------------------------------------------------------
  // GamesApi
  // ---------------------------------------------------------------------------

  async nearbyGames(center: LatLng, radiusKm: RadiusKm, sports: readonly SportId[], options: NearbyGamesOptions = {}): Promise<NearbyGame[]> {
    await this.uid();
    const rows = await this.rpc<Row[]>('nearby_games', {
      p_lat: center.lat,
      p_lng: center.lng,
      p_radius_km: radiusKm,
      p_sports: sports,
      p_from: options.from ?? null,
      p_to: options.to ?? null,
      p_include_full: options.includeFull ?? true,
    });
    return (rows ?? []).map((r) => ({ ...mapGameSummary(r), distanceM: Number(r.distance_m ?? 0) }));
  }

  async getGame(gameId: GameId): Promise<GameDetail | null> {
    await this.uid();
    return this.gameById(gameId);
  }

  async resolveInvite(inviteToken: string): Promise<GameDetail | null> {
    await this.uid();
    const row = await this.rpc<Row | null>('resolve_invite', { p_token: inviteToken });
    if (!row || row.id == null) return null;
    const [detail] = await this.details([mapGameSummary(row)]);
    return detail ?? null;
  }

  async listMyGames(): Promise<GameDetail[]> {
    const me = await this.uid();
    const mine = await this.q<Row[]>(
      this.sb.from('participant_views').select('game_id,status,attendance').eq('user_id', me),
    );
    const ids = mine
      .filter((r) => ['requested', 'approved', 'waitlisted'].includes(String(r.status)) || String(r.attendance) !== 'unknown')
      .map((r) => String(r.game_id));
    const filter = ids.length ? `host_id.eq.${me},id.in.(${ids.join(',')})` : `host_id.eq.${me}`;
    const rows = await this.q<Row[]>(this.sb.from('game_views').select('*').or(filter).order('starts_at'));
    const now = Date.now();
    const games = rows.map(mapGameSummary);
    const upcoming = games.filter((g) => Date.parse(g.endsAt) > now);
    const past = games.filter((g) => Date.parse(g.endsAt) <= now).reverse();
    return this.details([...upcoming, ...past]);
  }

  async createGame(input: GameCreateInput): Promise<GameDetail> {
    await this.uid();
    const row = await this.rpc<Row>('create_game', {
      p_sport: input.sport,
      p_title: input.title,
      p_notes: input.notes ?? null,
      p_visibility: input.visibility,
      p_venue_id: input.venueId,
      p_lat: input.location?.lat ?? null,
      p_lng: input.location?.lng ?? null,
      p_hide_exact_location: input.hideExactLocation,
      p_capacity: input.capacity,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_deposit_minor: input.depositMinor,
      p_currency: input.currency,
      p_deposit_forfeit_to: input.depositForfeitTo ?? 'pot',
      p_women_only: input.womenOnly,
      p_team_count: input.teamCount,
      p_min_players: input.minPlayers ?? 2,
      p_time_zone: deviceTimeZone(),
    });
    const [game] = await this.details([mapGameSummary(row)]);
    if (!game) throw new StError('unknown', 'created game not visible');
    return game;
  }

  async cancelGame(gameId: GameId): Promise<GameDetail> {
    await this.uid();
    await this.rpc('cancel_game', { p_game_id: gameId });
    const game = await this.gameById(gameId);
    if (!game) throw new StError('not_found');
    return game;
  }

  async requestJoin(gameId: GameId, options: RequestJoinOptions = {}): Promise<JoinResult> {
    await this.uid();
    const row = await this.rpc<Row>('request_join', {
      p_game_id: gameId,
      p_position: options.position ?? null,
      p_invite_token: options.inviteToken ?? null,
    });
    const participant = mapParticipant(row);
    const needsDeposit = row.payment_ready === false;
    const deposit = needsDeposit ? await this.fn<DepositSetup>('create-deposit', { gameId }) : null;
    return { participant, deposit };
  }

  async decideJoin(gameId: GameId, userId: UserId, decision: JoinDecision): Promise<Participant> {
    await this.uid();
    return mapParticipant(await this.rpc<Row>('decide_join', { p_game_id: gameId, p_user_id: userId, p_decision: decision }));
  }

  async removeParticipant(gameId: GameId, userId: UserId): Promise<Participant> {
    await this.uid();
    return mapParticipant(await this.rpc<Row>('remove_participant', { p_game_id: gameId, p_user_id: userId }));
  }

  async acceptWaitlistOffer(gameId: GameId): Promise<Participant> {
    await this.uid();
    return mapParticipant(await this.rpc<Row>('accept_waitlist_offer', { p_game_id: gameId }));
  }

  async cancelParticipation(gameId: GameId): Promise<CancelResult> {
    await this.uid();
    const res = await this.rpc<{ participant: Row; sanction: Row | null }>('cancel_participation', { p_game_id: gameId });
    // Contract v2: late-cancel cards are decided at finalisation, never at cancel time.
    return { participant: mapParticipant(res.participant), sanction: null };
  }

  async listParticipants(gameId: GameId): Promise<ParticipantView[]> {
    await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('participant_views').select('*').eq('game_id', gameId).order('requested_at'));
    const participants = rows.map(mapParticipant);
    const profiles = await this.publicProfiles(participants.map((p) => p.userId));
    return participants.map((p) => ({ ...p, profile: profiles.get(p.userId) ?? this.fallbackProfile(p.userId) }));
  }

  async saveTeams(gameId: GameId, assignments: Readonly<Record<UserId, TeamIndex>>): Promise<ParticipantView[]> {
    await this.uid();
    await this.rpc('save_teams', { p_game_id: gameId, p_assignments: assignments });
    return this.listParticipants(gameId);
  }

  async submitResult(gameId: GameId, teamScores: readonly number[]): Promise<GameResult> {
    await this.uid();
    return mapResult(await this.rpc<Row>('submit_result', { p_game_id: gameId, p_team_scores: teamScores }));
  }

  async getResult(gameId: GameId): Promise<GameResult | null> {
    await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('game_results').select('*').eq('game_id', gameId).limit(1));
    return rows[0] ? mapResult(rows[0]) : null;
  }

  async rateHost(gameId: GameId, stars: Stars): Promise<void> {
    await this.uid();
    await this.rpc('rate_host', { p_game_id: gameId, p_stars: stars });
  }

  async getMyPayment(gameId: GameId): Promise<Payment | null> {
    const me = await this.uid();
    const rows = await this.q<Row[]>(
      this.sb.from('payments').select('*').eq('game_id', gameId).eq('user_id', me).order('created_at', { ascending: false }).limit(1),
    );
    return rows[0] ? mapPayment(rows[0]) : null;
  }

  // ---------------------------------------------------------------------------
  // CheckInApi
  // ---------------------------------------------------------------------------

  async submitCheckIn(gameId: GameId, request: CheckInRequest): Promise<CheckInVerdict> {
    await this.uid();
    return this.fn<CheckInVerdict>('checkin-verify', { gameId, request });
  }

  async peerConfirm(gameId: GameId, targetUserId: UserId): Promise<PeerConfirmResult> {
    await this.uid();
    return this.rpc<PeerConfirmResult>('peer_confirm', { p_game_id: gameId, p_target_user_id: targetUserId });
  }

  async getQrToken(gameId: GameId): Promise<QrToken> {
    await this.uid();
    return mapQrToken(await this.rpc<Row>('get_qr_token', { p_game_id: gameId }));
  }

  async rotateQr(gameId: GameId): Promise<QrToken> {
    await this.uid();
    return mapQrToken(await this.rpc<Row>('rotate_qr', { p_game_id: gameId }));
  }

  // ---------------------------------------------------------------------------
  // TrustApi
  // ---------------------------------------------------------------------------

  async reportUser(input: UserReportInput): Promise<UserReport> {
    await this.uid();
    const row = await this.rpc<Row>('report_user', {
      p_target_user_id: input.targetUserId,
      p_category: input.category,
      p_game_id: input.gameId ?? null,
      p_message_id: input.messageId ?? null,
      p_note: input.note ?? null,
    });
    return mapUserReport(row);
  }

  async blockUser(userId: UserId): Promise<void> {
    const me = await this.uid();
    // public_profiles hides blocked pairs, so remember the name while it is still visible.
    const profile = (await this.publicProfiles([userId]).catch(() => new Map<UserId, PublicProfile>())).get(userId);
    await this.rpc('block_user', { p_user_id: userId });
    if (profile) await this.updateBlockedNames(me, (c) => ({ ...c, [userId]: { displayName: profile.displayName, avatarUrl: profile.avatarUrl } }));
  }

  async unblockUser(userId: UserId): Promise<void> {
    const me = await this.uid();
    await this.rpc('unblock_user', { p_user_id: userId });
    await this.updateBlockedNames(me, (c) => {
      const next = { ...c };
      delete next[userId];
      return next;
    });
  }

  /** {@link BlockedNamesExtension}: names come from this device's cache (see `blocked.ts`). */
  async listBlockedNamed(): Promise<BlockedEntry[]> {
    const me = await this.uid();
    const [blocks, cache] = await Promise.all([this.listBlocked(), this.readBlockedNames(me)]);
    return blocks.map((b) => ({ ...b, displayName: cache[b.blockedId]?.displayName ?? null, avatarUrl: cache[b.blockedId]?.avatarUrl ?? null }));
  }

  private blockedNamesKey(me: UserId): string {
    return `st.blockedNames.${me}`;
  }

  private async readBlockedNames(me: UserId): Promise<BlockedNameCache> {
    try {
      const raw = await AsyncStorage.getItem(this.blockedNamesKey(me));
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? (parsed as BlockedNameCache) : {};
    } catch {
      return {};
    }
  }

  private async updateBlockedNames(me: UserId, fn: (cache: BlockedNameCache) => BlockedNameCache): Promise<void> {
    try {
      await AsyncStorage.setItem(this.blockedNamesKey(me), JSON.stringify(fn(await this.readBlockedNames(me))));
    } catch {
      // Device cache only; the block itself already succeeded.
    }
  }

  async listBlocked(): Promise<Block[]> {
    const me = await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('blocks').select('*').eq('blocker_id', me).order('created_at', { ascending: false }));
    return rows.map((r) => ({ blockerId: String(r.blocker_id), blockedId: String(r.blocked_id), createdAt: String(r.created_at) }));
  }

  async listMySanctions(): Promise<Sanction[]> {
    const me = await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('sanctions').select('*').eq('user_id', me).order('created_at', { ascending: false }));
    return rows.map(mapSanction);
  }

  async getSanction(sanctionId: SanctionId): Promise<Sanction | null> {
    await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('sanctions').select('*').eq('id', sanctionId).limit(1));
    return rows[0] ? mapSanction(rows[0]) : null;
  }

  async fileAppeal(sanctionId: SanctionId, text: string): Promise<Appeal> {
    await this.uid();
    return mapAppeal(await this.rpc<Row>('file_appeal', { p_sanction_id: sanctionId, p_text: text }));
  }

  async listMyAppeals(): Promise<Appeal[]> {
    const me = await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('appeals').select('*').eq('user_id', me).order('created_at', { ascending: false }));
    return rows.map(mapAppeal);
  }

  // ---------------------------------------------------------------------------
  // ChatApi
  // ---------------------------------------------------------------------------

  async listMessages(gameId: GameId, options: ListMessagesOptions = {}): Promise<ChatMessage[]> {
    await this.uid();
    let query = this.sb
      .from('chat_messages')
      .select('*')
      .eq('game_id', gameId)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(200, options.limit ?? 50)));
    if (options.before) query = query.lt('created_at', options.before);
    const rows = await this.q<Row[]>(query);
    return rows.map(mapMessage);
  }

  async sendMessage(gameId: GameId, body: string, clientMsgId: string): Promise<SendMessageResult> {
    await this.uid();
    return this.fn<SendMessageResult>('send-message', { gameId, body, clientMsgId });
  }

  subscribeChat(gameId: GameId, listener: (event: ChatEvent) => void): Unsubscribe {
    let entry = this.channels.get(gameId);
    if (!entry) {
      const listeners = new Set<(e: ChatEvent) => void>();
      const dispatch = (event: ChatEvent) => {
        for (const l of [...listeners]) l(event);
      };
      const channel = this.sb
        .channel(`game:${gameId}`, { config: { private: true } })
        .on('broadcast', { event: 'message' }, ({ payload }) => {
          const p = payload as { message?: ChatMessage } | ChatMessage;
          const message = 'message' in p && p.message ? p.message : (p as ChatMessage);
          dispatch({ type: 'message', message });
        })
        .on('broadcast', { event: 'retracted' }, ({ payload }) => {
          const p = payload as { messageId: MessageId; at: IsoDateTime };
          dispatch({ type: 'retracted', messageId: p.messageId, at: p.at });
        })
        .subscribe();
      entry = { channel, listeners };
      this.channels.set(gameId, entry);
    }
    entry.listeners.add(listener);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const e = this.channels.get(gameId);
      if (!e) return;
      e.listeners.delete(listener);
      if (e.listeners.size === 0) {
        this.channels.delete(gameId);
        void this.sb.removeChannel(e.channel);
      }
    };
  }

  async translateMessage(messageId: MessageId, target: Locale): Promise<TranslatedMessage> {
    await this.uid();
    return this.fn<TranslatedMessage>('translate-message', { messageId, target });
  }

  // ---------------------------------------------------------------------------
  // NotificationsApi
  // ---------------------------------------------------------------------------

  async registerPushToken(token: string, platform: PushPlatform): Promise<void> {
    await this.uid();
    await this.rpc('register_push_token', { p_token: token, p_platform: platform });
  }

  async unregisterPushToken(token: string): Promise<void> {
    await this.uid();
    await this.q(this.sb.from('push_tokens').delete().eq('token', token));
  }

  async listNotifications(options: { before?: IsoDateTime; limit?: number } = {}): Promise<Notification[]> {
    const me = await this.uid();
    let query = this.sb
      .from('notifications')
      .select('*')
      .eq('user_id', me)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(200, options.limit ?? 50)));
    if (options.before) query = query.lt('created_at', options.before);
    return (await this.q<Row[]>(query)).map(mapNotification);
  }

  async markNotificationsRead(ids: readonly NotificationId[]): Promise<void> {
    const me = await this.uid();
    if (!ids.length) return;
    await this.q(this.sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me).in('id', [...ids]));
  }

  // ===========================================================================
  // Phase 1.5 (contract v3). RPCs from supabase/migrations/0100–0107 (errors `ST:<code>`):
  //   series: create_series(p_input jsonb) · update_series(p_series_id, p_scope, p_occurrence_key, p_patch)
  //           end_series · skip_occurrence · join_roster(p_token) · resolve_series_invite(p_token)
  //           invite_to_roster · accept_roster_invite · remove_from_roster · leave_roster · set_always_in
  //           reconfirm_auto_join · reads: series_views, series_occurrences, series_roster (RLS)
  //   ratings: confirm_result · result_confirmation · game_rating_status · rating_eligibility
  //            submit_peer_ratings · my_skill_ratings · my_peer_summary · game_skill_bands · rating_updates (RLS)
  //   media: EF media-upload (intent) → signed PUT → EF media-process; game_gallery · venue_vault
  //          tag_user · respond_tag · untag · set_visibility · delete_media · report_media · my_tag_requests
  //   network: list_network · request_friend · respond_friend · remove_friend · get/set_network_privacy
  //            friends_upcoming_games
  //   invites: get_invite_preview · rotate_invite_link(p_kind, p_id) · migration_stats(p_kind, p_id)
  // ===========================================================================

  private async seriesRow(seriesId: SeriesId): Promise<GameSeries | null> {
    const rows = await this.q<Row[]>(this.sb.from('series_views').select('*').eq('id', seriesId).limit(1));
    return rows[0] ? mapSeries(rows[0]) : null;
  }

  private async seriesDetailOf(series: GameSeries, rosterCount?: number): Promise<GameSeriesDetail> {
    const me = await this.uid();
    const [hosts, occRows, mine, counted] = await Promise.all([
      this.publicProfiles([series.hostId]),
      this.q<Row[]>(this.sb.from('series_occurrences').select('*').eq('series_id', series.id).order('starts_at')),
      this.q<Row[]>(this.sb.from('series_roster').select('*').eq('series_id', series.id).eq('user_id', me).limit(1)),
      rosterCount === undefined
        ? this.q<Row[]>(this.sb.from('series_views').select('roster_count').eq('id', series.id).limit(1))
        : Promise.resolve([{ roster_count: rosterCount }] as Row[]),
    ]);
    const now = Date.now();
    return {
      series,
      host: hosts.get(series.hostId) ?? this.fallbackProfile(series.hostId),
      upcoming: occRows.map(mapOccurrence).filter((o) => o.status !== 'cancelled' && Date.parse(o.endsAt) > now),
      rosterCount: Number(counted[0]?.roster_count ?? 0),
      myRoster: mine[0] ? mapRosterMember(mine[0]) : null,
      isHost: series.hostId === me,
    };
  }

  async createSeries(input: GameSeriesCreateInput): Promise<GameSeriesDetail> {
    await this.uid();
    const row = await this.rpc<Row>('create_series', { p_input: input });
    return this.seriesDetailOf(mapSeries(row), Number(row.roster_count ?? 0));
  }

  async getSeries(seriesId: SeriesId): Promise<GameSeriesDetail | null> {
    await this.uid();
    const s = await this.seriesRow(seriesId);
    return s ? this.seriesDetailOf(s) : null;
  }

  async listMySeries(): Promise<GameSeries[]> {
    const me = await this.uid();
    const rows = await this.q<Row[]>(
      this.sb.from('series_views').select('*').or(`host_id.eq.${me},my_roster_status.in.(regular,invited)`).order('title'),
    );
    return rows.map(mapSeries);
  }

  async editSeries(seriesId: SeriesId, edit: SeriesEdit): Promise<GameSeriesDetail> {
    await this.uid();
    const row = await this.rpc<Row>('update_series', {
      p_series_id: seriesId,
      p_scope: edit.scope,
      p_occurrence_key: edit.occurrenceKey,
      p_patch: edit.patch,
    });
    return this.seriesDetailOf(mapSeries(row), Number(row.roster_count ?? 0));
  }

  async endSeries(seriesId: SeriesId): Promise<GameSeries> {
    await this.uid();
    return mapSeries(await this.rpc<Row>('end_series', { p_series_id: seriesId }));
  }

  async listOccurrences(seriesId: SeriesId, options: { from?: IsoDateTime; to?: IsoDateTime } = {}): Promise<SeriesOccurrence[]> {
    await this.uid();
    let query = this.sb.from('series_occurrences').select('*').eq('series_id', seriesId);
    if (options.from) query = query.gte('starts_at', options.from);
    if (options.to) query = query.lt('starts_at', options.to);
    const rows = await this.q<Row[]>(query.order('starts_at'));
    return rows.map(mapOccurrence);
  }

  async skipOccurrence(seriesId: SeriesId, occurrenceKey: string): Promise<SeriesOccurrence> {
    await this.uid();
    return mapOccurrence(await this.rpc<Row>('skip_occurrence', { p_series_id: seriesId, p_occurrence_key: occurrenceKey }));
  }

  async listRoster(seriesId: SeriesId): Promise<RosterMemberView[]> {
    await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('series_roster').select('*').eq('series_id', seriesId).order('joined_at'));
    const members = rows.map(mapRosterMember);
    const profiles = await this.publicProfiles(members.map((m) => m.userId));
    return members.map((m) => ({ ...m, profile: profiles.get(m.userId) ?? this.fallbackProfile(m.userId) }));
  }

  async inviteToRoster(seriesId: SeriesId, userId: UserId): Promise<RosterMember> {
    await this.uid();
    return mapRosterMember(await this.rpc<Row>('invite_to_roster', { p_series_id: seriesId, p_user_id: userId }));
  }

  async acceptRosterInvite(seriesId: SeriesId): Promise<RosterMember> {
    await this.uid();
    return mapRosterMember(await this.rpc<Row>('accept_roster_invite', { p_series_id: seriesId }));
  }

  async removeFromRoster(seriesId: SeriesId, userId: UserId): Promise<RosterMember> {
    await this.uid();
    return mapRosterMember(await this.rpc<Row>('remove_from_roster', { p_series_id: seriesId, p_user_id: userId }));
  }

  async leaveRoster(seriesId: SeriesId): Promise<RosterMember> {
    await this.uid();
    return mapRosterMember(await this.rpc<Row>('leave_roster', { p_series_id: seriesId }));
  }

  async setAlwaysIn(seriesId: SeriesId, alwaysIn: boolean): Promise<RosterMember> {
    await this.uid();
    return mapRosterMember(await this.rpc<Row>('set_always_in', { p_series_id: seriesId, p_always_in: alwaysIn }));
  }

  async reconfirmAutoJoin(gameId: GameId, attending: boolean): Promise<Participant> {
    await this.uid();
    return mapParticipant(await this.rpc<Row>('reconfirm_auto_join', { p_game_id: gameId, p_attending: attending }));
  }

  // ---------------------------------------------------------------------------- RatingsApi

  async confirmResult(gameId: GameId, verdict: ResultVerdict): Promise<ResultConfirmationSummary> {
    await this.uid();
    return this.rpc<ResultConfirmationSummary>('confirm_result', { p_game_id: gameId, p_verdict: verdict });
  }

  async getResultConfirmation(gameId: GameId): Promise<ResultConfirmationSummary | null> {
    await this.uid();
    return (await this.rpc<ResultConfirmationSummary | null>('result_confirmation', { p_game_id: gameId })) ?? null;
  }

  async getGameRatingStatus(gameId: GameId): Promise<GameRatingEligibility> {
    await this.uid();
    const j = await this.rpc<{ eligible?: unknown; reason?: unknown } | null>('game_rating_status', { p_game_id: gameId });
    return j?.eligible === true ? { eligible: true, reason: null } : { eligible: false, reason: (j?.reason ?? 'no_result') as GameNotRatedReason };
  }

  async getRatingEligibility(gameId: GameId): Promise<RatingEligibility> {
    await this.uid();
    return this.rpc<RatingEligibility>('rating_eligibility', { p_game_id: gameId });
  }

  async submitPeerRatings(gameId: GameId, ratings: readonly PeerRatingInput[]): Promise<PeerRating[]> {
    await this.uid();
    const rows = await this.rpc<Row[]>('submit_peer_ratings', { p_game_id: gameId, p_ratings: ratings });
    return (rows ?? []).map(mapPeerRating);
  }

  async listMySkillRatings(): Promise<SkillRating[]> {
    await this.uid();
    const rows = await this.rpc<Record<string, unknown>[] | null>('my_skill_ratings');
    return (rows ?? []).map(mapSkillRating);
  }

  async getMyPeerSummary(sport: SportId): Promise<PeerSkillSummary | null> {
    await this.uid();
    return (await this.rpc<PeerSkillSummary | null>('my_peer_summary', { p_sport: sport })) ?? null;
  }

  async getSkillBands(gameId: GameId): Promise<Readonly<Record<UserId, Stars>>> {
    await this.uid();
    return (await this.rpc<Record<UserId, Stars> | null>('game_skill_bands', { p_game_id: gameId })) ?? {};
  }

  /** Extension: the caller's weekly Glicko updates (RLS: own rows), oldest first. */
  async listMyRatingHistory(sport?: SportId): Promise<RatingUpdate[]> {
    const me = await this.uid();
    let query = this.sb.from('rating_updates').select('*').eq('user_id', me);
    if (sport) query = query.eq('sport', sport);
    const rows = await this.q<Row[]>(query.order('period'));
    return rows.map(mapRatingUpdate);
  }

  // ---------------------------------------------------------------------------- MediaApi

  /** Signs display URLs (private `media` bucket) for items from `st_media_json` / `media_items`. */
  private async mediaViews(rows: readonly Row[]): Promise<MediaItemView[]> {
    const items = rows.map(mapMediaItem);
    const paths = [...new Set(items.flatMap((m) => [m.storagePath, m.thumbnailPath]).filter((p): p is string => !!p && p.startsWith('media/')))];
    const signed = new Map<string, string>();
    if (paths.length) {
      const { data } = await this.sb.storage.from(MEDIA_BUCKET).createSignedUrls(paths, 60 * 60);
      for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
    }
    return items.map(({ thumbnailPath, pendingUserIds, acceptedTags, ...item }) => ({
      ...item,
      url: signed.get(item.storagePath) ?? '',
      thumbnailUrl: thumbnailPath ? (signed.get(thumbnailPath) ?? null) : null,
      acceptedTags,
      ...(pendingUserIds.length ? { pendingUserIds } : null),
    }));
  }

  private stripMedia(row: Row): MediaItem {
    const { thumbnailPath: _t, pendingUserIds: _p, acceptedTags: _a, ...item } = mapMediaItem(row);
    return item;
  }

  async listGameMedia(gameId: GameId): Promise<MediaItemView[]> {
    await this.uid();
    return this.mediaViews((await this.rpc<Row[]>('game_gallery', { p_game_id: gameId })) ?? []);
  }

  async listVenueMedia(venueId: VenueId, options: { from?: IsoDateTime; to?: IsoDateTime } = {}): Promise<MediaItemView[]> {
    await this.uid();
    return this.mediaViews((await this.rpc<Row[]>('venue_vault', { p_venue_id: venueId, p_from: options.from ?? null, p_to: options.to ?? null })) ?? []);
  }

  async createMediaUploadIntent(request: MediaUploadRequest): Promise<MediaUploadIntent> {
    await this.uid();
    return this.fn<MediaUploadIntent>('media-upload', { ...request });
  }

  /** Extension: sends the picked bytes to the signed upload URL. */
  async uploadMediaObject(intent: MediaUploadIntent, file: { uri: string; blob?: Blob }): Promise<void> {
    let res: Response;
    try {
      const body = file.blob ?? (await (await fetch(file.uri)).blob());
      res = await fetch(intent.uploadUrl, { method: intent.method, headers: { ...intent.headers }, body });
    } catch (e) {
      throw toStError(e, 'network');
    }
    if (!res.ok) throw new StError(res.status === 413 ? 'validation' : 'unavailable', `upload failed (${res.status})`);
  }

  async completeMediaUpload(mediaId: MediaId): Promise<MediaItem> {
    await this.uid();
    await this.fn<{ mediaId: string; status: string }>('media-process', { mediaId });
    const rows = await this.q<Row[]>(this.sb.from('media_items').select('*').eq('id', mediaId).limit(1));
    if (!rows[0]) throw new StError('not_found');
    return this.stripMedia(rows[0]);
  }

  async tagMedia(mediaId: MediaId, userIds: readonly UserId[]): Promise<MediaTag[]> {
    await this.uid();
    const rows = await this.rpc<Row[]>('tag_user', { p_media_id: mediaId, p_user_ids: userIds });
    return (rows ?? []).map(mapMediaTag);
  }

  async respondToMediaTag(mediaId: MediaId, accept: boolean): Promise<MediaTag> {
    await this.uid();
    return mapMediaTag(await this.rpc<Row>('respond_tag', { p_media_id: mediaId, p_accept: accept }));
  }

  async untagMe(mediaId: MediaId, removeFromPublic: boolean): Promise<MediaTag> {
    await this.uid();
    return mapMediaTag(await this.rpc<Row>('untag', { p_media_id: mediaId, p_remove_from_public: removeFromPublic }));
  }

  async listMyTagRequests(): Promise<MediaTag[]> {
    await this.uid();
    return ((await this.rpc<Row[]>('my_tag_requests')) ?? []).map(mapMediaTag);
  }

  async setMediaVisibility(mediaId: MediaId, visibility: MediaVisibility): Promise<MediaItem> {
    await this.uid();
    return this.stripMedia(await this.rpc<Row>('set_visibility', { p_media_id: mediaId, p_visibility: visibility }));
  }

  async deleteMedia(mediaId: MediaId): Promise<void> {
    await this.uid();
    await this.rpc('delete_media', { p_media_id: mediaId });
  }

  /** Extension: `report_media` (one report per person; `already_reported`). */
  async reportMedia(mediaId: MediaId, reason: string, note?: string): Promise<void> {
    await this.uid();
    await this.rpc('report_media', { p_media_id: mediaId, p_reason: reason, p_note: note?.trim() || null });
  }

  /** Extension: one visible item (RLS `media_items_read`), for tag-request previews. */
  async getMediaItem(mediaId: MediaId): Promise<MediaItemView | null> {
    await this.uid();
    const rows = await this.q<Row[]>(this.sb.from('media_items').select('*').eq('id', mediaId).limit(1));
    if (!rows[0]) return null;
    const [view] = await this.mediaViews(rows);
    return view ?? null;
  }

  // ---------------------------------------------------------------------------- NetworkApi

  async listConnections(filter: 'all' | 'friends' | 'played_with' | 'requests' = 'all'): Promise<ConnectionView[]> {
    await this.uid();
    const rows = await this.rpc<Record<string, unknown>[]>('list_network', { p_filter: filter });
    return (rows ?? []).map(mapConnectionView);
  }

  async requestFriend(userId: UserId): Promise<ConnectionView> {
    await this.uid();
    return mapConnectionView(await this.rpc<Record<string, unknown>>('request_friend', { p_user_id: userId }));
  }

  async respondFriendRequest(userId: UserId, accept: boolean): Promise<ConnectionView> {
    await this.uid();
    return mapConnectionView(await this.rpc<Record<string, unknown>>('respond_friend', { p_user_id: userId, p_accept: accept }));
  }

  async removeFriend(userId: UserId): Promise<void> {
    await this.uid();
    await this.rpc('remove_friend', { p_user_id: userId });
  }

  async getNetworkPrivacy(): Promise<NetworkPrivacy> {
    await this.uid();
    return mapNetworkPrivacy(await this.rpc<Record<string, unknown>>('get_network_privacy'));
  }

  async setNetworkPrivacy(audience: UpcomingGamesAudience): Promise<NetworkPrivacy> {
    await this.uid();
    return mapNetworkPrivacy(await this.rpc<Record<string, unknown>>('set_network_privacy', { p_audience: audience }));
  }

  async listFriendsUpcomingGames(): Promise<FriendUpcomingGame[]> {
    await this.uid();
    const rows = await this.rpc<{ friend: PublicProfile; game: Row }[]>('friends_upcoming_games');
    return (rows ?? []).map((r) => ({ friend: r.friend, game: mapGameSummary(r.game) }));
  }

  // ---------------------------------------------------------------------------- InviteApi

  private async inviteToken(target: InviteTarget): Promise<{ token: string; createdAt: IsoDateTime }> {
    const rows =
      target.kind === 'game'
        ? await this.q<Row[]>(this.sb.from('game_views').select('invite_token, created_at').eq('id', target.gameId).limit(1))
        : await this.q<Row[]>(this.sb.from('series_views').select('invite_token, created_at').eq('id', target.seriesId).limit(1));
    const row = rows[0];
    if (!row) throw new StError('not_found');
    if (!row.invite_token) throw new StError('forbidden', 'host only');
    return { token: String(row.invite_token), createdAt: String(row.created_at) };
  }

  private async linkFor(target: InviteTarget, token: string, createdAt: IsoDateTime): Promise<InviteLink> {
    const preview = await this.rpc<InvitePreview | null>('get_invite_preview', { p_token: token });
    if (!preview) throw new StError('game_not_open');
    return { target, token, url: inviteUrl(WEB_ORIGIN, target, token), preview, createdAt, rotatedAt: null };
  }

  async getInviteLink(target: InviteTarget): Promise<InviteLink> {
    await this.uid();
    const { token, createdAt } = await this.inviteToken(target);
    return this.linkFor(target, token, createdAt);
  }

  async rotateInviteLink(target: InviteTarget): Promise<InviteLink> {
    await this.uid();
    const id = target.kind === 'game' ? target.gameId : target.seriesId;
    const token = await this.rpc<string>('rotate_invite_link', { p_kind: target.kind, p_id: id });
    const link = await this.linkFor(target, token, new Date().toISOString());
    return { ...link, rotatedAt: new Date().toISOString() };
  }

  async getShareMessage(target: InviteTarget, locale: Locale): Promise<ShareMessage> {
    const link = await this.getInviteLink(target);
    return buildShareMessage(link.preview, locale, link.url);
  }

  async resolveSeriesInvite(inviteToken: string): Promise<GameSeriesDetail | null> {
    await this.uid();
    const j = await this.rpc<Record<string, unknown> | null>('resolve_series_invite', { p_token: inviteToken });
    if (!j) return null;
    const visible = await this.seriesRow(String(j.id));
    const series = visible ?? mapResolvedSeries(j);
    const detail = await this.seriesDetailOf(series, Number(j.rosterCount ?? 0));
    return detail;
  }

  async joinSeriesViaInvite(inviteToken: string): Promise<RosterMember> {
    await this.uid();
    return mapRosterMember(await this.rpc<Row>('join_roster', { p_token: inviteToken }));
  }

  async getMigrationStats(target: InviteTarget): Promise<MigrationStats> {
    await this.uid();
    const id = target.kind === 'game' ? target.gameId : target.seriesId;
    return this.rpc<MigrationStats>('migration_stats', { p_kind: target.kind, p_id: id });
  }
}
