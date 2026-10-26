import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyTrustEvent,
  applyTrustEvents,
  createTrustState,
  deriveReviewItemId,
  deriveSanctionId,
  isStError,
  type Appeal,
  type DomainTrustEvent,
  type Effect,
  type ReviewQueueItem,
  type TrustState,
} from '../src';
import { DAY_MS, G1, G2, HOST, HOUR_MS, T0, U1, U2, U3, U4, assertSanctionInvariants, iso, sanctionRow } from './helpers';

const startsAt = iso(T0);
const lateCancel = (refilled: boolean, cancelledAt = iso(T0 - 90 * 60_000)): DomainTrustEvent => ({
  type: 'LateCancelFinalized',
  gameId: G1,
  userId: U1,
  startsAt,
  cancelledAt,
  refilled,
});
const types = (effects: readonly Effect[]) => effects.map((e) => e.type);
const run = (state: TrustState, event: DomainTrustEvent, now = T0) => applyTrustEvent(state, event, undefined, now);

function dispute(sanctionId: string, createdAt: string, id = 'ap1', isDispute = true): Appeal {
  return { id, sanctionId, userId: U1, text: 'emergency', isDispute, status: 'open', decidedBy: null, decisionNote: null, decidedAt: null, createdAt };
}

describe('late cancellation (TRUST-020(b), TRUST-021)', () => {
  it('a timely cancel releases the deposit; a late one waits for finalisation without a card', () => {
    const s = createTrustState(U1);
    const timely = run(s, { type: 'ParticipationCancelled', gameId: G1, userId: U1, startsAt, cancelledAt: iso(T0 - 2 * HOUR_MS) });
    expect(timely.effects).toEqual([{ type: 'SettleDeposit', gameId: G1, userId: U1, outcome: 'release' }]);
    const late = run(s, { type: 'ParticipationCancelled', gameId: G1, userId: U1, startsAt, cancelledAt: iso(T0 - HOUR_MS) });
    expect(late.effects).toEqual([]);
    expect(late.state.pendingLateCancels).toEqual([{ gameId: G1, startsAt, cancelledAt: iso(T0 - HOUR_MS) }]);
    expect(run(late.state, { type: 'ParticipationCancelled', gameId: G1, userId: U1, startsAt, cancelledAt: iso(T0 - HOUR_MS) }).state.pendingLateCancels).toHaveLength(1);
  });

  it('refilled spot → no card, deposit released (AC-TRUST-021)', () => {
    const r = run(createTrustState(U1, { pendingLateCancels: [{ gameId: G1, startsAt, cancelledAt: iso(T0 - HOUR_MS) }] }), lateCancel(true));
    expect(assertSanctionInvariants(r.effects)).toEqual([]);
    expect(types(r.effects)).toEqual(['SettleDeposit', 'Audit']);
    expect(r.state.pendingLateCancels).toEqual([]);
  });

  it('not refilled → disputable yellow card with statement of reasons', () => {
    const now = T0 + 4 * HOUR_MS;
    const r = run(createTrustState(U1), lateCancel(false), now);
    const [card] = assertSanctionInvariants(r.effects);
    expect(card).toEqual({
      kind: 'yellow_card',
      userId: U1,
      reasonCode: 'late_cancel',
      statementKey: 'sanctions.reason.late_cancel',
      statementParams: { windowHours: 2, minutesBeforeStart: 90, disputeHours: 48, appealPath: 'dispute' },
      startsAt: iso(now),
      expiresAt: iso(now + 30 * DAY_MS),
      disputeUntil: iso(now + 48 * HOUR_MS),
      gameId: G1,
      causedBy: [],
      dedupeKey: `late_cancel:${G1}:${U1}`,
      decidedBy: 'system',
    });
    expect(types(r.effects)).toEqual(['IssueSanction', 'Notify']);
    expect(r.state.sanctions[0]).toMatchObject({ id: deriveSanctionId(card!.dedupeKey), status: 'active' });
    expect(run(r.state, lateCancel(false), now).effects).toEqual([]);
    expect(run(createTrustState(U1), lateCancel(false, iso(T0 - 2 * HOUR_MS))).effects).toEqual([]);
  });
});

