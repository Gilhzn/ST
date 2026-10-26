import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildModeratorPermanentBan,
  buildSystemSanction,
  computeReliability,
  deriveSanctionId,
  evaluateChatBlocks,
  evaluateEscalation,
  evaluateHostReliability,
  evaluateReports,
  evaluateVenueReports,
  independentCount,
  isConfirmedFake,
  isSettledCard,
  processNoShows,
  sanctionNotice,
  type GameAttendanceRecord,
  type ReporterProfile,
  type UserReport,
  type VenueReport,
} from '../src';
import { DAY_MS, G1, G2, HOST, HOUR_MS, T0, U1, U2, U3, U4, U5, assertSanctionInvariants, iso, sanctionRow } from './helpers';

describe('sanction builders', () => {
  it('system sanctions are temporary, keyed and carry a statement + appeal path', () => {
    const s = buildSystemSanction({ kind: 'join_ban', userId: U1, reasonCode: 'escalation_two_cards', durationMs: DAY_MS, dedupeKey: 'k' }, T0);
    expect(s).toMatchObject({
      decidedBy: 'system',
      expiresAt: iso(T0 + DAY_MS),
      disputeUntil: null,
      statementKey: 'sanctions.reason.escalation_two_cards',
      statementParams: { appealPath: 'appeal' },
    });
    expect(() => buildSystemSanction({ kind: 'join_ban', userId: U1, reasonCode: 'no_show', durationMs: 0, dedupeKey: 'k' }, T0)).toThrow(RangeError);
    expect(() => buildSystemSanction({ kind: 'join_ban', userId: U1, reasonCode: 'no_show', durationMs: Infinity, dedupeKey: 'k' }, T0)).toThrow();
    expect(() =>
      buildSystemSanction({ kind: 'permanent_ban' as 'join_ban', userId: U1, reasonCode: 'no_show', durationMs: 1, dedupeKey: 'k' }, T0),
    ).toThrow(/never issues permanent/);
  });
  it('only the moderator builder produces permanent bans', () => {
    const p = buildModeratorPermanentBan(U1, 'pb', T0);
    expect(p).toMatchObject({ kind: 'permanent_ban', decidedBy: 'moderator', expiresAt: null });
    expect(sanctionNotice(p)).toMatchObject({ kind: 'sanction_issued', params: { expiresAt: '', appealPath: 'appeal' } });
  });
});

describe('escalation (TRUST-022/025)', () => {
  /** Card n issued `daysAgo` days before T0. */
  const card = (n: number, daysAgo: number, extra: Partial<Parameters<typeof sanctionRow>[0]> = {}) =>
    sanctionRow({ dedupeKey: `no_show:g${n}:${U1}`, startsAt: iso(T0 - daysAgo * DAY_MS), gameId: `g${n}`, ...extra });

  it('only settled cards count: window closed undisputed, or upheld', () => {
    expect(isSettledCard(card(1, 3), T0)).toBe(true);
    expect(isSettledCard(card(1, 1), T0)).toBe(false);
    expect(isSettledCard(card(1, 1, { status: 'upheld' }), T0)).toBe(true);
    expect(isSettledCard(card(1, 3, { status: 'disputed' }), T0)).toBe(false);
    expect(isSettledCard(card(1, 31), T0)).toBe(false);
    expect(isSettledCard(card(1, 3, { status: 'overturned' }), T0)).toBe(false);
    expect(isSettledCard(card(1, 3, { kind: 'join_ban' } as never), T0)).toBe(false);
    expect(isSettledCard(card(1, 3, { disputeUntil: null }), T0)).toBe(true);
  });

  it('2 settled cards → 7-day join ban caused by both', () => {
    const cards = [card(1, 10), card(2, 3)];
    const out = evaluateEscalation(cards, T0);
    expect(out.level).toBe('join_ban_short');
    const [s] = assertSanctionInvariants(out.effects);
    expect(s).toMatchObject({
      kind: 'join_ban',
      reasonCode: 'escalation_two_cards',
      expiresAt: iso(T0 + 7 * DAY_MS),
      causedBy: cards.map((c) => c.id),
      dedupeKey: `escalation_two_cards:${U1}:${cards[1]!.id}`,
      statementParams: { cards: 2, days: 7, appealPath: 'appeal' },
    });
    expect(out.effects.map((e) => e.type)).toEqual(['IssueSanction', 'BanJoins', 'Notify']);
  });

  it('a card still disputable does not escalate yet (AC-TRUST-025: ban at 48:00)', () => {
    const cards = [card(1, 10), card(2, 1)];
    expect(evaluateEscalation(cards, T0).level).toBe('none');
    const at48h = Date.parse(cards[1]!.disputeUntil!) + 1;
    expect(evaluateEscalation(cards, at48h).level).toBe('join_ban_short');
  });

  it('3 → 30 days; 4+ → 30 days and a high-priority review, never a permanent ban', () => {
    const three = [card(1, 12), card(2, 10), card(3, 3)];
    const o3 = evaluateEscalation(three, T0);
    expect(o3.level).toBe('join_ban_long');
    expect(assertSanctionInvariants(o3.effects)[0]).toMatchObject({ reasonCode: 'escalation_three_cards', expiresAt: iso(T0 + 30 * DAY_MS) });
    const four = [...three, card(4, 2.5)];
    const o4 = evaluateEscalation(four, T0);
    expect(o4.level).toBe('review');
    const issued = assertSanctionInvariants(o4.effects);
    expect(issued.map((s) => s.kind)).toEqual(['join_ban']);
    expect(o4.effects.find((e) => e.type === 'EnqueueReview')).toMatchObject({
      item: { kind: 'permanent_ban_candidate', priority: 'high', subjectUserId: U1, evidence: { activeCards: 4 } },
    });
  });

  it('cards already covered by an escalation never re-trigger (expiry cannot cause a new ban)', () => {
    const cards = [card(1, 12), card(2, 10), card(3, 3)];
    const ban = sanctionRow({
      dedupeKey: 'ban',
      kind: 'join_ban',
      reasonCode: 'escalation_three_cards',
      causedBy: cards.map((c) => c.id),
      disputeUntil: null,
    } as never);
    expect(evaluateEscalation([...cards, ban], T0).level).toBe('none');
    expect(evaluateEscalation([cards[1]!, cards[2]!, ban], T0).level).toBe('none');
    const fresh = card(5, 2.5);
    expect(evaluateEscalation([...cards, ban, fresh], T0)).toMatchObject({ level: 'review', activeCards: 4 });
    expect(evaluateEscalation([card(1, 3)], T0).level).toBe('none');
  });
});

