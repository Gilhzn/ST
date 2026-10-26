/**
 * Network: played-with (auto-derived, GAME-032), mutual friendships, privacy of
 * "friends' upcoming games". Blocks override everything: a blocked pair has no
 * visible connection, cannot (re)request friendship, and creating a block
 * deletes an existing friendship.
 */
import type {
  Block,
  Connection,
  EpochMs,
  ErrorCode,
  FriendState,
  GameId,
  GameSummary,
  IsoDateTime,
  NetworkPrivacy,
  Phase15Effect,
  Result,
  UserId,
} from '../types';
import { DEFAULT_UPCOMING_GAMES_AUDIENCE } from '../types';
import { DAY_MS, toEpochMs, toIso } from '../time';
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from '../config';

type BlockPair = Pick<Block, 'blockerId' | 'blockedId'>;

/** Canonical unordered pair (`userA < userB`). */
export function connectionPair(x: UserId, y: UserId): { userA: UserId; userB: UserId } {
  return x < y ? { userA: x, userB: y } : { userA: y, userB: x };
}

/** True when either user blocked the other. */
export function isBlockedPair(blocks: readonly BlockPair[], x: UserId, y: UserId): boolean {
  return blocks.some((b) => (b.blockerId === x && b.blockedId === y) || (b.blockerId === y && b.blockedId === x));
}

/** One attendance row (`game_participants` joined with the game's end). */
export interface AttendanceFact {
  gameId: GameId;
  userId: UserId;
  /** Attendance `verified`. */
  verified: boolean;
  endsAt: IsoDateTime;
}

export interface PlayedWith {
  userA: UserId;
  userB: UserId;
  gamesTogether: number;
  lastPlayedAt: IsoDateTime;
}

/**
 * Pairs who were both verified in the same ended game within
 * `playedWithLookbackDays` (`now − lookback ≤ endsAt ≤ now`), blocked pairs
 * excluded. Sorted by `userA`, `userB`.
 */
export function derivePlayedWith(
  attendance: readonly AttendanceFact[],
  blocks: readonly BlockPair[],
  config: DomainConfig = DEFAULT_DOMAIN_CONFIG,
  now: EpochMs,
): PlayedWith[] {
  const from = now - config.playedWithLookbackDays * DAY_MS;
  const games = new Map<GameId, { endsAt: number; users: Set<UserId> }>();
  for (const a of attendance) {
    if (!a.verified) continue;
    const end = toEpochMs(a.endsAt);
    if (end < from || end > now) continue;
    const g = games.get(a.gameId) ?? { endsAt: end, users: new Set<UserId>() };
    g.users.add(a.userId);
    games.set(a.gameId, g);
  }
  const pairs = new Map<string, PlayedWith>();
  for (const g of games.values()) {
    const users = [...g.users].sort();
    for (let i = 0; i < users.length; i++) {
      for (let j = i + 1; j < users.length; j++) {
        const a = users[i] as UserId;
        const b = users[j] as UserId;
        if (isBlockedPair(blocks, a, b)) continue;
        const key = `${a}|${b}`;
        const p = pairs.get(key);
        if (!p) pairs.set(key, { userA: a, userB: b, gamesTogether: 1, lastPlayedAt: toIso(g.endsAt) });
        else {
          p.gamesTogether++;
          if (toEpochMs(p.lastPlayedAt) < g.endsAt) p.lastPlayedAt = toIso(g.endsAt);
        }
      }
    }
  }
  return [...pairs.values()].sort((x, y) => (x.userA < y.userA ? -1 : x.userA > y.userA ? 1 : x.userB < y.userB ? -1 : x.userB > y.userB ? 1 : 0));
}

/** The relationship from `viewer`'s side. */
export function friendState(conn: Pick<Connection, 'friendStatus' | 'friendRequestedBy'> | null, viewer: UserId): FriendState {
  if (!conn?.friendStatus) return 'none';
  if (conn.friendStatus === 'accepted') return 'friends';
  return conn.friendRequestedBy === viewer ? 'outgoing' : 'incoming';
}

export type FriendAction = 'request' | 'accept' | 'decline' | 'cancel' | 'remove';

function emptyConnection(x: UserId, y: UserId): Connection {
  return { ...connectionPair(x, y), gamesTogether: 0, lastPlayedAt: null, friendStatus: null, friendRequestedBy: null, friendRequestedAt: null, friendAcceptedAt: null };
}

function clearFriend(c: Connection): Connection {
  return { ...c, friendStatus: null, friendRequestedBy: null, friendRequestedAt: null, friendAcceptedAt: null };
}

/**
 * Friend state machine (actor → other):
 * - `request`: none → requested; an incoming request is accepted instead
 *   (mutual intent). Requires having played together (`gamesTogether ≥ 1`;
 *   anti-spam) else `forbidden`; `conflict` when outgoing or already friends.
 * - `accept` / `decline`: only an incoming request (`not_found` otherwise).
 * - `cancel`: only an outgoing request. `remove`: only a friendship.
 * A blocked pair gets `blocked` for `request`/`accept`; the clearing actions
 * still work. Effects: `UpsertConnection` or `DeleteFriendship`, plus
 * `friend_request` / `friend_accepted` notices.
 */