describe('no-shows and deposits (TRUST-020(a), TRUST-061)', () => {
  const noShow: DomainTrustEvent = { type: 'AttendanceFinalized', gameId: G1, userId: U1, attendance: 'no_show_unverified', endsAt: iso(T0) };

  it('no-show → yellow card with 48h dispute window; attendance verified/excused releases', () => {
    const r = run(createTrustState(U1), noShow);
    expect(assertSanctionInvariants(r.effects)[0]).toMatchObject({ reasonCode: 'no_show', disputeUntil: iso(T0 + 48 * HOUR_MS), dedupeKey: `no_show:${G1}:${U1}` });
    expect(run(r.state, noShow).effects).toEqual([]);
    for (const attendance of ['verified', 'excused'] as const) {
      expect(run(createTrustState(U1), { ...noShow, attendance }).effects).toEqual([{ type: 'SettleDeposit', gameId: G1, userId: U1, outcome: 'release' }]);
    }
    expect(run(createTrustState(U1), { ...noShow, attendance: 'unknown' }).effects).toEqual([]);
  });

  it('deposit is captured only after the dispute window closes undisputed', () => {
    const { state } = run(createTrustState(U1), noShow);
    const before = run(state, { type: 'Tick', at: iso(T0 + 47 * HOUR_MS) }, T0 + 48 * HOUR_MS);
    expect(before.effects.filter((e) => e.type === 'SettleDeposit')).toEqual([]);
    const after = run(state, { type: 'Tick', at: iso(T0 + 49 * HOUR_MS) }, T0 + 48 * HOUR_MS + 1);
    expect(after.effects).toEqual([{ type: 'SettleDeposit', gameId: G1, userId: U1, outcome: 'forfeit' }]);
    expect(run(after.state, { type: 'Tick', at: iso(T0 + 50 * HOUR_MS) }, T0 + 50 * HOUR_MS).effects).toEqual([]);
    const disputed = { ...state, sanctions: state.sanctions.map((s) => ({ ...s, status: 'disputed' as const })) };
    expect(run(disputed, { type: 'Tick', at: iso(T0 + 49 * HOUR_MS) }, T0 + 49 * HOUR_MS).effects).toEqual([]);
  });
});

describe('escalation on Tick', () => {
  const card = (n: number, daysAgo: number) => sanctionRow({ dedupeKey: `no_show:g${n}:${U1}`, startsAt: iso(T0 - daysAgo * DAY_MS), gameId: `g${n}` });
  it('2 cards → 7d ban once the 2nd card is settled; idempotent', () => {
    const s = createTrustState(U1, { sanctions: [card(1, 10), card(2, 2.5)], depositSettlements: [{ gameId: 'g1', outcome: 'forfeit' }, { gameId: 'g2', outcome: 'forfeit' }] });
    const r = run(s, { type: 'Tick', at: iso(T0) });
    expect(types(r.effects)).toEqual(['IssueSanction', 'BanJoins', 'Notify']);
    expect(run(r.state, { type: 'Tick', at: iso(T0) }).effects).toEqual([]);
  });
  it('expires sanctions past expiresAt', () => {
    const old = card(1, 31);
    const r = run(createTrustState(U1, { sanctions: [old], depositSettlements: [{ gameId: 'g1', outcome: 'forfeit' }] }), { type: 'Tick', at: iso(T0) });
    expect(r.effects).toEqual([{ type: 'SetSanctionStatus', sanctionId: old.id, status: 'expired' }]);
    expect(r.state.sanctions[0]!.status).toBe('expired');
  });
});