const profile = (id: string, createdDaysAgo: number, extra: Partial<ReporterProfile> = {}): ReporterProfile => ({
  id,
  createdAt: iso(T0 - createdDaysAgo * DAY_MS),
  reliabilityStatus: 'green',
  reportsLast7d: 1,
  ...extra,
});
const report = (id: string, reporterId: string, hoursAgo: number, extra: Partial<UserReport> = {}): UserReport => ({
  id,
  reporterId,
  targetUserId: U1,
  category: 'harassment',
  gameId: G1,
  messageId: null,
  note: null,
  createdAt: iso(T0 - hoursAgo * HOUR_MS),
  ...extra,
});
const att = (userId: string, gameId = G1, extra: Partial<GameAttendanceRecord> = {}): GameAttendanceRecord => ({
  gameId,
  userId,
  status: 'approved',
  attendance: 'verified',
  checkInMethod: 'gps',
  isHost: false,
  team: null,
  ...extra,
});

describe('evaluateReports (TRUST-041…048)', () => {
  const profiles = [profile(U2, 30), profile(U3, 60), profile(U4, 90)];
  // Reports span two games (a single game is review-only) and every reporter was GPS-verified there.
  const reports = [report('r1', U2, 20), report('r2', U3, 10, { gameId: G2 }), report('r3', U4, 1)];
  const attendance = [U1, U2, U3, U4].flatMap((u) => [att(u), att(u, G2)]);

  it('3 independent qualifying co-attendees → 72h restriction + notice + review (AC-TRUST-043)', () => {
    const r = evaluateReports(reports, profiles, T0, undefined, { attendance });
    expect(r.outcome).toBe('restrict');
    expect(r.qualifyingReporterIds).toEqual([U2, U3, U4]);
    const [s] = assertSanctionInvariants(r.effects);
    expect(s).toMatchObject({
      kind: 'visibility_restriction',
      reasonCode: 'toxicity_reports',
      expiresAt: iso(T0 + 72 * HOUR_MS),
      dedupeKey: `toxicity_reports:${U1}:r1`,
    });
    expect(r.effects.map((e) => e.type)).toEqual(['IssueSanction', 'RestrictVisibility', 'Notify', 'EnqueueReview']);
    expect(r.effects[2]).toMatchObject({ kind: 'visibility_restricted', params: { statementKey: 'sanctions.reason.toxicity_reports' } });
    expect(r.effects[3]).toMatchObject({ item: { kind: 'toxicity_reports', sanctionId: deriveSanctionId(s!.dedupeKey), reportIds: ['r1', 'r2', 'r3'] } });
  });

  it('two reporters created within 48h → collusion, review only (AC-TRUST-042)', () => {
    const p = [profile(U2, 30), profile(U3, 30.5), profile(U4, 90)];
    const r = evaluateReports(reports, p, T0, undefined, { attendance });
    expect(r.outcome).toBe('review_only');
    expect(r.independentReporters).toBe(2);
    expect(r.reviewReasons).toEqual(['creation_window']);
    expect(assertSanctionInvariants(r.effects)).toEqual([]);
    expect(r.effects).toHaveLength(1);
    expect(r.effects[0]).toMatchObject({ item: { kind: 'collusion_suspected', evidence: { collusionSuspected: true } } });
    expect(r.effects.some((e) => e.type === 'Notify')).toBe(false);
  });

  it('SECURITY: reports all from one game are review-only (single_game)', () => {
    const oneGame = reports.map((r) => ({ ...r, gameId: G1 }));
    const r = evaluateReports(oneGame, profiles, T0, undefined, { attendance });
    expect(r).toMatchObject({ outcome: 'review_only', reviewReasons: ['single_game'] });
    expect(assertSanctionInvariants(r.effects)).toEqual([]);
    expect(r.effects[0]).toMatchObject({ item: { kind: 'collusion_suspected' } });
  });

  it('SECURITY: needs a GPS-verified, non-host reporter as anchor (no_gps_anchor)', () => {
    const qrOnly = [U1, U2, U3, U4].flatMap((u) => [att(u, G1, { checkInMethod: 'qr' }), att(u, G2, { checkInMethod: 'host' })]);
    expect(evaluateReports(reports, profiles, T0, undefined, { attendance: qrOnly })).toMatchObject({
      outcome: 'review_only',
      reviewReasons: ['no_gps_anchor'],
    });
    const hostAnchor = qrOnly.map((a) => (a.userId === U2 && a.gameId === G1 ? { ...a, checkInMethod: 'gps' as const, isHost: true } : a));
    expect(evaluateReports(reports, profiles, T0, undefined, { attendance: hostAnchor }).reviewReasons).toEqual(['no_gps_anchor']);
    const oneAnchor = qrOnly.map((a) => (a.userId === U3 && a.gameId === G2 ? { ...a, checkInMethod: 'gps' as const } : a));
    expect(evaluateReports(reports, profiles, T0, undefined, { attendance: oneAnchor }).outcome).toBe('restrict');
  });

  it('reporters must have been checked in at the same game as the subject (co-attendance)', () => {
    const noShowU4 = attendance.map((a) => (a.userId === U4 ? { ...a, attendance: 'no_show_unverified' as const } : a));
    const r = evaluateReports(reports, profiles, T0, undefined, { attendance: noShowU4 });
    expect(r.outcome).toBe('none');
    expect(r.excluded).toEqual([{ reporterId: U4, reason: 'not_co_attendee' }]);
    expect(evaluateReports(reports, profiles, T0).excluded.map((e) => e.reason)).toEqual(['not_co_attendee', 'not_co_attendee', 'not_co_attendee']);
    const noGame = evaluateReports([report('r9', U2, 1, { gameId: null })], profiles, T0, undefined, { attendance });
    expect(noGame.excluded).toEqual([{ reporterId: U2, reason: 'not_co_attendee' }]);
    const notSubject = evaluateReports(reports, profiles, T0, undefined, { attendance: attendance.filter((a) => a.userId !== U1) });
    expect(notSubject.qualifyingReporterIds).toEqual([]);
  });

  it('a reported chat message counts from any approved participant (same chat)', () => {
    const chat = reports.map((r) => ({ ...r, messageId: `m-${r.id}` }));
    const a = attendance.map((x) => (x.userId === U2 ? { ...x, attendance: 'unknown' as const, checkInMethod: null } : x));
    expect(evaluateReports(chat, profiles, T0, undefined, { attendance: a }).outcome).toBe('restrict');
  });

  it('reporter qualification: age at report time, red, spam, accuracy, self, unknown', () => {
    const r = evaluateReports(
      [
        report('a', U2, 1),
        report('b', U3, 1),
        report('c', U4, 1),
        report('d', U5, 1),
        report('e', U1, 1),
        report('f', 'ghost', 1),
        report('g', 'acc', 1),
      ],
      [
        profile(U2, 6.9),
        profile(U3, 30, { reliabilityStatus: 'red' }),
        profile(U4, 30, { reportsLast7d: 11 }),
        profile(U5, 30, { reportsLast7d: 10, reportsResolved: 5, reportsUpheld: 1 }),
        profile(U1, 30),
        profile('acc', 30, { reportsResolved: 4, reportsUpheld: 0 }),
      ],
      T0,
      undefined,
      { attendance: [att(U1), att(U2), att(U3), att(U4), att(U5), att('ghost'), att('acc')] },
    );
    expect(Object.fromEntries(r.excluded.map((e) => [e.reporterId, e.reason]))).toEqual({
      [U2]: 'account_too_new',
      [U3]: 'red_status',
      [U4]: 'spamming',
      [U5]: 'low_accuracy',
      [U1]: 'self',
      ghost: 'unknown_profile',
    });
    expect(r.qualifyingReporterIds).toEqual(['acc']);
    const later = evaluateReports([report('a', U2, 30), report('a2', U2, 1)], [profile(U2, 7.5)], T0, undefined, { attendance });
    expect(later).toMatchObject({ qualifyingReporterIds: [U2], countedReportIds: ['a2'], excluded: [] });
  });

  it('only reports in the 14-day window, not yet consumed, count; in-force restriction blocks re-issue', () => {
    const old = [report('r1', U2, 14 * 24), ...reports.slice(1)];
    expect(evaluateReports(old, profiles, T0, undefined, { attendance }).outcome).toBe('none');
    const restriction = sanctionRow({
      dedupeKey: `toxicity_reports:${U1}:r0`,
      kind: 'visibility_restriction',
      reasonCode: 'toxicity_reports',
      startsAt: iso(T0 - 5 * HOUR_MS),
      expiresAt: iso(T0 + 67 * HOUR_MS),
      disputeUntil: null,
    } as never);
    expect(evaluateReports(reports, profiles, T0, undefined, { attendance, sanctions: [restriction] }).outcome).toBe('none');
    const fresh = [report('n1', U2, 3), report('n2', U3, 2), report('n3', U4, 1)];
    expect(evaluateReports(fresh, profiles, T0, undefined, { attendance, sanctions: [restriction] }).outcome).toBe('already_restricted');
    expect(evaluateReports([], profiles, T0)).toMatchObject({ outcome: 'none', targetUserId: null });
  });

  it('14-day protection after an overturned restriction: review only (TRUST-048)', () => {
    const overturned = sanctionRow({
      dedupeKey: `toxicity_reports:${U1}:old`,
      kind: 'visibility_restriction',
      reasonCode: 'toxicity_reports',
      startsAt: iso(T0 - 5 * DAY_MS),
      expiresAt: iso(T0 - 2 * DAY_MS),
      disputeUntil: null,
      status: 'overturned',
    } as never);
    const ctx = { attendance, sanctions: [overturned], overturns: [{ sanctionId: overturned.id, at: iso(T0 - 4 * DAY_MS) }] };
    const r = evaluateReports(reports, profiles, T0, undefined, ctx);
    expect(r).toMatchObject({ outcome: 'review_only', reviewReasons: ['overturn_protection'] });
    expect(r.effects[0]).toMatchObject({ item: { kind: 'toxicity_reports', dedupeKey: `protected_reports:${U1}:r1` } });
    const later = evaluateReports(reports, profiles, T0 + 11 * DAY_MS, undefined, ctx);
    expect(later.outcome).not.toBe('review_only');
  });

  it('severe categories reach a human within 1 h even below threshold (TRUST-045)', () => {
    const r = evaluateReports([report('v1', U2, 1, { category: 'violence' })], profiles, T0, undefined, { attendance });
    expect(r.outcome).toBe('none');
    expect(r.effects).toEqual([
      expect.objectContaining({
        type: 'EnqueueReview',
        item: expect.objectContaining({ priority: 'high', dedupeKey: 'severe_report:v1', dueBy: iso(T0 + HOUR_MS) }),
      }),
    ]);
  });

  it('property: removing a reporter never increases severity; < 3 qualifying never restricts', () => {
    const rank = { none: 0, already_restricted: 0, review_only: 1, restrict: 2 } as const;
    const ids = [U2, U3, U4, U5, 'u6'];
    fc.assert(
      fc.property(
        fc.array(fc.record({ created: fc.integer({ min: 8, max: 200 }), team: fc.constantFrom(null, 0, 1), game: fc.constantFrom(G1, G2) }), { minLength: 5, maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }),
        (meta, drop) => {
          const ps = ids.map((id, i) => profile(id, meta[i]!.created));
          const rs = ids.map((id, i) => report(`r${i}`, id, 5 - i, { gameId: meta[i]!.game }));
          const a = [att(U1, G1, { team: 0 }), att(U1, G2, { team: 0 }), ...ids.flatMap((id, i) => [att(id, G1, { team: meta[i]!.team }), att(id, G2, { team: meta[i]!.team })])];
          const full = evaluateReports(rs, ps, T0, undefined, { attendance: a });
          const less = evaluateReports(rs.filter((_, i) => i !== drop), ps, T0, undefined, { attendance: a });
          expect(rank[less.outcome]).toBeLessThanOrEqual(rank[full.outcome]);
          const two = evaluateReports(rs.slice(0, 2), ps, T0, undefined, { attendance: a });
          expect(two.outcome).toBe('none');
          assertSanctionInvariants(full.effects);
        },
      ),
    );
  });

  it('independentCount is the minimum 48h-window cover', () => {
    const h = HOUR_MS;
    expect(independentCount([], 48 * h)).toBe(0);
    expect(independentCount([0, 40 * h, 80 * h], 48 * h)).toBe(2);
    expect(independentCount([0, 48 * h, 96.1 * h], 48 * h)).toBe(2);
    expect(independentCount([0, 49 * h, 98 * h], 48 * h)).toBe(3);
  });
});

