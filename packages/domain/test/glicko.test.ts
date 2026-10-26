import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOMAIN_CONFIG,
  currentSkillRating,
  formatFamilyFor,
  glicko2Update,
  glickoLevel,
  inflateRd,
  isFrozen,
  isProvisional,
  parseRatingPeriodKey,
  processRatingPeriod,
  ratingPeriodIndex,
  ratingPeriodKey,
  scoreOf,
  teamComposite,
  type GlickoParams,
  type RatedGameInput,
  type SkillRating,
} from '../src';
import { DAY_MS, U1, U2, U3, U4, U5 } from './helpers';

const C = DEFAULT_DOMAIN_CONFIG;
const NOW = Date.parse('2026-11-02T12:00:00.000Z'); // Monday of ISO week 2026-W45
const P = ratingPeriodKey(ratingPeriodIndex(NOW));

describe('Glicko-2 core (Glickman 2012 worked example)', () => {
  it('r=1500 RD=200 σ=0.06, τ=0.5 vs (1400,30) win, (1550,100) loss, (1700,300) loss', () => {
    const out = glicko2Update(
      { r: 1500, rd: 200, sigma: 0.06 },
      [
        { opponent: { r: 1400, rd: 30 }, score: 1 },
        { opponent: { r: 1550, rd: 100 }, score: 0 },
        { opponent: { r: 1700, rd: 300 }, score: 0 },
      ],
      0.5,
    );
    expect(out.r).toBeCloseTo(1464.06, 1);
    expect(out.rd).toBeCloseTo(151.52, 1);
    expect(Math.abs(out.sigma - 0.05999)).toBeLessThan(1e-5); // paper prints 0.05999 (exact: 0.0599960)
  });

  it('no games: only RD grows (√(φ²+σ²)), capped', () => {
    const p = { r: 1600, rd: 100, sigma: 0.06 };
    const out = glicko2Update(p, [], 0.5);
    expect(out.r).toBe(1600);
    expect(out.sigma).toBe(0.06);
    expect(out.rd).toBeCloseTo(Math.sqrt((100 / 173.7178) ** 2 + 0.06 ** 2) * 173.7178, 9);
    expect(glicko2Update({ r: 1500, rd: 349.9, sigma: 0.06 }, [], 0.5, 350).rd).toBe(350);
    expect(inflateRd(p, 0, 350)).toBe(100);
    expect(inflateRd(p, 3, 350)).toBeCloseTo(Math.sqrt((100 / 173.7178) ** 2 + 3 * 0.0036) * 173.7178, 9);
  });

  it('takes the k-loop branch of the volatility bracket (small Δ)', () => {
    const out = glicko2Update({ r: 1500, rd: 50, sigma: 0.06 }, [{ opponent: { r: 1500, rd: 50 }, score: 0.5 }], 0.5);
    expect(out.r).toBeCloseTo(1500, 9);
    expect(out.sigma).toBeLessThan(0.06);
  });

  it('takes the Δ² > φ²+v branch (big upset)', () => {
    const out = glicko2Update({ r: 1500, rd: 30, sigma: 0.06 }, Array.from({ length: 6 }, () => ({ opponent: { r: 2300, rd: 30 }, score: 1 as const })), 0.5);
    expect(out.sigma).toBeGreaterThan(0.06);
    expect(out.r).toBeGreaterThan(1500);
  });

  const params = fc.record({
    r: fc.double({ min: 800, max: 2400, noNaN: true }),
    rd: fc.double({ min: 30, max: 350, noNaN: true }),
    sigma: fc.double({ min: 0.03, max: 0.1, noNaN: true }),
  });
  const score = fc.constantFrom<0 | 0.5 | 1>(0, 0.5, 1);

  it('property: RD shrinks with games', () => {
    fc.assert(
      fc.property(params, fc.array(fc.tuple(params, score), { minLength: 1, maxLength: 6 }), (p, games) => {
        const out = glicko2Update(p, games.map(([o, s]) => ({ opponent: o, score: s })), 0.5);
        const idle = Math.sqrt((p.rd / 173.7178) ** 2 + out.sigma ** 2) * 173.7178;
        expect(out.rd).toBeLessThan(idle);
        expect(Number.isFinite(out.r) && Number.isFinite(out.rd) && out.sigma > 0).toBe(true);
      }),
    );
  });

  it('property: symmetric updates for equal players (zero-sum, mirrored)', () => {
    fc.assert(
      fc.property(params, fc.constantFrom<0 | 1>(0, 1), (p, s) => {
        const a = glicko2Update(p, [{ opponent: p, score: s }], 0.5);
        const b = glicko2Update(p, [{ opponent: p, score: (1 - s) as 0 | 1 }], 0.5);
        expect(a.r - p.r).toBeCloseTo(-(b.r - p.r), 6);
        expect(a.rd).toBeCloseTo(b.rd, 6);
        expect(a.sigma).toBeCloseTo(b.sigma, 9);
      }),
    );
  });

  it('property: a draw between equals changes r by ≈ 0', () => {
    fc.assert(
      fc.property(params, (p) => {
        const out = glicko2Update(p, [{ opponent: p, score: 0.5 }], 0.5);
        expect(Math.abs(out.r - p.r)).toBeLessThan(1e-6);
      }),
    );
  });

  it('property: winning never lowers r, losing never raises it', () => {
    fc.assert(
      fc.property(params, params, (p, o) => {
        expect(glicko2Update(p, [{ opponent: o, score: 1 }], 0.5).r).toBeGreaterThanOrEqual(p.r);
        expect(glicko2Update(p, [{ opponent: o, score: 0 }], 0.5).r).toBeLessThanOrEqual(p.r);
      }),
    );
  });
});

