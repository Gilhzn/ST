import { describe, expect, it } from 'vitest';
import {
  alwaysInMembers,
  keyOf,
  peerRatingEligibility,
  processRatingPeriod,
  selfPriorFrom,
  zonedTimeToEpoch,
  type RosterMember,
} from '../src';
import { HOST, U1, U2, U3 } from './helpers';

describe('Phase 1.5 edge branches', () => {
  it('a wall time just after spring-forward resolves with the post-transition offset', () => {
    expect(new Date(zonedTimeToEpoch('2026-03-29', '03:00', 'Europe/London')).toISOString()).toBe('2026-03-29T02:00:00.000Z');
  });
  it('always-in seniority ties break by user id', () => {
    const m = (userId: string): RosterMember => ({ seriesId: 's', userId, status: 'regular', alwaysIn: true, joinedVia: 'host', consecutiveMisses: 0, leaveOfferedAt: null, joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null });
    expect(alwaysInMembers({ hostId: HOST }, [m(U3), m(U1), m(U2), m(U1)]).map((x) => x.userId)).toEqual([U1, U1, U2, U3]);
  });
  it('keyOf', () => {
    expect(keyOf({ seriesId: 's', scheduleRevision: 1, slotDate: '2026-10-06' })).toBe('s:1:2026-10-06');
  });
  it('self prior without attributes; blocks in either direction', () => {
    expect(selfPriorFrom(4, null)).toEqual({ selfSkill: 4, attributes: {} });
    const e = peerRatingEligibility(
      {
        game: { endsAt: '2026-11-01T20:00:00.000Z' },
        rater: { userId: U1, reliability: 0.9, verifiedGamesInSport: 9, hasActiveSanction: false, verifiedInGame: true },
        verifiedUserIds: [U1, U2, U3],
        blocks: [{ blockerId: U1, blockedId: U2 }],
        alreadyRated: [],
      },
      undefined,
      Date.parse('2026-11-01T21:00:00.000Z'),
    );
    expect(e.rateableUserIds).toEqual([U3]);
  });
  it('rating period output sorts users and keeps sport groups apart', () => {
    const g = (id: string, a: string, b: string) => ({ gameId: id, sport: 'tennis' as const, formatFamily: 'singles' as const, endsAt: '2026-11-03T20:00:00.000Z', teams: [[a], [b]], teamScores: [1, 0] });
    const out = processRatingPeriod({ period: '2026-W45', games: [g('g1', U3, U1), g('g2', U2, U3)], ratings: [], reliability: { [U1]: 0.9, [U2]: 0.9, [U3]: 0.9 } }, undefined, Date.parse('2026-11-05T00:00:00.000Z'));
    expect(out.ratings.map((r) => [r.userId, r.games])).toEqual([[U1, 1], [U2, 1], [U3, 2]]);
  });
});