describe('evaluateHostReliability (TRUST-051)', () => {
  const rating = (rater: string, stars: 1 | 2 | 3 | 4 | 5, daysAgo = 1, gameId = G1) => ({ hostId: HOST, gameId, raterId: rater, stars, at: iso(T0 - daysAgo * DAY_MS) });
  const five = [rating('a', 2), rating('b', 2), rating('c', 1), rating('d', 3), rating('e', 2)];

  it('average ≤ 2 over ≥ 5 ratings → host suspension + review', () => {
    const r = evaluateHostReliability({ hostId: HOST, ratings: five, confirmedFakeVenueIds: [], sanctions: [] }, T0);
    expect(r).toMatchObject({ outcome: 'suspend', reasonCode: 'low_host_rating', ratingCount: 5, averageRating: 2 });
    const [s] = assertSanctionInvariants(r.effects);
    expect(s).toMatchObject({ kind: 'host_suspension', expiresAt: iso(T0 + 14 * DAY_MS), statementParams: { average: 2, ratings: 5, days: 14 } });
    expect(r.effects.map((e) => e.type)).toEqual(['IssueSanction', 'SuspendHost', 'Notify', 'EnqueueReview']);
  });

  it('boundaries: 4 ratings, average 2.2, outside 90 days, self-rating, duplicates', () => {
    const run = (ratings: ReturnType<typeof rating>[]) => evaluateHostReliability({ hostId: HOST, ratings, confirmedFakeVenueIds: [], sanctions: [] }, T0).outcome;
    expect(run(five.slice(0, 4))).toBe('none');
    expect(run([...five.slice(0, 4), rating('e', 3)])).toBe('none');
    expect(run([...five.slice(0, 4), rating('e', 1, 91)])).toBe('none');
    expect(run([...five.slice(0, 4), { ...rating('e', 1), raterId: HOST }])).toBe('none');
    expect(run([...five.slice(0, 4), rating('a', 1)])).toBe('none');
    expect(run([...five, { ...rating('z', 1), hostId: 'other' }])).toBe('suspend');
    expect(run([...five.slice(0, 4), { ...rating('e', 2), at: iso(T0 + HOUR_MS) }])).toBe('none');
  });

  it('confirmed fake venue → suspension per venue; nothing while suspended; ratings consumed', () => {
    const r = evaluateHostReliability({ hostId: HOST, ratings: [], confirmedFakeVenueIds: ['v2', 'v1'], sanctions: [] }, T0);
    expect(r).toMatchObject({ outcome: 'suspend', reasonCode: 'fake_venue' });
    expect(assertSanctionInvariants(r.effects)[0]).toMatchObject({ dedupeKey: `fake_venue:${HOST}:v1`, statementParams: { venueId: 'v1' } });
    const active = sanctionRow({ dedupeKey: `fake_venue:${HOST}:v1`, userId: HOST, kind: 'host_suspension', reasonCode: 'fake_venue', disputeUntil: null } as never);
    expect(evaluateHostReliability({ hostId: HOST, ratings: [], confirmedFakeVenueIds: ['v1', 'v2'], sanctions: [active] }, T0).outcome).toBe('already_suspended');
    expect(evaluateHostReliability({ hostId: HOST, ratings: [], confirmedFakeVenueIds: ['v1'], sanctions: [active] }, T0 + 31 * DAY_MS).outcome).toBe('none');
    const consumed = sanctionRow({
      dedupeKey: 'low',
      userId: HOST,
      kind: 'host_suspension',
      reasonCode: 'low_host_rating',
      startsAt: iso(T0 - 40 * DAY_MS + HOUR_MS),
      expiresAt: iso(T0 - 10 * DAY_MS),
      disputeUntil: null,
      status: 'expired',
    } as never);
    const older = five.map((x) => ({ ...x, at: iso(T0 - 40 * DAY_MS) }));
    expect(evaluateHostReliability({ hostId: HOST, ratings: older, confirmedFakeVenueIds: [], sanctions: [consumed] }, T0).ratingCount).toBe(0);
    expect(evaluateHostReliability({ hostId: HOST, ratings: [], confirmedFakeVenueIds: [], sanctions: [] }, T0).averageRating).toBeNull();
  });
});

