import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEPOSIT_POLICY,
  decideSettlement,
  depositIdempotencyKey,
  holdFixDeadline,
  isHoldDue,
  planDeposit,
  refundDueBy,
  type SettlementInput,
} from '../src/policy';

const H = 3_600_000;
const START = Date.parse('2026-11-10T18:00:00.000Z');
const END = START + 2 * H;
const iso = (ms: number) => new Date(ms).toISOString();

describe('planDeposit', () => {
  it('no deposit → none', () => {
    expect(planDeposit({ game: { startsAt: iso(START), depositMinor: 0 }, mode: 'hold', approvedAt: null, now: START - 72 * H })).toEqual({ kind: 'none' });
  });
  it('card: setup now, hold at T−24h', () => {
    const p = planDeposit({ game: { startsAt: iso(START), depositMinor: 500 }, mode: 'hold', approvedAt: iso(START - 72 * H), now: START - 72 * H });
    expect(p).toEqual({ kind: 'hold', setupNow: true, holdAt: iso(START - 24 * H), holdImmediately: false });
  });
  it('card approved inside 24h: hold immediately', () => {
    const p = planDeposit({ game: { startsAt: iso(START), depositMinor: 500 }, mode: 'hold', approvedAt: iso(START - 3 * H), now: START - 3 * H });
    expect(p).toMatchObject({ kind: 'hold', holdAt: iso(START - 3 * H), holdImmediately: true });
  });
  it('push methods: charge while the payer is present', () => {
    expect(planDeposit({ game: { startsAt: iso(START), depositMinor: 500 }, mode: 'charge_refund', approvedAt: null, now: START - 72 * H })).toEqual({ kind: 'charge_refund', chargeNow: true });
  });
});

describe('isHoldDue', () => {
  const base = {
    game: { startsAt: iso(START), endsAt: iso(END), status: 'scheduled' as const },
    participantStatus: 'approved' as const,
    deposit: { depositState: 'setup' as const, setupSucceeded: true },
    approvedAt: iso(START - 72 * H),
  };
  it('due from T−24h only', () => {
    expect(isHoldDue({ ...base, now: START - 25 * H })).toBe(false);
    expect(isHoldDue({ ...base, now: START - 24 * H })).toBe(true);
  });
  it('not due without a saved method, for non-approved players, cancelled or ended games', () => {
    expect(isHoldDue({ ...base, deposit: { depositState: 'setup', setupSucceeded: false }, now: START - H })).toBe(false);
    expect(isHoldDue({ ...base, participantStatus: 'waitlisted', now: START - H })).toBe(false);
    expect(isHoldDue({ ...base, game: { ...base.game, status: 'cancelled' }, now: START - H })).toBe(false);
    expect(isHoldDue({ ...base, now: END })).toBe(false);
    expect(isHoldDue({ ...base, deposit: { depositState: 'held', setupSucceeded: true }, now: START - H })).toBe(false);
  });
});

describe('holdFixDeadline (TRUST-064)', () => {
  it('6 hours normally, 1 hour when the game is closer than 6 hours, never after start', () => {
    expect(holdFixDeadline(iso(START - 24 * H), { startsAt: iso(START) })).toBe(iso(START - 18 * H));
    expect(holdFixDeadline(iso(START - 3 * H), { startsAt: iso(START) })).toBe(iso(START - 2 * H));
    expect(holdFixDeadline(iso(START - 0.5 * H), { startsAt: iso(START) })).toBe(iso(START));
  });
});

function input(over: Partial<SettlementInput> & { now: number }): SettlementInput {
  return {
    game: { status: 'scheduled', endsAt: iso(END), depositForfeitTo: 'pot' },
    participant: { status: 'approved', attendance: 'unknown', lateCancel: false },
    card: null,
    deposit: { mode: 'hold', depositState: 'held', securedAt: iso(START - 24 * H) },
    ...over,
  };
}

