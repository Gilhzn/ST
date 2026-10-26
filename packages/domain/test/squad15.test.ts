import { describe, expect, it } from 'vitest';
import { squadRating, toSquadPlayerWithSkill, type UserSport } from '../src';
import { U1 } from './helpers';

const us: UserSport = { userId: U1, sport: 'football', selfSkill: 3, attributes: { speed: 3, control: 3, overall: 3 }, positions: ['goalkeeper'] };
const peer = (mean: number, ratingsUsed = 3) => ({ attributes: { overall: { mean, evidenceWeight: ratingsUsed, ratingsUsed } } });

describe('GLK-006 squad rating source', () => {
  it('non-provisional Glicko wins, mapped 1500 → 3 and ±300 → ±1', () => {
    expect(squadRating(us, { skill: { r: 1800, provisional: false }, peer: peer(2) })).toEqual({ rating: 4, source: 'glicko' });
    expect(squadRating(us, { skill: { r: 3000, provisional: false } })).toEqual({ rating: 5, source: 'glicko' });
    expect(squadRating(us, { skill: { r: 600, provisional: false } })).toEqual({ rating: 1, source: 'glicko' });
  });
  it('provisional Glicko falls back to peer, then self; host adjustment applied last', () => {
    expect(squadRating(us, { skill: { r: 1800, provisional: true }, peer: peer(4.25) })).toEqual({ rating: 4.25, source: 'peer' });
    expect(squadRating(us, { peer: peer(4.25, 0) })).toEqual({ rating: 3, source: 'self' });
    expect(squadRating(us, { peer: { attributes: {} } })).toEqual({ rating: 3, source: 'self' });
    expect(squadRating(null)).toEqual({ rating: 3, source: 'self' });
    expect(squadRating(us, { hostAdjustment: 5 })).toEqual({ rating: 5, source: 'self' });
    expect(toSquadPlayerWithSkill(U1, us, { skill: { r: 1650, provisional: false } })).toEqual({ userId: U1, rating: 3.5, positions: ['goalkeeper'] });
    expect(toSquadPlayerWithSkill(U1, null)).toEqual({ userId: U1, rating: 3, positions: [] });
  });
});