describe('evaluateVenueReports', () => {
  const vr = (id: string, reporterId: string, reason: VenueReport['reason'] = 'no_venue_here', hoursAgo = 1): VenueReport => ({
    id,
    venueId: 'v1',
    reporterId,
    reason,
    note: null,
    createdAt: iso(T0 - hoursAgo * HOUR_MS),
  });
  const VP = [U1, U2, U3, U4, HOST].map((id) => profile(id, 30));
  const venue = (reports: VenueReport[], extra = {}) => ({ venueId: 'v1', status: 'active' as const, createdBy: HOST, lastReviewedAt: null, reports, ...extra });

  it('3 distinct reporters hide the venue pending review and notify the creator', () => {
    const r = evaluateVenueReports(venue([vr('a', U1), vr('b', U2, 'closed'), vr('c', U3)]), VP, T0);
    expect(r.hide).toBe(true);
    expect(r.effects).toEqual([
      { type: 'SetVenueStatus', venueId: 'v1', status: 'hidden_pending_review' },
      expect.objectContaining({ type: 'EnqueueReview', item: expect.objectContaining({ kind: 'venue_reports', dedupeKey: 'venue_reports:v1:a', evidence: { reporters: 3, no_venue_here: 2, closed: 1 } }) }),
      { type: 'Notify', userId: HOST, kind: 'venue_hidden', params: { venueId: 'v1', reporters: 3 }, gameId: null, sanctionDedupeKey: null },
    ]);
  });

  it('2 reporters, duplicate reporters, creator self-reports, consumed reports and non-active venues do not hide', () => {
    expect(evaluateVenueReports(venue([vr('a', U1), vr('b', U2)]), VP, T0).hide).toBe(false);
    expect(evaluateVenueReports(venue([vr('a', U1), vr('b', U2), vr('c', U2)]), VP, T0).hide).toBe(false);
    expect(evaluateVenueReports(venue([vr('a', U1), vr('b', U2), vr('c', HOST)]), VP, T0).hide).toBe(false);
    expect(evaluateVenueReports(venue([vr('a', U1, undefined, 5), vr('b', U2), vr('c', U3)], { lastReviewedAt: iso(T0 - 2 * HOUR_MS) }), VP, T0).hide).toBe(false);
    expect(evaluateVenueReports(venue([vr('a', U1), vr('b', U2), vr('c', U3)], { status: 'hidden_pending_review' }), VP, T0).hide).toBe(false);
    const noCreator = evaluateVenueReports(venue([vr('a', U1), vr('b', U2), vr('c', U3)], { createdBy: null }), VP, T0);
    expect(noCreator.effects.map((e) => e.type)).toEqual(['SetVenueStatus', 'EnqueueReview']);
  });

  it('SECURITY: only qualified reporters count (account age at report time, not red)', () => {
    const three = venue([vr('a', U1), vr('b', U2), vr('c', U3)]);
    expect(evaluateVenueReports(three, [profile(U1, 30), profile(U2, 30), profile(U3, 6.9)], T0).hide).toBe(false);
    expect(evaluateVenueReports(three, [profile(U1, 30), profile(U2, 30), profile(U3, 30, { reliabilityStatus: 'red' })], T0).hide).toBe(false);
    expect(evaluateVenueReports(three, [profile(U1, 30), profile(U2, 30)], T0)).toMatchObject({ hide: false, reporterIds: [U1, U2] });
    expect(evaluateVenueReports(three, [profile(U1, 30), profile(U2, 30), profile(U3, 7 + 1 / 24 + 1e-6)], T0).hide).toBe(true);
    expect(evaluateVenueReports(venue([vr('a', U1), vr('b', U2), vr('c', U3), vr('d', U4)]), [...VP.slice(0, 2), profile(U3, 1), profile(U4, 40)], T0).reporterIds).toEqual([U1, U2, U4]);
  });

  it('isConfirmedFake needs a majority of no_venue_here', () => {
    expect(isConfirmedFake(venue([vr('a', U1), vr('b', U2, 'closed'), vr('c', U3)]))).toBe(true);
    expect(isConfirmedFake(venue([vr('a', U1), vr('b', U2, 'closed')]))).toBe(false);
    expect(isConfirmedFake(venue([]))).toBe(false);
  });
});