describe('disputes, appeals and auto-void (TRUST-022/023)', () => {
  const card = sanctionRow({ dedupeKey: `no_show:${G1}:${U1}`, startsAt: iso(T0 - DAY_MS) });

  it('a dispute inside the window moves the card to disputed and queues review', () => {
    const r = run(createTrustState(U1, { sanctions: [card] }), { type: 'AppealFiled', appeal: dispute(card.id, iso(T0)) });
    expect(r.effects[0]).toEqual({ type: 'SetSanctionStatus', sanctionId: card.id, status: 'disputed' });
    expect(r.effects[1]).toMatchObject({ type: 'EnqueueReview', item: { kind: 'sanction_dispute', sanctionId: card.id, appealId: 'ap1', priority: 'normal' } });
    expect(run(r.state, { type: 'AppealFiled', appeal: dispute(card.id, iso(T0)) }).effects).toEqual([]);
  });

  it('after the window it is an appeal (no status change); unknown sanction or closed appeal ignored', () => {
    const late = run(createTrustState(U1, { sanctions: [card] }), { type: 'AppealFiled', appeal: dispute(card.id, iso(T0 + 2 * DAY_MS)) }, T0 + 2 * DAY_MS);
    expect(types(late.effects)).toEqual(['EnqueueReview']);
    expect(late.effects[0]).toMatchObject({ item: { kind: 'appeal', priority: 'low' } });
    expect(run(createTrustState(U1), { type: 'AppealFiled', appeal: dispute('nope', iso(T0)) }).effects).toEqual([]);
    expect(run(createTrustState(U1, { sanctions: [card] }), { type: 'AppealFiled', appeal: { ...dispute(card.id, iso(T0)), status: 'withdrawn' } }).effects).toEqual([]);
  });

  it('an undecided dispute is voided after 7 days, cascading to the ban it caused', () => {
    const disputed = { ...card, status: 'disputed' as const };
    const ban = sanctionRow({ dedupeKey: 'ban', kind: 'join_ban', reasonCode: 'escalation_two_cards', causedBy: [card.id], disputeUntil: null, gameId: G1 } as never);
    const s = createTrustState(U1, { sanctions: [disputed, ban], appeals: [dispute(card.id, iso(T0))] });
    expect(run(s, { type: 'Tick', at: iso(T0) }, T0 + 7 * DAY_MS - 1).effects).toEqual([]);
    const r = run(s, { type: 'Tick', at: iso(T0 + 7 * DAY_MS) }, T0 + 7 * DAY_MS);
    expect(types(r.effects)).toEqual(['SetSanctionStatus', 'SetSanctionStatus', 'LiftRestrictions', 'SetAttendance', 'SettleDeposit', 'Notify', 'Audit']);
    expect(r.effects[5]).toMatchObject({ kind: 'appeal_decided', params: { decision: 'auto_void' } });
    expect(r.state.sanctions.map((x) => x.status)).toEqual(['overturned', 'overturned']);
    expect(r.state.overturns).toHaveLength(2);
    expect(run(r.state, { type: 'Tick', at: iso(T0 + 8 * DAY_MS) }, T0 + 8 * DAY_MS).effects).toEqual([]);
  });

  it('no auto-void beyond the first 3 disputes in 90 days', () => {
    const disputed = { ...card, status: 'disputed' as const };
    const appeals = [1, 2, 3].map((i) => ({ ...dispute(`other${i}`, iso(T0 - i * DAY_MS), `old${i}`), status: 'upheld' as const }));
    const s = createTrustState(U1, { sanctions: [disputed], appeals: [...appeals, dispute(card.id, iso(T0))] });
    expect(run(s, { type: 'Tick', at: iso(T0) }, T0 + 8 * DAY_MS).effects).toEqual([]);
  });
});