describe('decideSettlement', () => {
  it('releases on attendance, excuse, in-time cancel and game cancel', () => {
    expect(decideSettlement(input({ now: END, participant: { status: 'approved', attendance: 'verified', lateCancel: false } }))).toEqual({ action: 'release', reason: 'attended' });
    expect(decideSettlement(input({ now: END, participant: { status: 'approved', attendance: 'excused', lateCancel: false } }))).toMatchObject({ action: 'release', reason: 'excused' });
    expect(decideSettlement(input({ now: END, participant: { status: 'cancelled', attendance: 'unknown', lateCancel: false } }))).toMatchObject({ action: 'release', reason: 'cancelled_in_time' });
    expect(decideSettlement(input({ now: END, game: { status: 'cancelled', endsAt: iso(END), depositForfeitTo: 'pot' } }))).toMatchObject({ action: 'release', reason: 'game_cancelled' });
    expect(decideSettlement(input({ now: END, participant: { status: 'removed', attendance: 'unknown', lateCancel: false } }))).toMatchObject({ action: 'release', reason: 'not_playing' });
  });

  it('waits for the game to end and for attendance to be finalised', () => {
    expect(decideSettlement(input({ now: START }))).toEqual({ action: 'wait', reason: 'awaiting_game_end', recheckAt: iso(END) });
    expect(decideSettlement(input({ now: END + H }))).toMatchObject({ action: 'wait', reason: 'awaiting_attendance' });
  });

  const noShow = { status: 'approved' as const, attendance: 'no_show_unverified' as const, lateCancel: false };
  it('no-show: waits for the 48h dispute window, then forfeits (capture at dispute_until)', () => {
    const card = { status: 'active' as const, disputeUntil: iso(END + 48 * H) };
    expect(decideSettlement(input({ now: END + H, participant: noShow, card }))).toEqual({ action: 'wait', reason: 'awaiting_dispute_window', recheckAt: iso(END + 48 * H) });
    expect(decideSettlement(input({ now: END + 48 * H, participant: noShow, card }))).toEqual({
      action: 'forfeit', reason: 'dispute_window_closed', forfeitTo: 'pot', payoutDeferred: false, refundOnOverturn: false,
    });
  });

  it('no-show without a card yet waits; overturned releases; upheld forfeits to host (payout deferred)', () => {
    expect(decideSettlement(input({ now: END + H, participant: noShow }))).toMatchObject({ action: 'wait', reason: 'awaiting_card' });
    expect(decideSettlement(input({ now: END + H, participant: noShow, card: { status: 'overturned', disputeUntil: null } }))).toMatchObject({ action: 'release', reason: 'card_overturned' });
    expect(
      decideSettlement(input({ now: END + H, participant: noShow, card: { status: 'upheld', disputeUntil: null }, game: { status: 'completed', endsAt: iso(END), depositForfeitTo: 'host' } })),
    ).toMatchObject({ action: 'forfeit', reason: 'card_upheld', forfeitTo: 'host', payoutDeferred: true });
  });

  it('disputed: waits, then follows the hold-expiry rule (release by default, capture if configured)', () => {
    const card = { status: 'disputed' as const, disputeUntil: iso(END + 48 * H) };
    const actBy = START - 24 * H + (7 * 24 - 12) * H;
    expect(decideSettlement(input({ now: END + 50 * H, participant: noShow, card }))).toEqual({ action: 'wait', reason: 'awaiting_dispute_decision', recheckAt: iso(actBy) });
    expect(decideSettlement(input({ now: actBy, participant: noShow, card }))).toMatchObject({ action: 'release', reason: 'dispute_open_at_hold_expiry' });
    expect(
      decideSettlement(input({ now: actBy, participant: noShow, card, options: { ...DEFAULT_DEPOSIT_POLICY, onDisputeAtHoldExpiry: 'capture' } })),
    ).toMatchObject({ action: 'forfeit', refundOnOverturn: true });
  });

  it('charge-and-refund with a dispute waits for the decision (money already held)', () => {
    const card = { status: 'disputed' as const, disputeUntil: iso(END + 48 * H) };
    expect(
      decideSettlement(input({ now: END + 30 * 24 * H, participant: noShow, card, deposit: { mode: 'charge_refund', depositState: 'held', securedAt: iso(START - 72 * H) } })),
    ).toMatchObject({ action: 'wait', reason: 'awaiting_dispute_decision', recheckAt: null });
  });

  it('late cancel: forfeits like a no-show unless the spot was refilled', () => {
    const late = { status: 'cancelled' as const, attendance: 'unknown' as const, lateCancel: true };
    const card = { status: 'active' as const, disputeUntil: iso(START) };
    expect(decideSettlement(input({ now: START + H, participant: late, card }))).toMatchObject({ action: 'forfeit' });
    expect(decideSettlement(input({ now: START + H, participant: { ...late, spotRefilled: true }, card }))).toMatchObject({ action: 'release', reason: 'late_cancel_refilled' });
  });

  it('settled or never-secured deposits need nothing', () => {
    for (const depositState of ['released', 'forfeited', 'failed'] as const) {
      expect(decideSettlement(input({ now: END, deposit: { mode: 'hold', depositState, securedAt: null } }))).toEqual({ action: 'none', reason: 'already_settled' });
    }
    expect(decideSettlement(input({ now: END + 49 * H, participant: noShow, card: { status: 'active', disputeUntil: iso(END + 48 * H) }, deposit: { mode: 'hold', depositState: 'setup', securedAt: null } }))).toEqual({ action: 'none', reason: 'nothing_secured' });
    expect(decideSettlement(input({ now: END, participant: { status: 'approved', attendance: 'verified', lateCancel: false }, deposit: { mode: 'hold', depositState: 'setup', securedAt: null } }))).toEqual({ action: 'release', reason: 'attended' });
  });
});

describe('keys and deadlines', () => {
  it('idempotency keys are deterministic per participant and step', () => {
    expect(depositIdempotencyKey('g1', 'u1', 'capture')).toBe('deposit:g1:u1:capture');
    expect(depositIdempotencyKey('g1', 'u1', 'hold', 2)).toBe('deposit:g1:u1:hold:2');
  });
  it('charge-and-refund refunds are due within an hour of check-in', () => {
    expect(refundDueBy(iso(START))).toBe(iso(START + H));
  });
});