describe('evaluateChatBlocks (CHAT-021)', () => {
  const block = (hoursAgo: number, gameId = G1) => ({ gameId, at: iso(T0 - hoursAgo * HOUR_MS) });
  it('3 blocks in 7 days → yellow card + 24h mute caused by the card', () => {
    const r = evaluateChatBlocks(U1, [block(100), block(50), block(0)], [], T0);
    expect(r.triggered).toBe(true);
    const [card, mute] = assertSanctionInvariants(r.effects);
    expect(card).toMatchObject({ kind: 'yellow_card', reasonCode: 'chat_blocks', disputeUntil: iso(T0 + 48 * HOUR_MS), expiresAt: iso(T0 + 30 * DAY_MS) });
    expect(mute).toMatchObject({ kind: 'chat_mute', expiresAt: iso(T0 + 24 * HOUR_MS), causedBy: [deriveSanctionId(card!.dedupeKey)] });
    expect(r.effects.map((e) => e.type)).toEqual(['IssueSanction', 'Notify', 'IssueSanction', 'MuteChat', 'Notify']);
    expect(r.effects[4]).toMatchObject({ kind: 'chat_muted' });
  });
  it('blocks older than 7 days or already consumed do not count', () => {
    expect(evaluateChatBlocks(U1, [block(7 * 24), block(50), block(0)], [], T0).triggered).toBe(false);
    const prior = sanctionRow({ dedupeKey: 'cb', reasonCode: 'chat_blocks', startsAt: iso(T0 - 60 * HOUR_MS) });
    expect(evaluateChatBlocks(U1, [block(100), block(50), block(0)], [prior], T0)).toMatchObject({ triggered: false, blocksInWindow: 2 });
    expect(evaluateChatBlocks(U1, [block(2, G2), block(2, G1), block(1)], [], T0).triggered).toBe(true);
  });
});