describe('product rules', () => {
  it('team composite: mean r, RMS RD', () => {
    const c = teamComposite([
      { r: 1400, rd: 30, sigma: 0.05 },
      { r: 1600, rd: 40, sigma: 0.07 },
    ]);
    expect(c.r).toBe(1500);
    expect(c.rd).toBeCloseTo(Math.sqrt((900 + 1600) / 2), 12);
    expect(c.sigma).toBeCloseTo(0.06, 12);
    expect(() => teamComposite([])).toThrow(RangeError);
  });
  it('level = clamp((r − 900)/200, 0, 7), one decimal', () => {
    expect(glickoLevel(1500)).toBe(3);
    expect(glickoLevel(800)).toBe(0);
    expect(glickoLevel(2600)).toBe(7);
    expect(glickoLevel(1464.06)).toBe(2.8);
    expect(glickoLevel(1519)).toBe(3.1);
  });
  it('provisional and frozen gates (GLK-004)', () => {
    expect(isProvisional({ games: 10, rd: 99 }, 0.8)).toBe(false);
    expect(isProvisional({ games: 9, rd: 99 }, 0.9)).toBe(true);
    expect(isProvisional({ games: 10, rd: 100 }, 0.9)).toBe(true);
    expect(isProvisional({ games: 10, rd: 50 }, 0.79)).toBe(true);
    expect(isProvisional({ games: 10, rd: 50 }, null)).toBe(true);
    expect(isFrozen(0.69)).toBe(true);
    expect(isFrozen(0.7)).toBe(false);
    expect(isFrozen(null)).toBe(true);
    expect(isFrozen(undefined)).toBe(true);
  });
  it('format families', () => {
    expect(formatFamilyFor('football', 5)).toBe('small_sided');
    expect(formatFamilyFor('football', 11)).toBe('full_sided');
    expect(formatFamilyFor('basketball', 3)).toBe('half_court');
    expect(formatFamilyFor('basketball', 5)).toBe('full_court');
    expect(formatFamilyFor('tennis', 1)).toBe('singles');
    expect(formatFamilyFor('padel', 2)).toBe('doubles');
    expect(formatFamilyFor('volleyball', 2)).toBe('pairs');
    expect(formatFamilyFor('volleyball', 6)).toBe('teams');
    expect(formatFamilyFor('running', 1)).toBeNull();
  });
  it('scores and period keys', () => {
    expect([scoreOf('win'), scoreOf('draw'), scoreOf('loss')]).toEqual([1, 0.5, 0]);
    expect(P).toBe('2026-W45');
    expect(parseRatingPeriodKey(P)).toBe(ratingPeriodIndex(NOW));
    expect(ratingPeriodKey(ratingPeriodIndex(Date.parse('2027-01-01T00:00:00Z')))).toBe('2026-W53');
    expect(ratingPeriodKey(ratingPeriodIndex(Date.parse('2027-01-04T00:00:00Z')))).toBe('2027-W01');
    expect(ratingPeriodKey(ratingPeriodIndex(Date.parse('2026-01-01T00:00:00Z')))).toBe('2026-W01');
    expect(ratingPeriodKey(5, 14)).toBe('P14-5');
    expect(parseRatingPeriodKey('P14-5', 14)).toBe(5);
    expect(() => parseRatingPeriodKey('2026-45')).toThrow(RangeError);
    expect(() => parseRatingPeriodKey('P7-5', 14)).toThrow(RangeError);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (i) => {
        expect(parseRatingPeriodKey(ratingPeriodKey(i))).toBe(i);
      }),
    );
  });
});

