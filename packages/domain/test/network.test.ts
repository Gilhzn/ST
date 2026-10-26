import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOMAIN_CONFIG,
  connectionPair,
  derivePlayedWith,
  filterFriendsUpcomingGames,
  friendState,
  friendTransition,
  onBlockCreated,
  visibleConnections,
  type AttendanceFact,
  type Connection,
  type FriendGameCandidate,
} from '../src';
import { DAY_MS, U1, U2, U3, U4 } from './helpers';

const C = DEFAULT_DOMAIN_CONFIG;
const NOW = Date.parse('2026-11-01T12:00:00.000Z');
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString();

describe('played-with (GAME-032)', () => {
  it('co-verified attendance within 365 days, blocks excluded', () => {
    const att: AttendanceFact[] = [
      { gameId: 'g1', userId: U1, verified: true, endsAt: ago(10) },
      { gameId: 'g1', userId: U2, verified: true, endsAt: ago(10) },
      { gameId: 'g1', userId: U3, verified: false, endsAt: ago(10) },
      { gameId: 'g1', userId: U4, verified: true, endsAt: ago(10) },
      { gameId: 'g2', userId: U2, verified: true, endsAt: ago(3) },
      { gameId: 'g2', userId: U1, verified: true, endsAt: ago(3) },
      { gameId: 'g0', userId: U1, verified: true, endsAt: ago(30) },
      { gameId: 'g0', userId: U2, verified: true, endsAt: ago(30) },
      { gameId: 'g3', userId: U1, verified: true, endsAt: ago(366) },
      { gameId: 'g3', userId: U3, verified: true, endsAt: ago(366) },
      { gameId: 'g4', userId: U1, verified: true, endsAt: ago(-1) },
      { gameId: 'g4', userId: U3, verified: true, endsAt: ago(-1) },
    ];
    expect(derivePlayedWith(att, [{ blockerId: U4, blockedId: U2 }], C, NOW)).toEqual([
      { userA: U1, userB: U2, gamesTogether: 3, lastPlayedAt: ago(3) },
      { userA: U1, userB: U4, gamesTogether: 1, lastPlayedAt: ago(10) },
    ]);
  });
});