describe('computeReliability (TRUST-030/031)', () => {
  const p = (attendance: 'verified' | 'no_show_unverified' | 'excused' | 'unknown', daysAgo = 1, extra = {}) => ({
    gameId: G1,
    status: 'approved' as const,
    attendance,
    lateCancel: false,
    cancelledAt: null,
    endsAt: iso(T0 - daysAgo * DAY_MS),
    ...extra,
  });
  const late = (daysAgo = 1, extra = {}) => ({ ...p('unknown'), status: 'cancelled' as const, lateCancel: true, cancelledAt: iso(T0 - daysAgo * DAY_MS), ...extra });

  it('formula, counts and rounding', () => {
    const s = computeReliability([p('verified'), p('verified'), p('no_show_unverified'), late()], [], T0);
    expect(s).toEqual({
      score: Math.round((5 / 6.5) * 10_000) / 10_000,
      status: 'yellow',
      verifiedCount: 2,
      commitmentCount: 4,
      lateCancelCount: 1,
      noShowCount: 1,
      computedAt: iso(T0),
    });
  });
  it('fewer than 3 commitments → new; excused/unknown/not-happened/refilled/outside window ignored', () => {
    const s = computeReliability(
      [p('verified'), p('excused'), p('unknown'), p('verified', 91), p('verified', 1, { gameHappened: false }), late(1, { lateCancelRefilled: true }), p('verified', -1)],
      [],
      T0,
    );
    expect(s).toMatchObject({ status: 'new', score: null, commitmentCount: 1 });
  });
  it('green / yellow / red', () => {
    const many = Array.from({ length: 10 }, () => p('verified'));
    expect(computeReliability(many, [], T0).status).toBe('green');
    const card = sanctionRow({ dedupeKey: 'c', startsAt: iso(T0 - DAY_MS) });
    expect(computeReliability(many, [card], T0).status).toBe('yellow');
    const ban = sanctionRow({ dedupeKey: 'b', kind: 'join_ban', disputeUntil: null } as never);
    expect(computeReliability([], [ban], T0).status).toBe('red');
    const bad = [...Array.from({ length: 6 }, () => p('no_show_unverified')), p('verified')];
    expect(computeReliability(bad, [], T0).status).toBe('red');
  });
  it('property: score in [0,1], adding a verified attendance never lowers it', () => {
    fc.assert(
      fc.property(fc.nat(15), fc.nat(15), fc.nat(15), (v, n, l) => {
        const parts = [...Array.from({ length: v }, () => p('verified')), ...Array.from({ length: n }, () => p('no_show_unverified')), ...Array.from({ length: l }, () => late())];
        const a = computeReliability(parts, [], T0);
        const b = computeReliability([...parts, p('verified')], [], T0);
        if (a.score !== null) {
          expect(a.score).toBeGreaterThanOrEqual(0);
          expect(a.score).toBeLessThanOrEqual(1);
          expect(b.score!).toBeGreaterThanOrEqual(a.score);
        }
        if (v + n + l < 3) expect(a.status).toBe('new');
      }),
    );
  });
});