describe('moderator decisions', () => {
  const card = sanctionRow({ dedupeKey: `no_show:${G1}:${U1}`, startsAt: iso(T0 - 3 * DAY_MS), status: 'disputed' });
  const item = (kind: ReviewQueueItem['kind'], extra: Partial<ReviewQueueItem> = {}): ReviewQueueItem => ({
    id: deriveReviewItemId(`${kind}:x`),
    kind,
    status: 'open',
    priority: 'normal',
    subjectUserId: U1,
    venueId: null,
    gameId: G1,
    sanctionId: card.id,
    appealId: 'ap1',
    reportIds: [],
    evidence: {},
    dueBy: iso(T0 + DAY_MS),
    dedupeKey: `${kind}:x`,
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: iso(T0),
    ...extra,
  });
  const decide = (it: ReviewQueueItem, decision: Extract<DomainTrustEvent, { type: 'ModeratorDecided' }>['decision']): DomainTrustEvent => ({
    type: 'ModeratorDecided',
    itemId: it.id,
    decision,
    moderatorId: 'mod',
    at: iso(T0),
    note: null,
  });

  it('uphold → upheld, deposit forfeited, escalation re-evaluated', () => {
    const other = sanctionRow({ dedupeKey: `no_show:${G2}:${U1}`, startsAt: iso(T0 - 10 * DAY_MS), gameId: G2 });
    const it = item('sanction_dispute');
    const r = run(createTrustState(U1, { sanctions: [card, other], reviewItems: [it] }), decide(it, 'uphold'));
    expect(types(r.effects)).toEqual(['SetSanctionStatus', 'SettleDeposit', 'Notify', 'IssueSanction', 'BanJoins', 'Notify', 'Audit']);
    expect(r.effects[1]).toMatchObject({ outcome: 'forfeit' });
    expect(r.effects[2]).toMatchObject({ kind: 'appeal_decided', params: { decision: 'uphold' } });
    expect(assertSanctionInvariants(r.effects)[0]).toMatchObject({ reasonCode: 'escalation_two_cards' });
    const dismissed = run(createTrustState(U1, { sanctions: [card], reviewItems: [it] }), decide(it, 'dismiss'));
    expect(dismissed.effects[0]).toMatchObject({ status: 'upheld' });
  });

  it('overturn cascades and re-projects remaining restrictions', () => {
    const cascaded = sanctionRow({ dedupeKey: 'ban7', kind: 'join_ban', reasonCode: 'escalation_two_cards', causedBy: [card.id], disputeUntil: null, expiresAt: iso(T0 + 7 * DAY_MS) } as never);
    const independent = sanctionRow({ dedupeKey: 'ban30', kind: 'join_ban', reasonCode: 'escalation_three_cards', disputeUntil: null, expiresAt: iso(T0 + 20 * DAY_MS) } as never);
    const it = item('appeal', { appealId: null });
    const r = run(createTrustState(U1, { sanctions: [card, cascaded, independent], reviewItems: [it] }), decide(it, 'overturn'));
    expect(r.effects.slice(0, 4)).toEqual([
      { type: 'SetSanctionStatus', sanctionId: card.id, status: 'overturned' },
      { type: 'SetSanctionStatus', sanctionId: cascaded.id, status: 'overturned' },
      { type: 'LiftRestrictions', userId: U1, kinds: ['join_ban'] },
      { type: 'BanJoins', userId: U1, until: iso(T0 + 20 * DAY_MS) },
    ]);
    expect(types(r.effects).slice(4)).toEqual(['SetAttendance', 'SettleDeposit', 'Notify', 'Audit']);
    expect(r.effects[6]).toMatchObject({ kind: 'sanction_decided' });
  });

  it('only a moderator decision produces a permanent ban', () => {
    const it = item('permanent_ban_candidate', { sanctionId: null, appealId: null });
    const r = run(createTrustState(U1, { reviewItems: [it] }), decide(it, 'permanent_ban'));
    const [ban] = assertSanctionInvariants(r.effects);
    expect(ban).toMatchObject({ kind: 'permanent_ban', decidedBy: 'moderator', expiresAt: null, reasonCode: 'moderator_decision', causedBy: [] });
    expect(run(createTrustState(U1, { reviewItems: [it] }), decide(it, 'dismiss')).effects.map((e) => e.type)).toEqual(['Audit']);
    expect(run(createTrustState(U1), decide(it, 'uphold')).effects).toEqual([]);
    expect(() => run(createTrustState(U2, { reviewItems: [it] }), decide(it, 'permanent_ban'))).toThrow();
  });

  it('collusion uphold → moderator-issued temporary restriction', () => {
    const it = item('collusion_suspected', { sanctionId: null, reportIds: ['r1', 'r2', 'r3'] });
    const r = run(createTrustState(U1, { reviewItems: [it] }), decide(it, 'uphold'));
    expect(assertSanctionInvariants(r.effects)[0]).toMatchObject({ kind: 'visibility_restriction', decidedBy: 'moderator', expiresAt: iso(T0 + 72 * HOUR_MS) });
  });

  it('venue decisions: remove (fake → host suspension of the creator), restore', () => {
    const reports = [U2, U3, U4].map((r, i) => ({ id: `vr${i}`, venueId: 'v1', reporterId: r, reason: 'no_venue_here' as const, note: null, createdAt: iso(T0 - HOUR_MS) }));
    const venue = { venueId: 'v1', status: 'hidden_pending_review' as const, createdBy: HOST, lastReviewedAt: null, reports };
    const it = item('venue_reports', { subjectUserId: HOST, venueId: 'v1', sanctionId: null, appealId: null });
    const removed = run(createTrustState(HOST, { venues: [venue], reviewItems: [it] }), decide(it, 'remove_venue'));
    expect(types(removed.effects)).toEqual(['SetVenueStatus', 'IssueSanction', 'SuspendHost', 'Notify', 'EnqueueReview', 'Audit']);
    expect(assertSanctionInvariants(removed.effects)[0]).toMatchObject({ kind: 'host_suspension', reasonCode: 'fake_venue' });
    const restored = run(createTrustState(HOST, { venues: [venue], reviewItems: [it] }), decide(it, 'restore_venue'));
    expect(restored.effects[0]).toEqual({ type: 'SetVenueStatus', venueId: 'v1', status: 'active' });
    expect(restored.state.venues[0]).toMatchObject({ status: 'active', lastReviewedAt: iso(T0) });
    const notFake = run(createTrustState(U1, { venues: [venue], reviewItems: [it] }), decide(it, 'remove_venue'));
    expect(types(notFake.effects)).toEqual(['SetVenueStatus', 'Audit']);
  });
});

