import { describe, expect, it } from 'vitest';
import {
  StError,
  applyTrustEvent,
  createTrustState,
  deriveReviewItemId,
  isLocale,
  isRadiusKm,
  isRtlLocale,
  isSportId,
  isStError,
  matchBlocklist,
  orderWaitlist,
  processNoShows,
  type ReviewQueueItem,
} from '../src';
import { G1, HOST, HOUR_MS, T0, U1, U2, U3, iso, sanctionRow } from './helpers';

describe('contract helpers (types.ts)', () => {
  it('guards', () => {
    expect(isLocale('he')).toBe(true);
    expect(isLocale('xx')).toBe(false);
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('en')).toBe(false);
    expect(isSportId('padel')).toBe(true);
    expect(isSportId(3)).toBe(false);
    expect(isRadiusKm(5)).toBe(true);
    expect(isRadiusKm(4)).toBe(false);
    const e = new StError('validation', undefined, { field: 'x' });
    expect(e.message).toBe('validation');
    expect(isStError(e)).toBe(true);
    expect(isStError({ name: 'StError', code: 'x' })).toBe(true);
    expect(isStError(new Error('x'))).toBe(false);
    expect(isStError(null)).toBe(false);
  });
});

describe('engine edge paths', () => {
  const item = (extra: Partial<ReviewQueueItem>): ReviewQueueItem => ({
    id: deriveReviewItemId('appeal:pb'),
    kind: 'appeal',
    status: 'open',
    priority: 'low',
    subjectUserId: U1,
    venueId: null,
    gameId: null,
    sanctionId: null,
    appealId: 'ap',
    reportIds: [],
    evidence: {},
    dueBy: iso(T0),
    dedupeKey: 'appeal:pb',
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: iso(T0),
    ...extra,
  });

  it('overturning a permanent ban lifts it', () => {
    const pb = sanctionRow({ dedupeKey: 'pb', kind: 'permanent_ban', reasonCode: 'moderator_decision', expiresAt: null, disputeUntil: null, decidedBy: 'moderator', gameId: null } as never);
    const it = item({ sanctionId: pb.id });
    const r = applyTrustEvent(createTrustState(U1, { sanctions: [pb], reviewItems: [it] }), { type: 'ModeratorDecided', itemId: it.id, decision: 'overturn', moderatorId: 'm', at: iso(T0), note: 'ok' }, undefined, T0);
    expect(r.effects.slice(0, 2)).toEqual([
      { type: 'SetSanctionStatus', sanctionId: pb.id, status: 'overturned' },
      { type: 'LiftRestrictions', userId: U1, kinds: ['permanent_ban'] },
    ]);
  });

  it('upholding a no-show card without a game settles nothing; existing review items are not duplicated', () => {
    const card = sanctionRow({ dedupeKey: 'c', gameId: null, status: 'upheld' });
    const it = item({ sanctionId: card.id, appealId: null, kind: 'sanction_dispute' });
    const r = applyTrustEvent(createTrustState(U1, { sanctions: [card], reviewItems: [it] }), { type: 'ModeratorDecided', itemId: it.id, decision: 'uphold', moderatorId: 'm', at: iso(T0), note: null }, undefined, T0);
    expect(r.effects.map((e) => e.type)).toEqual(['Notify', 'Audit']);
    const appealItem = item({ dedupeKey: 'appeal:ap2', id: deriveReviewItemId('appeal:ap2') });
    const ap = { id: 'ap2', sanctionId: card.id, userId: U1, text: '', isDispute: false, status: 'open' as const, decidedBy: null, decisionNote: null, decidedAt: null, createdAt: iso(T0) };
    const r2 = applyTrustEvent(createTrustState(U1, { sanctions: [card], reviewItems: [appealItem] }), { type: 'AppealFiled', appeal: ap }, undefined, T0);
    expect(r2.effects).toEqual([]);
  });

  it('ModeratorDecided on a venue item without the venue in state still sets the status', () => {
    const it = item({ kind: 'venue_reports', venueId: 'v9', subjectUserId: null });
    const r = applyTrustEvent(createTrustState(HOST, { reviewItems: [it] }), { type: 'ModeratorDecided', itemId: it.id, decision: 'remove_venue', moderatorId: 'm', at: iso(T0), note: null }, undefined, T0);
    expect(r.effects[0]).toEqual({ type: 'SetVenueStatus', venueId: 'v9', status: 'removed' });
    const d = applyTrustEvent(createTrustState(HOST, { reviewItems: [it] }), { type: 'ModeratorDecided', itemId: it.id, decision: 'dismiss', moderatorId: 'm', at: iso(T0), note: null }, undefined, T0);
    expect(d.effects[0]).toEqual({ type: 'SetVenueStatus', venueId: 'v9', status: 'active' });
  });
});

describe('ordering tie-breaks', () => {
  it('waitlist without ranks orders by request time, then id', () => {
    const p = (userId: string, h: number) => ({ userId, status: 'waitlisted' as const, waitlistRank: null, requestedAt: iso(T0 - h * HOUR_MS) });
    expect(orderWaitlist([p(U2, 1), p(U1, 5), p(U3, 5)]).map((x) => x.userId)).toEqual([U1, U3, U2]);
  });
  it('several late cancellers are reported in id order', () => {
    const late = (userId: string) => ({ userId, status: 'cancelled' as const, attendance: 'unknown' as const, lateCancel: true, cancelledAt: iso(T0 - HOUR_MS) });
    const ok = (userId: string) => ({ userId, status: 'approved' as const, attendance: 'verified' as const, lateCancel: false, cancelledAt: null });
    const game = { id: G1, hostId: HOST, startsAt: iso(T0), endsAt: iso(T0 + HOUR_MS), status: 'scheduled' as const };
    const r = processNoShows({ game, participants: [late(U3), late(U2), ok('a'), ok('b')] }, T0 + 3 * HOUR_MS);
    expect(r.events.filter((e) => e.type === 'LateCancelFinalized').map((e) => (e as { userId: string }).userId)).toEqual([U2, U3]);
  });
  it('spaced-out letters followed by a word are still joined', () => {
    expect(matchBlocklist('i d i o t you', 'en').terms).toEqual(['idiot']);
  });
});