describe('processNoShows / attendance finalisation (TRUST-010/011/021)', () => {
  const game = { id: G1, hostId: HOST, startsAt: iso(T0), endsAt: iso(T0 + 90 * 60_000), status: 'scheduled' as const };
  const after = T0 + 90 * 60_000 + 2 * HOUR_MS;
  const part = (userId: string, attendance: 'verified' | 'unknown' | 'excused', extra = {}) => ({
    userId,
    status: 'approved' as const,
    attendance,
    lateCancel: false,
    cancelledAt: null,
    ...extra,
  });

  it('waits until endsAt + 2h and ignores cancelled games', () => {
    expect(processNoShows({ game, participants: [] }, after - 1).finalized).toBe(false);
    expect(processNoShows({ game: { ...game, status: 'cancelled' }, participants: [] }, after).finalized).toBe(false);
  });

  it('marks unverified approved players (not the host) as no-shows', () => {
    const r = processNoShows({ game, participants: [part(HOST, 'unknown'), part(U1, 'verified'), part(U2, 'verified'), part(U3, 'unknown'), part(U4, 'excused'), { ...part(U5, 'unknown'), status: 'rejected' as const }] }, after);
    expect(r).toMatchObject({ finalized: true, gameHappened: true, verifiedCount: 2 });
    expect(r.effects).toEqual([{ type: 'SetAttendance', gameId: G1, userId: U3, attendance: 'no_show_unverified' }]);
    expect(r.events).toEqual([
      { type: 'AttendanceFinalized', gameId: G1, userId: U1, attendance: 'verified', endsAt: game.endsAt },
      { type: 'AttendanceFinalized', gameId: G1, userId: U2, attendance: 'verified', endsAt: game.endsAt },
      { type: 'AttendanceFinalized', gameId: G1, userId: U3, attendance: 'no_show_unverified', endsAt: game.endsAt },
      { type: 'AttendanceFinalized', gameId: G1, userId: U4, attendance: 'excused', endsAt: game.endsAt },
    ]);
  });

  it('a game that did not happen yields no cards, excuses everyone and releases deposits (AC-TRUST-011)', () => {
    const late = { ...part(U4, 'unknown'), status: 'cancelled' as const, lateCancel: true, cancelledAt: iso(T0 - HOUR_MS) };
    const r = processNoShows({ game, participants: [part(U1, 'verified'), part(U2, 'unknown'), late], minPlayers: 10 }, after);
    expect(r.gameHappened).toBe(false);
    expect(r.events).toEqual([]);
    expect(r.effects.map((e) => e.type)).toEqual(['SettleDeposit', 'SetAttendance', 'SettleDeposit', 'SettleDeposit', 'EnqueueReview']);
    expect(r.effects[4]).toMatchObject({ item: { kind: 'host_reliability', subjectUserId: HOST, evidence: { reason: 'game_not_happened', threshold: 5 } } });
  });

  it('late cancellers: refilled only when promoted before the start and the replacement checked in', () => {
    const cancelledAt = iso(T0 - 90 * 60_000);
    const late = { ...part(U4, 'unknown'), status: 'cancelled' as const, lateCancel: true, cancelledAt };
    const base = [part(U1, 'verified'), part(U2, 'verified'), late];
    const run = (replacement: ReturnType<typeof part>, promotedAt: string) =>
      processNoShows({ game, participants: [...base, replacement], refills: [{ cancelledUserId: U4, replacementUserId: U5, promotedAt }] }, after).events.find(
        (e) => e.type === 'LateCancelFinalized',
      );
    expect(run(part(U5, 'verified'), iso(T0 - HOUR_MS))).toMatchObject({ refilled: true, cancelledAt });
    expect(run(part(U5, 'unknown'), iso(T0 - HOUR_MS))).toMatchObject({ refilled: false });
    expect(run(part(U5, 'verified'), iso(T0))).toMatchObject({ refilled: false });
    expect(run(part(U5, 'verified'), iso(T0 - 2 * HOUR_MS))).toMatchObject({ refilled: false });
    expect(processNoShows({ game, participants: base }, after).events.at(-1)).toMatchObject({ type: 'LateCancelFinalized', refilled: false });
  });
});