describe('friends: state machine, blocks override', () => {
  const played: Connection = { ...connectionPair(U2, U1), gamesTogether: 2, lastPlayedAt: ago(1), friendStatus: null, friendRequestedBy: null, friendRequestedAt: null, friendAcceptedAt: null };
  it('request → accept → remove', () => {
    const req = friendTransition(played, U1, U2, 'request', [], NOW);
    expect(req.ok && req.value.connection).toMatchObject({ userA: U1, userB: U2, friendStatus: 'requested', friendRequestedBy: U1 });
    expect(req.ok && req.value.effects.map((e) => e.type)).toEqual(['UpsertConnection', 'Notify15']);
    const conn = req.ok ? req.value.connection : played;
    expect(friendState(conn, U1)).toBe('outgoing');
    expect(friendState(conn, U2)).toBe('incoming');
    expect(friendState(null, U1)).toBe('none');
    expect(friendTransition(conn, U1, U2, 'request', [], NOW)).toEqual({ ok: false, error: 'conflict' });
    expect(friendTransition(conn, U1, U2, 'accept', [], NOW)).toEqual({ ok: false, error: 'not_found' });
    const acc = friendTransition(conn, U2, U1, 'accept', [], NOW);
    expect(acc.ok && acc.value.connection.friendStatus).toBe('accepted');
    expect(acc.ok && acc.value.effects[1]).toMatchObject({ kind: 'friend_accepted', userId: U1 });
    const friends = acc.ok ? acc.value.connection : conn;
    expect(friendState(friends, U2)).toBe('friends');
    expect(friendTransition(friends, U1, U2, 'request', [], NOW)).toEqual({ ok: false, error: 'conflict' });
    const rm = friendTransition(friends, U1, U2, 'remove', [], NOW);
    expect(rm.ok && rm.value.connection.friendStatus).toBeNull();
    expect(rm.ok && rm.value.effects.map((e) => e.type)).toEqual(['DeleteFriendship']);
    expect(rm.ok && rm.value.connection.gamesTogether).toBe(2);
  });
  it('mutual request auto-accepts; decline and cancel', () => {
    const req = friendTransition(played, U1, U2, 'request', [], NOW);
    const conn = req.ok ? req.value.connection : played;
    const back = friendTransition(conn, U2, U1, 'request', [], NOW);
    expect(back.ok && back.value.connection.friendStatus).toBe('accepted');
    const dec = friendTransition(conn, U2, U1, 'decline', [], NOW);
    expect(dec.ok && dec.value.connection.friendStatus).toBeNull();
    expect(friendTransition(conn, U1, U2, 'decline', [], NOW)).toEqual({ ok: false, error: 'not_found' });
    const can = friendTransition(conn, U1, U2, 'cancel', [], NOW);
    expect(can.ok && can.value.connection.friendStatus).toBeNull();
    expect(friendTransition(conn, U2, U1, 'cancel', [], NOW)).toEqual({ ok: false, error: 'not_found' });
    expect(friendTransition(conn, U2, U1, 'remove', [], NOW)).toEqual({ ok: false, error: 'not_found' });
  });
  it('anti-spam, self and blocks', () => {
    expect(friendTransition(null, U1, U3, 'request', [], NOW)).toEqual({ ok: false, error: 'forbidden' });
    expect(friendTransition(null, U1, U1, 'request', [], NOW)).toEqual({ ok: false, error: 'validation' });
    const blocks = [{ blockerId: U2, blockedId: U1 }];
    expect(friendTransition(played, U1, U2, 'request', blocks, NOW)).toEqual({ ok: false, error: 'blocked' });
    const req = friendTransition(played, U1, U2, 'request', [], NOW);
    const conn = req.ok ? req.value.connection : played;
    expect(friendTransition(conn, U2, U1, 'accept', blocks, NOW)).toEqual({ ok: false, error: 'blocked' });
    expect(friendTransition(conn, U1, U2, 'cancel', blocks, NOW).ok).toBe(true);
    expect(onBlockCreated(conn, U2, U1, NOW).map((e) => e.type)).toEqual(['DeleteFriendship']);
    expect(onBlockCreated(played, U2, U1, NOW)).toEqual([]);
    expect(onBlockCreated(null, U2, U1, NOW)).toEqual([]);
  });
  it('visible connections hide blocked pairs and empty rows', () => {
    const empty = { ...played, ...connectionPair(U1, U3), gamesTogether: 0 };
    const other = { ...played, ...connectionPair(U3, U4) };
    const friendOnly = { ...played, ...connectionPair(U1, U4), gamesTogether: 0, friendStatus: 'requested' as const, friendRequestedBy: U4 };
    expect(visibleConnections(U1, [played, empty, other, friendOnly], [])).toEqual([played, friendOnly]);
    expect(visibleConnections(U1, [played, friendOnly], [{ blockerId: U1, blockedId: U4 }])).toEqual([played]);
  });
});

describe("friends' upcoming games privacy filter", () => {
  const friend = (a: string, b: string, status: 'accepted' | 'requested' = 'accepted'): Connection => ({
    ...connectionPair(a, b), gamesTogether: 1, lastPlayedAt: null, friendStatus: status, friendRequestedBy: a, friendRequestedAt: null, friendAcceptedAt: null,
  });
  const game = (id: string, o: Partial<FriendGameCandidate['game']> = {}) => ({ id, hostId: 'h', visibility: 'public' as const, status: 'scheduled' as const, startsAt: ago(-2), ...o });
  it('only accepted friends who share with friends; blocks, private, past and cancelled games hidden', () => {
    const candidates: FriendGameCandidate[] = [
      { ownerId: U2, game: game('g2', { startsAt: ago(-3) }) },
      { ownerId: U3, game: game('g3') },
      { ownerId: U4, game: game('g4') },
      { ownerId: U2, game: game('g1') },
      { ownerId: U2, game: game('g5', { visibility: 'private' }) },
      { ownerId: U2, game: game('g6', { startsAt: ago(1) }) },
      { ownerId: U2, game: game('g7', { status: 'cancelled' }) },
      { ownerId: U2, game: game('g8', { hostId: 'bad' }) },
      { ownerId: 'u9', game: game('g9') },
    ];
    const out = filterFriendsUpcomingGames(
      U1,
      candidates,
      [friend(U1, U2), friend(U3, U1), friend(U1, U4, 'requested'), friend(U2, U3)],
      { [U3]: { upcomingGamesVisibleTo: 'nobody' } },
      [{ blockerId: 'bad', blockedId: U1 }],
      NOW,
    );
    expect(out.map((x) => x.game.id)).toEqual(['g1', 'g2']);
    expect(filterFriendsUpcomingGames(U1, candidates, [friend(U1, U2)], {}, [{ blockerId: U1, blockedId: U2 }], NOW)).toEqual([]);
  });
});