describe('processRatingPeriod', () => {
  const game = (id: string, teams: string[][], scores: number[]): RatedGameInput => ({
    gameId: id,
    sport: 'football',
    formatFamily: 'small_sided',
    endsAt: '2026-11-03T20:00:00.000Z',
    teams,
    teamScores: scores,
  });
  const row = (userId: string, p: GlickoParams, games: number, lastPeriod: string | null): SkillRating => ({
    userId,
    sport: 'football',
    formatFamily: 'small_sided',
    ...p,
    games,
    provisional: true,
    level: glickoLevel(p.r),
    lastPeriod,
    updatedAt: '2026-10-01T00:00:00.000Z',
  });

  it('team game: winners up, losers down, symmetric for fresh players; margin ignored', () => {
    const a = processRatingPeriod({ period: P, games: [game('g1', [[U1, U2], [U3, U4]], [1, 0])], ratings: [], reliability: { [U1]: 0.9, [U2]: 0.9, [U3]: 0.9, [U4]: 0.9 } }, C, NOW);
    const b = processRatingPeriod({ period: P, games: [game('g1', [[U1, U2], [U3, U4]], [9, 0])], ratings: [], reliability: { [U1]: 0.9, [U2]: 0.9, [U3]: 0.9, [U4]: 0.9 } }, C, NOW);
    expect(a).toEqual(b);
    const r = Object.fromEntries(a.ratings.map((x) => [x.userId, x]));
    expect(r[U1]!.r).toBeGreaterThan(1500);
    expect(r[U3]!.r).toBeLessThan(1500);
    expect(r[U1]!.r - 1500).toBeCloseTo(1500 - r[U3]!.r, 6);
    expect(r[U1]!.games).toBe(1);
    expect(r[U1]!.lastPeriod).toBe(P);
    expect(r[U1]!.provisional).toBe(true);
    expect(a.updates.map((u) => u.dedupeKey)).toContain(`rating:${U1}:football:small_sided:${P}`);
  });

  it('draw between equal teams leaves r ≈ unchanged', () => {
    const out = processRatingPeriod({ period: P, games: [game('g1', [[U1], [U2]], [2, 2])], ratings: [], reliability: { [U1]: 0.9, [U2]: 0.9, [U3]: 0.9, [U4]: 0.9 } }, C, NOW);
    for (const x of out.ratings) expect(Math.abs(x.r - 1500)).toBeLessThan(1e-9);
  });

  it('frozen player (AC-GLK-004): unchanged, but opponents use the frozen rating', () => {
    const frozen = row(U3, { r: 1700, rd: 80, sigma: 0.06 }, 30, '2026-W44');
    const out = processRatingPeriod({ period: P, games: [game('g1', [[U1], [U3]], [1, 0])], ratings: [frozen], reliability: { [U3]: 0.65, [U1]: 0.9 } }, C, NOW);
    const up = out.updates.find((u) => u.userId === U3)!;
    expect(up.frozen).toBe(true);
    expect(up.after).toEqual(up.before);
    expect(up.gamesAdded).toBe(0);
    expect(out.ratings.find((x) => x.userId === U3)).toBeUndefined();
    const vsFresh = processRatingPeriod({ period: P, games: [game('g1', [[U1], [U3]], [1, 0])], ratings: [], reliability: { [U1]: 0.9, [U2]: 0.9, [U3]: 0.9, [U4]: 0.9 } }, C, NOW);
    expect(out.ratings[0]!.r).toBeGreaterThan(vsFresh.ratings.find((x) => x.userId === U1)!.r);
  });

  it('L4: a null/missing reliability (new account) is frozen but still counts for the opponent', () => {
    const out = processRatingPeriod({ period: P, games: [game('g1', [[U1], [U2]], [0, 1])], ratings: [], reliability: { [U1]: null, [U2]: 0.9 } }, C, NOW);
    expect(out.updates.find((u) => u.userId === U1)).toMatchObject({ frozen: true, gamesAdded: 0 });
    expect(out.ratings.map((x) => x.userId)).toEqual([U2]);
    expect(out.ratings[0]!.r).toBeGreaterThan(1500);
  });

  it('idempotent: players already processed for the period are skipped; idle periods inflate RD', () => {
    const done = row(U1, { r: 1600, rd: 60, sigma: 0.06 }, 12, P);
    const old = row(U2, { r: 1600, rd: 60, sigma: 0.06 }, 12, '2026-W40');
    const out = processRatingPeriod({ period: P, games: [game('g1', [[U1], [U2]], [0, 1])], ratings: [done, old], reliability: { [U1]: 0.9, [U2]: 0.9 } }, C, NOW);
    expect(out.updates.map((u) => u.userId)).toEqual([U2]);
    const inflated = inflateRd(old, 4, 350);
    const expected = glicko2Update({ r: 1600, rd: inflated, sigma: 0.06 }, [{ opponent: { r: 1600, rd: 60 }, score: 1 }], 0.5, 350);
    expect(out.ratings[0]!.r).toBeCloseTo(expected.r, 9);
    expect(out.ratings[0]!.games).toBe(13);
    expect(out.ratings[0]!.provisional).toBe(expected.rd >= 100);
  });

  it('groups by sport/family; 3 sides rate pairwise; multiple games accumulate', () => {
    const g3: RatedGameInput = { ...game('g3', [[U1], [U2], [U3]], [3, 2, 2]), sport: 'basketball', formatFamily: 'half_court' };
    const out = processRatingPeriod(
      { period: P, games: [game('g1', [[U4], [U5]], [1, 0]), game('g2', [[U4], [U5]], [1, 0]), g3], ratings: [], reliability: {} },
      C,
      NOW,
    );
    expect(out.ratings.map((x) => `${x.sport}:${x.userId}`)).toEqual([`basketball:${U1}`, `basketball:${U2}`, `basketball:${U3}`, `football:${U4}`, `football:${U5}`]);
    expect(out.ratings.find((x) => x.userId === U4)!.games).toBe(2);
    const b = Object.fromEntries(out.ratings.filter((x) => x.sport === 'basketball').map((x) => [x.userId, x.r]));
    expect(b[U1]).toBeGreaterThan(1500);
    expect(b[U2]).toBeCloseTo(b[U3]!, 9);
    expect(() => processRatingPeriod({ period: P, games: [game('x', [[U1], [U2]], [1])], ratings: [], reliability: {} }, C, NOW)).toThrow(RangeError);
  });

  it('currentSkillRating inflates RD for idle weeks and recomputes display gates', () => {
    const r = row(U1, { r: 1700, rd: 90, sigma: 0.06 }, 15, '2026-W44');
    expect(currentSkillRating(r, 0.9, C, NOW)).toMatchObject({ rd: 90, provisional: false, level: 4 });
    const later = currentSkillRating(r, 0.9, C, NOW + 10 * 7 * DAY_MS);
    expect(later.rd).toBeGreaterThan(90);
    expect(currentSkillRating({ ...r, lastPeriod: null }, 0.5, C, NOW).provisional).toBe(true);
  });
});
