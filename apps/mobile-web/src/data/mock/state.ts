/** In-memory "tables" of the mock backend. Mirrors the Supabase schema closely enough for parity. */
import type {
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
  /** Monotonic id counter. */
  seq: number;
}