describe('reports, venue reports, ratings and chat via the engine', () => {
  const profiles = [U2, U3, U4].map((id, i) => ({ id, createdAt: iso(T0 - (30 + i * 30) * DAY_MS), reliabilityStatus: 'green' as const, reportsLast7d: 0 }));
  const attendance = [U1, U2, U3, U4].map((userId) => ({ gameId: G1, userId, status: 'approved' as const, attendance: 'verified' as const, team: null }));
  const rep = (i: number, reporterId: string) => ({ id: `r${i}`, reporterId, targetUserId: U1, category: 'harassment' as const, gameId: G1, messageId: null, note: null, createdAt: iso(T0 - (5 - i) * HOUR_MS) });

  it('the third qualifying report restricts; replays are no-ops', () => {
    let s = createTrustState(U1, { reporterProfiles: profiles, attendance });
    s = run(s, { type: 'UserReported', report: rep(1, U2) }).state;
    s = run(s, { type: 'UserReported', report: rep(2, U3) }).state;
    const third = run(s, { type: 'UserReported', report: rep(3, U4) });
    expect(types(third.effects)).toEqual(['IssueSanction', 'RestrictVisibility', 'Notify', 'EnqueueReview']);
    const again = run(third.state, { type: 'UserReported', report: rep(3, U4) });
    expect(again.effects).toEqual([]);
    expect(again.state).toEqual(third.state);
    expect(() => run(createTrustState(U2), { type: 'UserReported', report: rep(1, U3) })).toThrow();
    try {
      run(createTrustState(U2), { type: 'UserReported', report: rep(1, U3) });
    } catch (e) {
      expect(isStError(e)).toBe(true);
    }
  });

  it('venue reports through the engine', () => {
    const venue = { venueId: 'v1', status: 'active' as const, createdBy: HOST, lastReviewedAt: null, reports: [] };
    let s = createTrustState(HOST, { venues: [venue] });
    for (const [i, r] of [U1, U2, U3].entries()) {
      const out = run(s, { type: 'VenueReported', report: { id: `v${i}`, venueId: 'v1', reporterId: r, reason: 'no_venue_here', note: null, createdAt: iso(T0 - HOUR_MS) } });
      s = out.state;
      if (i === 2) expect(types(out.effects)).toEqual(['SetVenueStatus', 'EnqueueReview', 'Notify']);
    }
    expect(s.venues[0]!.status).toBe('hidden_pending_review');
    const again = run(s, { type: 'VenueReported', report: s.venues[0]!.reports[2]! });
    expect(again.effects).toEqual([]);
    expect(() => run(createTrustState(HOST), { type: 'VenueReported', report: s.venues[0]!.reports[0]! })).toThrow(/not in the TrustState/);
  });

  it('host ratings through the engine', () => {
    let s = createTrustState(HOST);
    let last: Effect[] = [];
    for (const [i, rater] of ['a', 'b', 'c', 'd', 'e'].entries()) {
      const out = run(s, { type: 'HostRated', hostId: HOST, gameId: G1, raterId: rater, stars: i === 0 ? 1 : 2, at: iso(T0 - HOUR_MS) });
      s = out.state;
      last = out.effects;
    }
    expect(types(last)).toEqual(['IssueSanction', 'SuspendHost', 'Notify', 'EnqueueReview']);
    expect(run(s, { type: 'HostRated', hostId: HOST, gameId: G1, raterId: 'e', stars: 2, at: iso(T0 - HOUR_MS) }).effects).toEqual([]);
  });

  it('chat blocks through the engine', () => {
    let s = createTrustState(U1);
    const ev = (h: number): DomainTrustEvent => ({ type: 'ChatMessageBlocked', gameId: G1, userId: U1, at: iso(T0 - h * HOUR_MS), categories: ['harassment'] });
    s = run(s, ev(3)).state;
    s = run(s, ev(3)).state;
    expect(s.chatBlocks).toHaveLength(1);
    s = run(s, ev(2)).state;
    const third = run(s, ev(1));
    expect(types(third.effects)).toEqual(['IssueSanction', 'Notify', 'IssueSanction', 'MuteChat', 'Notify']);
    expect(run(third.state, ev(1)).effects).toEqual([]);
  });

  it('chat blocks with a messageId are de-duplicated by id, not by (gameId, at)', () => {
    const at = iso(T0 - HOUR_MS);
    const ev = (messageId: string): DomainTrustEvent => ({ type: 'ChatMessageBlocked', gameId: G1, userId: U1, at, categories: [], messageId });
    let s = createTrustState(U1);
    s = run(s, ev('m1')).state;
    s = run(s, ev('m1')).state;
    expect(s.chatBlocks).toEqual([{ gameId: G1, at, messageId: 'm1' }]);
    s = run(s, ev('m2')).state;
    expect(s.chatBlocks.map((b) => b.messageId)).toEqual(['m1', 'm2']);
  });

  it('issued sanctions carry the read-model fields; overturn stamps overturnedAt', () => {
    const r = run(createTrustState(U1), lateCancel(false));
    const card = r.state.sanctions[0];
    expect(card).toMatchObject({ appealPath: 'dispute', overturnedAt: null, status: 'active' });
    expect(card?.statementParams['appealPath']).toBe('dispute');
  });
});

