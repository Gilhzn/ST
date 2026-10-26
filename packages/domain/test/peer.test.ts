import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOMAIN_CONFIG,
  aggregatePeerRatings,
  buildPeerRatings,
  gameRatingEligibility,
  peerRatingEligibility,
  peerRatingWeights,
  selfPriorFrom,
  summarizeResultConfirmations,
  validatePeerRatings,
  type GameRatingInput,
  type PeerEligibilityInput,
  type PeerRating,
  type RatingEligibility,
} from '../src';
import { DAY_MS, G1, HOUR_MS, U1, U2, U3, U4, U5 } from './helpers';

const C = DEFAULT_DOMAIN_CONFIG;
const END = Date.parse('2026-11-01T20:00:00.000Z');

describe('rater gating (RATE-001/002)', () => {
  const base: PeerEligibilityInput = {
    game: { endsAt: new Date(END).toISOString() },
    rater: { userId: U1, reliability: 0.85, verifiedGamesInSport: 5, hasActiveSanction: false, verifiedInGame: true },
    verifiedUserIds: [U1, U3, U2, U4, U2],
    blocks: [{ blockerId: U4, blockedId: U1 }],
    alreadyRated: [U3],
  };
  it('eligible rater: rateable excludes self, blocked, already rated', () => {
    const e = peerRatingEligibility(base, C, END + HOUR_MS);
    expect(e).toEqual({
      canRate: true,
      reasons: [],
      verifiedGamesInSport: 5,
      requiredGames: 5,
      windowClosesAt: '2026-11-03T20:00:00.000Z',
      remainingRatees: 4,
      rateableUserIds: [U2],
    });
  });
  it('AC-RATE-002: 3 verified games → too_few_games; every failing gate listed in order', () => {
    expect(peerRatingEligibility({ ...base, rater: { ...base.rater, verifiedGamesInSport: 3 } }, C, END + HOUR_MS).reasons).toEqual(['too_few_games']);
    const all = peerRatingEligibility(
      { ...base, rater: { userId: U1, reliability: null, verifiedGamesInSport: 0, hasActiveSanction: true, verifiedInGame: false } },
      C,
      END - 1,
    );
    expect(all).toMatchObject({ canRate: false, reasons: ['not_verified', 'low_reliability', 'too_few_games', 'active_sanction', 'window_not_open'], rateableUserIds: [] });
    expect(peerRatingEligibility({ ...base, rater: { ...base.rater, reliability: 0.79 } }, C, END).reasons).toEqual(['low_reliability']);
    expect(peerRatingEligibility(base, C, END + 48 * HOUR_MS).canRate).toBe(true);
    expect(peerRatingEligibility(base, C, END + 48 * HOUR_MS + 1).reasons).toEqual(['window_closed']);
    expect(peerRatingEligibility({ ...base, alreadyRated: [U2, U3, U4, U5, 'x'] }, C, END).canRate).toBe(false);
  });
  it('validation of a submission', () => {
    const e = peerRatingEligibility(base, C, END + HOUR_MS);
    expect(validatePeerRatings(e, 'football', [{ rateeId: U2, scores: { overall: 4, passing: 3 } }])).toEqual({ ok: true, value: true });
    expect(validatePeerRatings(e, 'football', [])).toEqual({ ok: false, error: 'validation' });
    expect(validatePeerRatings({ ...e, remainingRatees: 1 }, 'football', [{ rateeId: U2, scores: { overall: 4 } }, { rateeId: U5, scores: { overall: 4 } }])).toEqual({ ok: false, error: 'validation' });
    expect(validatePeerRatings({ ...e, rateableUserIds: [U2, U5] }, 'football', [{ rateeId: U2, scores: { overall: 4 } }, { rateeId: U2, scores: { overall: 4 } }])).toEqual({ ok: false, error: 'validation' });
    expect(validatePeerRatings(e, 'football', [{ rateeId: U4, scores: { overall: 4 } }])).toEqual({ ok: false, error: 'forbidden' });
    expect(validatePeerRatings(e, 'football', [{ rateeId: U2, scores: {} }])).toEqual({ ok: false, error: 'validation' });
    expect(validatePeerRatings(e, 'football', [{ rateeId: U2, scores: { shooting: 4 } as never }])).toEqual({ ok: false, error: 'validation' });
    expect(validatePeerRatings(e, 'football', [{ rateeId: U2, scores: { overall: 6 as never } }])).toEqual({ ok: false, error: 'validation' });
    expect(validatePeerRatings(e, 'football', [{ rateeId: U2, scores: { overall: 2.5 as never } }])).toEqual({ ok: false, error: 'validation' });
    const closed: RatingEligibility = { ...e, canRate: false, reasons: ['window_closed'] };
    expect(validatePeerRatings(closed, 'football', [{ rateeId: U2, scores: { overall: 4 } }])).toEqual({ ok: false, error: 'outside_window' });
    expect(validatePeerRatings({ ...e, canRate: false, reasons: ['window_not_open'] }, 'football', [])).toEqual({ ok: false, error: 'outside_window' });
    expect(validatePeerRatings({ ...e, canRate: false, reasons: ['low_reliability'] }, 'football', [])).toEqual({ ok: false, error: 'forbidden' });
    expect(buildPeerRatings(G1, 'football', U1, [{ rateeId: U2, scores: { overall: 4 } }], END)).toEqual([
      { gameId: G1, sport: 'football', raterId: U1, rateeId: U2, scores: { overall: 4 }, createdAt: '2026-11-01T20:00:00.000Z' },
    ]);
  });
});

