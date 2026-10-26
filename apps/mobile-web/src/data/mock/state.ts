/** In-memory "tables" of the mock backend. Mirrors the Supabase schema closely enough for parity. */
import type {
  AutoJoinRecord,
  Connection,
  GameSeries,
  IsoDateTime,
  MediaId,
  MediaItem,
  MediaTag,
  NetworkPrivacy,
  PeerRating,
  RatingUpdate,
  ResultConfirmation,
  RosterMember,
  SeriesId,
  SeriesOccurrence,
  SkillRating,
  Appeal,
  Block,
  ChatMessage,
  Game,
  GameId,
  GameResult,
  Gender,
  Notification,
  Participant,
  Payment,
  PhoneE164,
  Profile,
  PushPlatform,
  Sanction,
  Stars,
  TranslatedMessage,
  UserId,
  UserReport,
  UserSport,
  Venue,
  VenueId,
  VenueRating,
  VenueReport,
  WaitlistOffer,
} from '@st/domain';

export interface MockUser {
  id: UserId;
  phone: PhoneE164 | null;
  createdAt: string;
  profile: Profile | null;
  privateData: { birthYear: number; birthMonth: number; gender: Gender } | null;
  sports: UserSport[];
  deleted?: boolean;
}

/** A stored game: always holds the exact location and the secret, masked per viewer on read. */
export interface MockGame extends Omit<Game, 'location' | 'venueId' | 'inviteToken'> {
  location: Game['approxLocation'];
  venueId: VenueId | null;
  inviteToken: string;
  qrSecret: string;
}

/** A stored series: always holds the exact location and the invite token, masked per viewer on read. */
export interface MockSeries extends Omit<GameSeries, 'inviteToken'> {
  inviteToken: string;
  inviteRotatedAt: IsoDateTime | null;
}

/** A stored media item with its (signed) image URLs; the demo uses generated SVG/data URIs. */
export interface MockMedia extends MediaItem {
  url: string;
  thumbnailUrl: string | null;
}

/** Friendship half of a `connections` row (played-with is derived from attendance on read). */
export type MockFriendship = Pick<Connection, 'userA' | 'userB' | 'friendStatus' | 'friendRequestedBy' | 'friendRequestedAt' | 'friendAcceptedAt'>;

export interface MockState {
  users: Map<UserId, MockUser>;
  venues: Map<VenueId, Venue>;
  games: Map<GameId, MockGame>;
  /** Keyed `${gameId}|${userId}`. */
  participants: Map<string, Participant>;
  venueRatings: VenueRating[];
  venueReports: VenueReport[];
  sanctions: Sanction[];
  appeals: Appeal[];
  userReports: UserReport[];
  blocks: Block[];
  notifications: Notification[];
  messages: ChatMessage[];
  translations: TranslatedMessage[];
  results: Map<GameId, GameResult>;
  hostRatings: { gameId: GameId; raterId: UserId; hostId: UserId; stars: Stars; createdAt: string }[];
  payments: Payment[];
  pushTokens: { userId: UserId; token: string; platform: PushPlatform }[];
  peerConfirmations: { gameId: GameId; confirmerId: UserId; targetId: UserId }[];
  /** Waitlist offers (`waitlist_offers`), keyed `${gameId}|${userId}`. */
  offers: Map<string, WaitlistOffer>;
  /** `${gameId}|${userId}` pairs that opened the invite link. */
  inviteAccess: Set<string>;
  // ------------------------------------------------------------- Phase 1.5 (contract v3)
  series: Map<SeriesId, MockSeries>;
  /** Keyed by `occurrenceKey`. */
  occurrences: Map<string, SeriesOccurrence>;
  /** Keyed `${seriesId}|${userId}`. */
  roster: Map<string, RosterMember>;
  /** Keyed `${gameId}|${userId}`. */
  autoJoins: Map<string, AutoJoinRecord>;
  /** Joins through an invite link (`invite_joins`), for migration stats. */
  inviteJoins: { kind: 'game' | 'series'; targetId: string; userId: UserId; at: IsoDateTime }[];
  resultConfirmations: ResultConfirmation[];
  /** GLK-003: when the host published teams (`games.teams_published_at`). */
  teamsPublishedAt: Map<GameId, IsoDateTime>;
  peerRatings: PeerRating[];
  skillRatings: SkillRating[];
  ratingUpdates: RatingUpdate[];
  media: Map<MediaId, MockMedia>;
  mediaTags: MediaTag[];
  mediaReports: { mediaId: MediaId; reporterId: UserId; reason: string; note: string | null; createdAt: IsoDateTime }[];
  /** Keyed `${userA}|${userB}` (userA < userB). */
  friendships: Map<string, MockFriendship>;
  networkPrivacy: Map<UserId, NetworkPrivacy>;
  /** Monotonic id counter. */
  seq: number;
}