describe('engine properties', () => {
  const card = (n: number, daysAgo: number, status: 'active' | 'disputed' | 'upheld' = 'active') =>
    sanctionRow({ dedupeKey: `no_show:g${n}:${U1}`, startsAt: iso(T0 - daysAgo * DAY_MS), gameId: `g${n}`, status });
  const eventArb: fc.Arbitrary<DomainTrustEvent> = fc.oneof(
    fc.record({ h: fc.integer({ min: -10, max: 10 }), g: fc.constantFrom(G1, G2) }).map(({ h, g }) => ({ type: 'ParticipationCancelled' as const, gameId: g, userId: U1, startsAt, cancelledAt: iso(T0 + h * HOUR_MS) })),
    fc.record({ refilled: fc.boolean(), g: fc.constantFrom(G1, G2, 'g3') }).map(({ refilled, g }) => ({ ...lateCancel(refilled), gameId: g })),
    fc.record({ a: fc.constantFrom('no_show_unverified', 'verified', 'excused', 'unknown') as fc.Arbitrary<'verified'>, g: fc.constantFrom(G1, G2, 'g4') }).map(({ a, g }) => ({ type: 'AttendanceFinalized' as const, gameId: g, userId: U1, attendance: a, endsAt: startsAt })),
    fc.integer({ min: 0, max: 60 }).map((h) => ({ type: 'ChatMessageBlocked' as const, gameId: G1, userId: U1, at: iso(T0 - h * HOUR_MS), categories: [] })),
    fc.constant({ type: 'Tick' as const, at: iso(T0) }),
  );
  const stateArb = fc
    .array(fc.record({ d: fc.double({ min: 0, max: 40, noNaN: true }), st: fc.constantFrom('active', 'disputed', 'upheld') as fc.Arbitrary<'active'> }), { maxLength: 6 })
    .map((cards) => createTrustState(U1, { sanctions: cards.map((c, i) => card(i + 10, c.d, c.st)) }));

  it('system never emits permanent_ban; every sanction is temporary, keyed and explained', () => {
    fc.assert(
      fc.property(stateArb, fc.array(fc.record({ e: eventArb, dt: fc.integer({ min: 0, max: 10 * 24 }) }), { maxLength: 12 }), (s0, evs) => {
        let now = T0;
        const seq = evs.map(({ e, dt }) => ({ event: e, now: (now += dt * HOUR_MS) }));
        const { effects, state } = applyTrustEvents(s0, seq);
        const issued = assertSanctionInvariants(effects);
        expect(issued.every((s) => s.kind !== 'permanent_ban')).toBe(true);
        expect(issued.every((s) => s.decidedBy === 'system')).toBe(true);
        expect(new Set(state.sanctions.map((s) => s.dedupeKey)).size).toBe(state.sanctions.length);
      }),
      { numRuns: 300 },
    );
  });

  it('applying the same event twice yields the same state and no new effects', () => {
    fc.assert(
      fc.property(stateArb, eventArb, fc.integer({ min: 0, max: 72 }), (s0, e, h) => {
        const now = T0 + h * HOUR_MS;
        const once = applyTrustEvent(s0, e, undefined, now);
        const twice = applyTrustEvent(once.state, e, undefined, now);
        expect(twice.state).toEqual(once.state);
        expect(twice.effects).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('in-force card count never decreases except by expiry or overturn', () => {
    fc.assert(
      fc.property(stateArb, eventArb, (s0, e) => {
        const out = applyTrustEvent(s0, e, undefined, T0);
        const inForce = (s: TrustState) => s.sanctions.filter((x) => x.kind === 'yellow_card' && ['active', 'disputed', 'upheld'].includes(x.status) && Date.parse(x.expiresAt!) > T0).length;
        expect(inForce(out.state)).toBeGreaterThanOrEqual(inForce(s0));
      }),
    );
  });
});