describe('aggregation (RATE-003/004)', () => {
  let n = 0;
  const pr = (raterId: string, rateeId: string, scores: PeerRating['scores'], daysAgo = 1): PeerRating => ({
    gameId: `g${n++}`,
    sport: 'football',
    raterId,
    rateeId,
    scores,
    createdAt: new Date(END - daysAgo * DAY_MS).toISOString(),
  });
  const self = selfPriorFrom(3, { speed: 4, control: 2, overall: 3 });

  it('no ratings: the self prior, band from it', () => {
    const s = aggregatePeerRatings({ userId: U1, sport: 'football', self, received: [], given: [] });
    expect(s.attributes.overall).toEqual({ mean: 3, evidenceWeight: 0, ratingsUsed: 0 });
    expect(s.attributes.speed!.mean).toBe(4);
    expect(s.attributes.ball_control!.mean).toBe(2);
    expect(s.attributes.passing!.mean).toBe(3);
    expect(s).toMatchObject({ band: 3, raterCount: 0 });
  });
  it('Bayesian mean with prior weight 3', () => {
    const s = aggregatePeerRatings({ userId: U1, sport: 'football', self, received: [pr(U2, U1, { overall: 5 }), pr(U3, U1, { overall: 5 }), pr(U4, U1, { overall: 4 })], given: [] });
    expect(s.attributes.overall).toEqual({ mean: Math.round(((3 * 3 + 14) / 6) * 1e4) / 1e4, evidenceWeight: 3, ratingsUsed: 3 });
    expect(s.band).toBe(4);
    expect(s.raterCount).toBe(3);
  });
  it('pair decay after 3 ratings in 30 days', () => {
    const received = [pr(U2, U1, { overall: 5 }, 10), pr(U2, U1, { overall: 5 }, 8), pr(U2, U1, { overall: 5 }, 6), pr(U2, U1, { overall: 5 }, 4), pr(U2, U1, { overall: 5 }, 2), pr(U2, U1, { overall: 5 }, 40)];
    expect(peerRatingWeights({ userId: U1, sport: 'football', self, received, given: [] })).toEqual([1, 1, 1, 0.5, 0.25, 1]);
    const same = [pr(U2, U1, { overall: 5 }, 1), pr(U2, U1, { overall: 5 }, 1), pr(U2, U1, { overall: 5 }, 1), pr(U2, U1, { overall: 5 }, 1)];
    expect(peerRatingWeights({ userId: U1, sport: 'football', self, received: same, given: [] })).toEqual([1, 1, 1, 0.5]);
  });
  it('reciprocal all-max pairs are down-weighted', () => {
    const received = [pr(U2, U1, { overall: 5, speed: 5 }), pr(U3, U1, { overall: 5 }), pr(U4, U1, { overall: 4 })];
    const given = [pr(U1, U2, { overall: 5, passing: 5 }), pr(U1, U3, { overall: 4 }), pr(U1, U4, { overall: 5 }, 90)];
    expect(peerRatingWeights({ userId: U1, sport: 'football', self, received, given })).toEqual([0.5, 1, 1]);
  });
  it('trims outliers beyond 2σ of the consensus', () => {
    const received = [U2, U3, U4, U5, 'u6', 'u7', 'u8', 'u9'].map((r) => pr(r, U1, { overall: 4 }));
    received.push(pr('u10', U1, { overall: 1 }));
    const s = aggregatePeerRatings({ userId: U1, sport: 'football', self, received, given: [] });
    expect(s.attributes.overall!.ratingsUsed).toBe(8);
    expect(s.attributes.overall!.mean).toBe(Math.round(((9 + 32) / 11) * 1e4) / 1e4);
    expect(s.raterCount).toBe(8);
  });
});