export function friendTransition(
  conn: Connection | null,
  actor: UserId,
  other: UserId,
  action: FriendAction,
  blocks: readonly BlockPair[],
  now: EpochMs,
): Result<{ connection: Connection; effects: Phase15Effect[] }, ErrorCode> {
  if (actor === other) return { ok: false, error: 'validation' };
  const c = conn ?? emptyConnection(actor, other);
  const state = friendState(c, actor);
  const at = toIso(now);
  const blocked = isBlockedPair(blocks, actor, other);
  const upsert = (next: Connection): Phase15Effect => ({ type: 'UpsertConnection', connection: next, dedupeKey: `connection:${next.userA}:${next.userB}:${action}:${at}` });
  const drop = (next: Connection) => ({
    ok: true as const,
    value: { connection: next, effects: [{ type: 'DeleteFriendship' as const, userA: c.userA, userB: c.userB, dedupeKey: `unfriend:${c.userA}:${c.userB}:${action}:${at}` }] },
  });
  const notify = (userId: UserId, kind: 'friend_request' | 'friend_accepted'): Phase15Effect => ({
    type: 'Notify15',
    userId,
    kind,
    params: { userId: actor },
    gameId: null,
    seriesId: null,
    dedupeKey: `notify:${kind}:${c.userA}:${c.userB}:${at}`,
  });
  const accept = () => {
    const next: Connection = { ...c, friendStatus: 'accepted', friendAcceptedAt: at };
    return { ok: true as const, value: { connection: next, effects: [upsert(next), notify(other, 'friend_accepted')] } };
  };
  switch (action) {
    case 'request':
      if (blocked) return { ok: false, error: 'blocked' };
      if (state === 'friends' || state === 'outgoing') return { ok: false, error: 'conflict' };
      if (state === 'incoming') return accept();
      if (c.gamesTogether < 1) return { ok: false, error: 'forbidden' };
      {
        const next: Connection = { ...c, friendStatus: 'requested', friendRequestedBy: actor, friendRequestedAt: at, friendAcceptedAt: null };
        return { ok: true, value: { connection: next, effects: [upsert(next), notify(other, 'friend_request')] } };
      }
    case 'accept':
      if (blocked) return { ok: false, error: 'blocked' };
      return state === 'incoming' ? accept() : { ok: false, error: 'not_found' };
    case 'decline':
      return state === 'incoming' ? drop(clearFriend(c)) : { ok: false, error: 'not_found' };
    case 'cancel':
      return state === 'outgoing' ? drop(clearFriend(c)) : { ok: false, error: 'not_found' };
    case 'remove':
      return state === 'friends' ? drop(clearFriend(c)) : { ok: false, error: 'not_found' };
  }
}

/** Effects when `blockerId` blocks `blockedId`: any friendship or request between them is deleted. */
export function onBlockCreated(conn: Connection | null, blockerId: UserId, blockedId: UserId, now: EpochMs): Phase15Effect[] {
  if (!conn?.friendStatus) return [];
  const { userA, userB } = connectionPair(blockerId, blockedId);
  return [{ type: 'DeleteFriendship', userA, userB, dedupeKey: `unfriend:${userA}:${userB}:block:${toIso(now)}` }];
}

/** Connections visible to `viewer` (blocked pairs hidden; pairs with neither played-with nor friend state dropped). */
export function visibleConnections(viewer: UserId, connections: readonly Connection[], blocks: readonly BlockPair[]): Connection[] {
  return connections.filter((c) => {
    if (c.userA !== viewer && c.userB !== viewer) return false;
    const other = c.userA === viewer ? c.userB : c.userA;
    if (isBlockedPair(blocks, viewer, other)) return false;
    return c.gamesTogether > 0 || c.friendStatus !== null;
  });
}

/** A friend's participation in a game (approved or host). */
export interface FriendGameCandidate {
  ownerId: UserId;
  game: Pick<GameSummary, 'id' | 'hostId' | 'visibility' | 'status' | 'startsAt'>;
}

/**
 * "Friends' upcoming games" for `viewer`: the owner is an accepted friend, the
 * owner's audience is `friends` (default {@link DEFAULT_UPCOMING_GAMES_AUDIENCE}),
 * no block between the viewer and the owner or the game's host, the game is
 * public, scheduled and not started. Sorted by start, then game id, then owner.
 */
export function filterFriendsUpcomingGames(
  viewer: UserId,
  candidates: readonly FriendGameCandidate[],
  connections: readonly Connection[],
  privacy: Readonly<Record<UserId, Pick<NetworkPrivacy, 'upcomingGamesVisibleTo'>>>,
  blocks: readonly BlockPair[],
  now: EpochMs,
): FriendGameCandidate[] {
  const friends = new Set<UserId>();
  for (const c of connections) {
    if (c.friendStatus !== 'accepted') continue;
    if (c.userA === viewer) friends.add(c.userB);
    else if (c.userB === viewer) friends.add(c.userA);
  }
  return candidates
    .filter((x) => {
      if (!friends.has(x.ownerId)) return false;
      if ((privacy[x.ownerId]?.upcomingGamesVisibleTo ?? DEFAULT_UPCOMING_GAMES_AUDIENCE) !== 'friends') return false;
      if (isBlockedPair(blocks, viewer, x.ownerId) || isBlockedPair(blocks, viewer, x.game.hostId)) return false;
      return x.game.visibility === 'public' && x.game.status === 'scheduled' && toEpochMs(x.game.startsAt) > now;
    })
    .sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt) || (a.game.id < b.game.id ? -1 : a.game.id > b.game.id ? 1 : a.ownerId < b.ownerId ? -1 : 1));
}
