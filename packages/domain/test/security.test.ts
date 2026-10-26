/**
 * Regression tests for the adversarial-review findings (security fix round).
 * One block per finding; each would fail on the pre-fix implementation.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRUST_CONFIG,
  applyHostGameCancellation,
  applyTrustEvent,
  createTrustState,
  deriveSanctionId,
  evaluateHostGameCancellation,
  evaluateHostReliability,
  evaluateReports,
  evaluateVenueReports,
  generateQrToken,
  isHostLateCancelCard,
  matchBlocklist,
  normalizeForMatch,
  verifyPeer,
  verifyQr,
  type Sanction,
} from '../src';
import { DAY_MS, G1, G2, HOST, HOUR_MS, T0, U1, U2, U3, U4, assertSanctionInvariants, iso, sanctionRow } from './helpers';

describe('(1) QR: 20 s steps, past-only drift', () => {
  it('defaults', () => {
    expect(DEFAULT_TRUST_CONFIG.qrStepSeconds).toBe(20);
    expect(DEFAULT_TRUST_CONFIG.qrAllowedDriftSteps).toBe(1);
  });
  it('a token minted for a future step (e.g. a host clock set ahead and relayed) is never accepted', () => {
    const now = T0;
    const future = generateQrToken('s', G1, now + 20_000);
    expect(verifyQr(future.token, 's', G1, now)).toMatchObject({ outcome: 'rejected', reason: 'invalid_qr' });
    expect(verifyQr(future.token, 's', G1, now + 20_000).outcome).toBe('verified');
    expect(verifyQr(future.token, 's', G1, now + 40_000).outcome).toBe('verified');
    expect(verifyQr(future.token, 's', G1, now + 60_000)).toMatchObject({ reason: 'expired_qr' });
  });
});

describe('(2) the host cannot QR-verify themself', () => {
  it('rejects not_host before any token check', () => {
    expect(verifyQr('garbage', 's', G1, T0, undefined, undefined, { userId: HOST, hostId: HOST })).toMatchObject({ reason: 'not_host' });
  });
});

describe('(3) peer anchors must be GPS-verified', () => {
  it('two QR-verified confirmers (a relayed screenshot) cannot peer-verify anyone', () => {
    const r = verifyPeer(
      {
        targetUserId: U1,
        participants: [
          { userId: U1, status: 'approved', attendance: 'unknown', checkInMethod: null },
          { userId: U2, status: 'approved', attendance: 'verified', checkInMethod: 'qr' },
          { userId: U3, status: 'approved', attendance: 'verified', checkInMethod: 'qr' },
        ],
        confirmations: [
          { confirmerId: U2, targetId: U1 },
          { confirmerId: U3, targetId: U1 },
        ],
        blocks: [],
      },
      T0,
    );
    expect(r).toMatchObject({ confirmations: 0, verdict: { outcome: 'rejected', reason: 'insufficient_peers' } });
  });
});

describe('(4) report-based restriction needs ≥ 2 games and a GPS non-host anchor', () => {
  const profiles = [U2, U3, U4].map((id, i) => ({ id, createdAt: iso(T0 - (30 + 30 * i) * DAY_MS), reliabilityStatus: 'green' as const, reportsLast7d: 0 }));
  const rep = (id: string, reporterId: string, gameId: string) => ({
    id,
    reporterId,
    targetUserId: U1,
    category: 'harassment' as const,
    gameId,
    messageId: null,
    note: null,
    createdAt: iso(T0 - HOUR_MS),
  });
  const attendance = (method: 'gps' | 'qr', hostId: string | null = null) =>
    [U1, U2, U3, U4].flatMap((userId) =>
      [G1, G2].map((gameId) => ({ gameId, userId, status: 'approved' as const, attendance: 'verified' as const, checkInMethod: method, isHost: userId === hostId })),
    );
  it('three co-players of one game → review only (single_game)', () => {
    const r = evaluateReports([rep('a', U2, G1), rep('b', U3, G1), rep('c', U4, G1)], profiles, T0, undefined, { attendance: attendance('gps') });
    expect(r).toMatchObject({ outcome: 'review_only', reviewReasons: ['single_game'] });
    expect(assertSanctionInvariants(r.effects)).toEqual([]);
  });
  it('QR-only or host-only GPS reporters → review only (no_gps_anchor)', () => {
    const reports = [rep('a', U2, G1), rep('b', U3, G2), rep('c', U4, G1)];
    expect(evaluateReports(reports, profiles, T0, undefined, { attendance: attendance('qr') }).reviewReasons).toEqual(['no_gps_anchor']);
    const onlyHostGps = attendance('qr').map((a) => (a.userId === U2 ? { ...a, checkInMethod: 'gps' as const, isHost: true } : a));
    expect(evaluateReports(reports, profiles, T0, undefined, { attendance: onlyHostGps }).reviewReasons).toEqual(['no_gps_anchor']);
    expect(evaluateReports(reports, profiles, T0, undefined, { attendance: attendance('gps') }).outcome).toBe('restrict');
  });
});

describe('(5) venue reporters must qualify', () => {
  it('three fresh accounts cannot hide a venue', () => {
    const reports = [U2, U3, U4].map((r, i) => ({ id: `v${i}`, venueId: 'v1', reporterId: r, reason: 'no_venue_here' as const, note: null, createdAt: iso(T0 - HOUR_MS) }));
    const venue = { venueId: 'v1', status: 'active' as const, createdBy: HOST, lastReviewedAt: null, reports };
    const fresh = [U2, U3, U4].map((id) => ({ id, createdAt: iso(T0 - 2 * DAY_MS), reliabilityStatus: 'green' as const, reportsLast7d: 0 }));
    expect(evaluateVenueReports(venue, fresh, T0)).toMatchObject({ hide: false, reporterIds: [] });
    const aged = fresh.map((p) => ({ ...p, createdAt: iso(T0 - 30 * DAY_MS) }));
    expect(evaluateVenueReports(venue, aged, T0).hide).toBe(true);
    // Through the engine, the state's reporter profiles are used.
    const s = createTrustState(HOST, { venues: [{ ...venue, reports: reports.slice(0, 2) }], reporterProfiles: fresh });
    expect(applyTrustEvent(s, { type: 'VenueReported', report: reports[2]! }, undefined, T0).effects).toEqual([]);
  });
});

describe('(6) blocklist folds Unicode confusables', () => {
  it('Cyrillic and Greek look-alikes match Latin terms', () => {
    expect(matchBlocklist('you іdіоt', 'en').terms).toEqual(['idiot']); // Cyrillic і, о
    expect(matchBlocklist('ΙDΙΟΤ', 'en').terms).toEqual(['idiot']); // Greek capitals
    expect(matchBlocklist('ѕtuріd', 'fr').terms).toEqual(['stupid']); // Cyrillic ѕ, р, і
    expect(matchBlocklist('mоrоn', 'de').terms).toEqual(['moron']);
    expect(matchBlocklist('lоѕеr!', 'en').terms).toEqual(['loser']);
    expect(matchBlocklist('іdіό†', 'en').matched).toBe(false); // † is not a confusable we fold
    expect(matchBlocklist('іdіότ', 'en').terms).toEqual(['idiot']); // accented Greek omicron + tau
    expect(normalizeForMatch('ВАНЯ')).toBe('bahя');
  });
  it('native Cyrillic/Greek terms still match themselves and harmless text stays clean', () => {
    expect(matchBlocklist('ты идиот', 'ru').terms).toEqual(['идиот']);
    expect(matchBlocklist('ДУРАК', 'ru').terms).toEqual(['дурак']);
    expect(matchBlocklist('привет, отличная игра', 'ru').matched).toBe(false);
    expect(matchBlocklist('καλό παιχνίδι', 'en').matched).toBe(false);
  });
});

describe('(7) host late game cancellation → host card → host reliability', () => {
  const game = { id: G1, hostId: HOST, startsAt: iso(T0) };
  const now = T0 - HOUR_MS;
  it('issues a disputable late_cancel card to the host only for late cancels', () => {
    const r = evaluateHostGameCancellation({ game, cancelledAt: iso(now) }, now);
    expect(r.late).toBe(true);
    const [card] = assertSanctionInvariants(r.effects);
    expect(card).toMatchObject({
      kind: 'yellow_card',
      userId: HOST,
      reasonCode: 'late_cancel',
      gameId: G1,
      dedupeKey: `host_late_cancel:${G1}:${HOST}`,
      disputeUntil: iso(now + 48 * HOUR_MS),
      statementParams: { role: 'host', minutesBeforeStart: 60 },
    });
    expect(evaluateHostGameCancellation({ game, cancelledAt: iso(T0 - 2 * HOUR_MS) }, now)).toEqual({ late: false, effects: [] });
  });

  it('a second late cancellation within 30 days suspends hosting (review queued); idempotent', () => {
    const prior = sanctionRow({ dedupeKey: `host_late_cancel:${G2}:${HOST}`, userId: HOST, reasonCode: 'late_cancel', gameId: G2, startsAt: iso(now - 5 * DAY_MS) });
    const s = createTrustState(HOST, { sanctions: [prior] });
    const r = applyHostGameCancellation(s, { game, cancelledAt: iso(now) }, undefined, now);
    expect(r.effects.map((e) => e.type)).toEqual(['IssueSanction', 'Notify', 'IssueSanction', 'SuspendHost', 'Notify', 'EnqueueReview']);
    const [, suspension] = assertSanctionInvariants(r.effects);
    expect(suspension).toMatchObject({
      kind: 'host_suspension',
      reasonCode: 'late_cancel',
      expiresAt: iso(now + 14 * DAY_MS),
      causedBy: [prior.id, deriveSanctionId(`host_late_cancel:${G1}:${HOST}`)],
    });
    expect(applyHostGameCancellation(r.state, { game, cancelledAt: iso(now) }, undefined, now).effects).toEqual([]);
    expect(applyHostGameCancellation(s, { game, cancelledAt: iso(T0 - 3 * HOUR_MS) }, undefined, now).effects).toEqual([]);
    expect(() => applyHostGameCancellation(createTrustState(U1), { game, cancelledAt: iso(now) }, undefined, now)).toThrow();
  });

  it('overturned or consumed host cards do not count; player late-cancel cards never count', () => {
    const card = (n: string, extra: Partial<Sanction> = {}) =>
      sanctionRow({ dedupeKey: `host_late_cancel:${n}:${HOST}`, userId: HOST, reasonCode: 'late_cancel', gameId: n, startsAt: iso(now - DAY_MS), ...extra });
    const run = (sanctions: Sanction[]) => evaluateHostReliability({ hostId: HOST, ratings: [], confirmedFakeVenueIds: [], sanctions }, now).outcome;
    expect(run([card('a'), card('b')])).toBe('suspend');
    expect(run([card('a'), card('b', { status: 'overturned' })])).toBe('none');
    const playerCard = sanctionRow({ dedupeKey: `late_cancel:x:${HOST}`, userId: HOST, reasonCode: 'late_cancel', startsAt: iso(now - DAY_MS) });
    expect(run([card('a'), playerCard])).toBe('none');
    const consumed = sanctionRow({ dedupeKey: 'hs', userId: HOST, kind: 'host_suspension', reasonCode: 'late_cancel', disputeUntil: null, startsAt: iso(now - 2 * HOUR_MS), expiresAt: iso(now - HOUR_MS), status: 'expired' } as never);
    expect(run([card('a'), card('b'), consumed])).toBe('none');
    expect(isHostLateCancelCard(playerCard)).toBe(false);
  });

  it("the host's card never settles a deposit (Tick after the dispute window, overturn)", () => {
    const hostCard = sanctionRow({ dedupeKey: `host_late_cancel:${G1}:${HOST}`, userId: HOST, reasonCode: 'late_cancel', gameId: G1, startsAt: iso(T0 - 3 * DAY_MS) });
    const tick = applyTrustEvent(createTrustState(HOST, { sanctions: [hostCard] }), { type: 'Tick', at: iso(T0) }, undefined, T0);
    expect(tick.effects.filter((e) => e.type === 'SettleDeposit')).toEqual([]);
  });
});
