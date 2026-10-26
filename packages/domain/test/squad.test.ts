import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  balanceTeams,
  ratingFromUserSport,
  snakeDraft,
  toSquadPlayer,
  type PositionId,
  type SportId,
  type SquadPlayer,
} from '../src';

const footballPos: PositionId[] = ['goalkeeper', 'defender', 'midfielder', 'forward'];
const playerArb = (sport: SportId) =>
  fc.record({
    rating: fc.integer({ min: 4, max: 20 }).map((x) => x / 4),
    positions: sport === 'football' ? fc.subarray(footballPos, { maxLength: 2 }) : fc.constant([] as PositionId[]),
  });
const playersArb = (sport: SportId, min = 0, max = 24) =>
  fc.array(playerArb(sport), { minLength: min, maxLength: max }).map((ps) => ps.map((p, i): SquadPlayer => ({ userId: `p${String(i).padStart(2, '0')}`, ...p })));

describe('ratings', () => {
  it('weights overall/speed/control and falls back', () => {
    expect(ratingFromUserSport({ selfSkill: 2, attributes: { overall: 4, speed: 2, control: 2 } })).toBe(3);
    expect(ratingFromUserSport({ selfSkill: 2, attributes: undefined as never })).toBe(2);
    expect(ratingFromUserSport({ selfSkill: undefined as never, attributes: undefined as never })).toBe(3);
    expect(ratingFromUserSport(null)).toBe(3);
    const us = { userId: 'u', sport: 'football' as const, selfSkill: 5 as const, attributes: { overall: 5 as const, speed: 5 as const, control: 5 as const }, positions: ['goalkeeper' as const] };
    expect(toSquadPlayer('u', us, 1)).toEqual({ userId: 'u', rating: 5, positions: ['goalkeeper'] });
    expect(toSquadPlayer('u', null, -5)).toEqual({ userId: 'u', rating: 1, positions: [] });
  });
});

describe('balanceTeams', () => {
  it('validates input', () => {
    expect(() => balanceTeams([], { teams: 0, sport: 'football', seed: 1 })).toThrow(RangeError);
    expect(() => balanceTeams([], { teams: 1.5, sport: 'football', seed: 1 })).toThrow(RangeError);
    const p = { userId: 'a', rating: 3, positions: [] };
    expect(() => balanceTeams([p, p], { teams: 2, sport: 'football', seed: 1 })).toThrow(/duplicate/);
  });

  it('splits goalkeepers and balances a simple case perfectly', () => {
    const players: SquadPlayer[] = [
      { userId: 'gk1', rating: 5, positions: ['goalkeeper'] },
      { userId: 'gk2', rating: 1, positions: ['defender', 'goalkeeper'] },
      ...['a', 'b', 'c', 'd'].map((id) => ({ userId: id, rating: 3, positions: [] as PositionId[] })),
    ];
    const r = balanceTeams(players, { teams: 2, sport: 'football', seed: 42 });
    expect(r.teams.map((t) => t.filter((m) => m.role === 'goalkeeper').length)).toEqual([1, 1]);
    expect(r.teams.map((t) => t.length)).toEqual([3, 3]);
    expect(r.cost).toBe(r.spread ** 2 + 10 * r.positionDeficits);
    expect(r.ratingSums.reduce((a, b) => a + b, 0)).toBe(18);
  });

  it('handles edge cases: 1 team, more teams than players, non-finite rating, no positions sport', () => {
    const ps = [{ userId: 'a', rating: Number.NaN, positions: [] }, { userId: 'b', rating: 4, positions: [] }];
    expect(balanceTeams(ps, { teams: 1, sport: 'running', seed: 1 }).teams[0]).toHaveLength(2);
    const many = balanceTeams(ps, { teams: 4, sport: 'tennis', seed: 1 });
    expect(many.teams.map((t) => t.length).sort()).toEqual([0, 0, 1, 1]);
    expect(many.ratingSums).toContain(3);
    expect(balanceTeams([], { teams: 2, sport: 'football', seed: 1 }).cost).toBe(0);
    expect(balanceTeams(ps, { teams: 2, sport: 'basketball', seed: 1, iterations: 0 }).teams.flat()).toHaveLength(2);
  });

  it('property: every player exactly once, sizes within 1, cost ≤ snake draft, deterministic', () => {
    fc.assert(
      fc.property(playersArb('football'), fc.integer({ min: 1, max: 4 }), fc.integer(), (players, teams, seed) => {
        const opts = { teams, sport: 'football' as const, seed };
        const r = balanceTeams(players, opts);
        const ids = r.teams.flat().map((m) => m.userId).sort();
        expect(ids).toEqual(players.map((p) => p.userId).sort());
        const sizes = r.teams.map((t) => t.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect(r.sizeImbalance).toBe(0);
        expect(r.cost).toBeLessThanOrEqual(snakeDraft(players, opts).cost + 1e-9);
        expect(balanceTeams([...players].reverse(), opts)).toEqual(r);
      }),
      { numRuns: 200 },
    );
  });

  it('property: scarce positions are split across teams whenever feasible', () => {
    fc.assert(
      fc.property(playersArb('football', 2, 24), fc.integer({ min: 2, max: 4 }), fc.integer(), (players, teams, seed) => {
        const r = balanceTeams(players, { teams, sport: 'football', seed });
        const gks = r.teams.flat().filter((m) => m.role === 'goalkeeper').length;
        const perTeam = r.teams.map((t) => t.filter((m) => m.role === 'goalkeeper').length);
        for (const n of perTeam) expect(n).toBeGreaterThanOrEqual(Math.floor(gks / teams));
      }),
      { numRuns: 200 },
    );
  });

  it('property: for rating-only sports the result is never worse than a plain snake', () => {
    fc.assert(
      fc.property(playersArb('tennis'), fc.integer({ min: 2, max: 4 }), fc.integer(), (players, teams, seed) => {
        const opts = { teams, sport: 'tennis' as const, seed };
        expect(balanceTeams(players, opts).cost).toBeLessThanOrEqual(snakeDraft(players, opts, false).cost + 1e-9);
      }),
    );
  });

  it('volleyball spreads setters and liberos', () => {
    const roles: PositionId[] = ['setter', 'setter', 'libero', 'libero', 'outside_hitter', 'outside_hitter', 'middle_blocker', 'opposite'];
    const players = roles.map((r, i) => ({ userId: `v${i}`, rating: 1 + (i % 5), positions: [r] }));
    const r = balanceTeams(players, { teams: 2, sport: 'volleyball', seed: 3 });
    for (const t of r.teams) {
      expect(t.filter((m) => m.role === 'setter')).toHaveLength(1);
      expect(t.filter((m) => m.role === 'libero')).toHaveLength(1);
    }
  });

  it('n = 40 runs in < 5 ms on average', () => {
    const players = Array.from({ length: 40 }, (_, i) => ({
      userId: `p${i}`,
      rating: 1 + ((i * 7) % 17) / 4,
      positions: [footballPos[i % 4]!],
    }));
    for (let i = 0; i < 10; i++) balanceTeams(players, { teams: 4, sport: 'football', seed: i });
    // Best average of several batches: robust to noisy neighbours (parallel test files, coverage).
    let best = Infinity;
    for (let batch = 0; batch < 8; batch++) {
      const start = performance.now();
      for (let i = 0; i < 20; i++) balanceTeams(players, { teams: 4, sport: 'football', seed: batch * 20 + i });
      best = Math.min(best, (performance.now() - start) / 20);
    }
    expect(best).toBeLessThan(5);
  });
});