describe('result confirmation (GAME-071) and GLK-003', () => {
  const conf = (userId: string, verdict: 'confirm' | 'dispute', at = '2026-11-01T21:00:00.000Z') => ({ gameId: G1, userId, verdict, createdAt: at });
  it('majority of verified participants; submitter counts; latest verdict wins; outsiders ignored', () => {
    const verified = [U1, U2, U3, U4];
    expect(summarizeResultConfirmations({ gameId: G1, submittedBy: U1, verifiedUserIds: verified, confirmations: [conf(U2, 'confirm')] }, U2)).toEqual({
      gameId: G1, status: 'pending', confirms: 2, disputes: 0, verifiedCount: 4, myVerdict: 'confirm',
    });
    expect(summarizeResultConfirmations({ gameId: G1, submittedBy: U1, verifiedUserIds: verified, confirmations: [conf(U2, 'confirm'), conf(U3, 'confirm')] }).status).toBe('confirmed');
    const disputed = summarizeResultConfirmations({
      gameId: G1,
      submittedBy: 'host-not-verified',
      verifiedUserIds: verified,
      confirmations: [conf(U2, 'dispute'), conf(U3, 'dispute'), conf(U4, 'confirm', '2026-11-01T20:30:00.000Z'), conf(U4, 'dispute'), conf(U5, 'confirm')],
    }, U5);
    expect(disputed).toMatchObject({ status: 'disputed', confirms: 0, disputes: 3, myVerdict: null });
    expect(summarizeResultConfirmations({ gameId: G1, submittedBy: U1, verifiedUserIds: verified, confirmations: [conf(U1, 'dispute'), conf(U1, 'confirm', '2026-11-01T20:00:00.000Z')] }).disputes).toBe(1);
  });
  const ok: GameRatingInput = {
    sport: 'football',
    startsAt: '2026-11-01T19:00:00.000Z',
    teamScores: [3, 2],
    resultStatus: 'confirmed',
    approvedCount: 10,
    verifiedCount: 7,
    teamsPublishedAt: '2026-11-01T18:55:00.000Z',
    teams: [[U1], [U2]],
  };
  it('eligibility checks in order', () => {
    expect(gameRatingEligibility(ok)).toEqual({ eligible: true, reason: null });
    expect(gameRatingEligibility({ ...ok, sport: 'running' })).toEqual({ eligible: false, reason: 'unrated_sport' });
    expect(gameRatingEligibility({ ...ok, teamScores: null })).toEqual({ eligible: false, reason: 'no_result' });
    expect(gameRatingEligibility({ ...ok, verifiedCount: 6, resultStatus: 'pending' })).toEqual({ eligible: false, reason: 'too_few_verified' });
    expect(gameRatingEligibility({ ...ok, approvedCount: 0 })).toEqual({ eligible: false, reason: 'too_few_verified' });
    expect(gameRatingEligibility({ ...ok, teamsPublishedAt: null })).toEqual({ eligible: false, reason: 'teams_not_published' });
    expect(gameRatingEligibility({ ...ok, teamsPublishedAt: '2026-11-01T19:00:00.001Z' })).toEqual({ eligible: false, reason: 'teams_not_published' });
    expect(gameRatingEligibility({ ...ok, teams: [[U1]] , teamScores: [1] })).toEqual({ eligible: false, reason: 'not_two_sides' });
    expect(gameRatingEligibility({ ...ok, teams: [[U1], []] })).toEqual({ eligible: false, reason: 'not_two_sides' });
    expect(gameRatingEligibility({ ...ok, teamScores: [1, 2, 3] })).toEqual({ eligible: false, reason: 'not_two_sides' });
    expect(gameRatingEligibility({ ...ok, resultStatus: 'disputed' })).toEqual({ eligible: false, reason: 'result_disputed' });
    expect(gameRatingEligibility({ ...ok, resultStatus: 'pending' })).toEqual({ eligible: false, reason: 'result_not_confirmed' });
  });
});
