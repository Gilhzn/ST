/**
 * DepositPolicy: pure decisions about when to secure, release or forfeit a
 * no-show deposit (PRD v5 TRUST-060…067, MON-011/012). No I/O, no clock:
 * every function takes `now`.
 *
 * Lifecycle (hold-capable methods: cards, Apple Pay, Google Pay, Link):
 *   join/approval → SetupIntent (method saved, SCA done)
 *   max(startsAt − depositHoldLeadHours, approval) → manual-capture hold, off-session
 *   attended / excused / cancelled in time / game cancelled → cancel the hold
 *   no-show or unfilled late cancel → capture once the card's dispute window closes
 *   (TRUST-061: capture at `dispute_until`, so a successful dispute needs no refund)
 *
 * Push methods (iDEAL, Pix, UPI, Bit, BLIK, …) cannot hold and cannot be charged
 * off-session, so they are charged while the payer is present (at join or
 * approval) and refunded on the same release rules ("charge-and-refund").
 */
import {
  DEFAULT_TRUST_CONFIG,
  type AttendanceStatus,
  type DepositForfeitTarget,
  type DepositState,
  type GameId,
  type GameStatus,
  type IsoDateTime,
  type ParticipantStatus,
  type SanctionStatus,
  type TrustConfig,
  type UserId,
} from '@st/domain';
import type { DepositMode } from './methods';

const HOUR_MS = 3_600_000;

/** Tunables not (yet) in `trust_config`. */
export interface DepositPolicyOptions {
  /** Card authorisations lapse after about 7 days. */
  holdLifetimeHours: number;
  /** Act this long before the authorisation would lapse. */
  holdSafetyMarginHours: number;
  /** TRUST-064: time to fix a declined hold before the spot goes to the waitlist. */
  holdFixWindowHours: number;
  /** TRUST-064: shortened fix window when the game is closer than `holdFixWindowHours`. */
  holdFixWindowShortHours: number;
  /**
   * A dispute still open when the hold is about to lapse. PRD TRUST-061 edge case:
   * "fairness by default" lets the hold lapse (`release`). Architecture §6
   * alternative: capture now and refund on overturn (`capture`).
   */
  onDisputeAtHoldExpiry: 'release' | 'capture';
}

export const DEFAULT_DEPOSIT_POLICY: Readonly<DepositPolicyOptions> = Object.freeze({
  holdLifetimeHours: 7 * 24,
  holdSafetyMarginHours: 12,
  holdFixWindowHours: 6,
  holdFixWindowShortHours: 1,
  onDisputeAtHoldExpiry: 'release',
});

const iso = (ms: number): IsoDateTime => new Date(ms).toISOString();
const ms = (t: IsoDateTime): number => {
  const v = Date.parse(t);
  if (Number.isNaN(v)) throw new RangeError(`invalid ISO timestamp: ${t}`);
  return v;
};

/** Deterministic idempotency key per participant and step (PRD AC-TRUST-061b). */
export function depositIdempotencyKey(
  gameId: GameId,
  userId: UserId,
  step: 'customer' | 'setup' | 'hold' | 'charge' | 'capture' | 'release' | 'refund',
  attempt = 0,
): string {
  return attempt > 0 ? `deposit:${gameId}:${userId}:${step}:${attempt}` : `deposit:${gameId}:${userId}:${step}`;
}

export interface DepositPlanInput {
  game: { startsAt: IsoDateTime; depositMinor: number };
  mode: DepositMode;
  /** When the host approved the player (or the request time for auto-approve games). */
  approvedAt: IsoDateTime | null;
  now: number;
  config?: TrustConfig;
}

export type DepositPlan =
  | { kind: 'none' }
  | {
      kind: 'hold';
      /** Save a method now (SetupIntent). */
      setupNow: true;
      /** When the off-session hold should be placed. */
      holdAt: IsoDateTime;
      /** True when `holdAt` has already passed (late approval): place the hold right after setup. */
      holdImmediately: boolean;
    }
  | { kind: 'charge_refund'; chargeNow: true };

/** What to do when a player joins a game that requires a deposit. */
export function planDeposit(input: DepositPlanInput): DepositPlan {
  if (input.game.depositMinor <= 0) return { kind: 'none' };
  if (input.mode === 'charge_refund') return { kind: 'charge_refund', chargeNow: true };
  const config = input.config ?? DEFAULT_TRUST_CONFIG;
  const lead = ms(input.game.startsAt) - config.depositHoldLeadHours * HOUR_MS;
  const approved = input.approvedAt ? ms(input.approvedAt) : Number.NEGATIVE_INFINITY;
  const holdAtMs = Math.max(lead, approved);
  return { kind: 'hold', setupNow: true, holdAt: iso(holdAtMs), holdImmediately: holdAtMs <= input.now };
}

export interface HoldDueInput {
  game: { startsAt: IsoDateTime; endsAt: IsoDateTime; status: GameStatus };
  participantStatus: ParticipantStatus;
  /** The setup row: method saved and not yet held. */
  deposit: { depositState: DepositState; setupSucceeded: boolean };
  approvedAt: IsoDateTime | null;
  now: number;
  config?: TrustConfig;
}

/** True when the `place_deposit_holds` job should place the off-session hold now. */
export function isHoldDue(input: HoldDueInput): boolean {
  if (input.game.status !== 'scheduled' || input.participantStatus !== 'approved') return false;
  if (input.deposit.depositState !== 'setup' || !input.deposit.setupSucceeded) return false;
  if (input.now >= ms(input.game.endsAt)) return false;
  const config = input.config ?? DEFAULT_TRUST_CONFIG;
  const lead = ms(input.game.startsAt) - config.depositHoldLeadHours * HOUR_MS;
  const approved = input.approvedAt ? ms(input.approvedAt) : Number.NEGATIVE_INFINITY;
  return input.now >= Math.max(lead, approved);
}

/** TRUST-064: deadline to fix a declined hold before the spot moves to the waitlist. */
export function holdFixDeadline(
  failedAt: IsoDateTime,
  game: { startsAt: IsoDateTime },
  options: DepositPolicyOptions = DEFAULT_DEPOSIT_POLICY,
): IsoDateTime {
  const failed = ms(failedAt);
  const toStart = ms(game.startsAt) - failed;
  const window = toStart < options.holdFixWindowHours * HOUR_MS ? options.holdFixWindowShortHours : options.holdFixWindowHours;
  return iso(Math.min(failed + window * HOUR_MS, Math.max(failed, ms(game.startsAt))));
}

/** The yellow card caused by this participation (no-show or late cancel), as stored. */
export interface DepositCard {
  status: SanctionStatus;
  disputeUntil: IsoDateTime | null;
}

export interface SettlementInput {
  game: { status: GameStatus; endsAt: IsoDateTime; depositForfeitTo: DepositForfeitTarget };
  participant: {
    status: ParticipantStatus;
    attendance: AttendanceStatus;
    lateCancel: boolean;
    /** Late cancel whose spot was taken by the waitlist (not a loss for the host). */
    spotRefilled?: boolean;
  };
  card: DepositCard | null;
  deposit: {
    mode: DepositMode;
    depositState: DepositState;
    /** When the hold was authorised / the charge succeeded. */
    securedAt: IsoDateTime | null;
  };
  now: number;
  options?: DepositPolicyOptions;
}

export type SettlementReason =
  | 'already_settled'
  /** No-show whose deposit was never secured (hold never placed): nothing to take. */
  | 'nothing_secured'
  | 'game_cancelled'
  | 'not_playing'
  | 'cancelled_in_time'
  | 'late_cancel_refilled'
  | 'attended'
  | 'excused'
  | 'card_overturned'
  | 'card_upheld'
  | 'dispute_window_closed'
  | 'awaiting_game_end'
  | 'awaiting_attendance'
  | 'awaiting_card'
  | 'awaiting_dispute_window'
  | 'awaiting_dispute_decision'
  | 'dispute_open_at_hold_expiry';

export type SettlementDecision =
  | { action: 'none'; reason: SettlementReason }
  | { action: 'wait'; reason: SettlementReason; recheckAt: IsoDateTime | null }
  | { action: 'release'; reason: SettlementReason }
  | {
      action: 'forfeit';
      reason: SettlementReason;
      forfeitTo: DepositForfeitTarget;
      /** Host payouts need Stripe Connect (deferred): MVP funds stay in the platform pot (TRUST-063). */
      payoutDeferred: boolean;
      /** Captured while a dispute is open; refund if it is overturned. */
      refundOnOverturn: boolean;
    };

/** Decides what to do with one deposit. Pure; safe to evaluate repeatedly. */
export function decideSettlement(input: SettlementInput): SettlementDecision {
  const opts = input.options ?? DEFAULT_DEPOSIT_POLICY;
  const { game, participant, card, deposit, now } = input;

  if (deposit.depositState === 'released' || deposit.depositState === 'forfeited' || deposit.depositState === 'failed') {
    return { action: 'none', reason: 'already_settled' };
  }
  // `setup` rows hold no money: "release" then only closes the record (no provider call).
  const secured = deposit.depositState === 'held';
  const release = (reason: SettlementReason): SettlementDecision => ({ action: 'release', reason });

  if (game.status === 'cancelled') return release('game_cancelled');

  if (participant.status === 'cancelled') {
    if (!participant.lateCancel) return release('cancelled_in_time');
    if (participant.spotRefilled === true) return release('late_cancel_refilled');
  } else if (participant.status !== 'approved') {
    return release('not_playing');
  }

  if (participant.attendance === 'verified') return release('attended');
  if (participant.attendance === 'excused') return release('excused');

  const isNoShowPath = participant.attendance === 'no_show_unverified' || participant.status === 'cancelled';
  if (!isNoShowPath) {
    return now < ms(game.endsAt)
      ? { action: 'wait', reason: 'awaiting_game_end', recheckAt: game.endsAt }
      : { action: 'wait', reason: 'awaiting_attendance', recheckAt: null };
  }
  if (!secured) return { action: 'none', reason: 'nothing_secured' };

  const forfeit = (reason: SettlementReason, refundOnOverturn = false): SettlementDecision => ({
    action: 'forfeit',
    reason,
    forfeitTo: game.depositForfeitTo,
    payoutDeferred: game.depositForfeitTo === 'host',
    refundOnOverturn,
  });

  if (!card) return { action: 'wait', reason: 'awaiting_card', recheckAt: null };
  switch (card.status) {
    case 'overturned':
      return release('card_overturned');
    case 'upheld':
      return forfeit('card_upheld');
    case 'expired':
      return forfeit('dispute_window_closed');
    case 'active': {
      const until = card.disputeUntil ? ms(card.disputeUntil) : now;
      return now >= until ? forfeit('dispute_window_closed') : { action: 'wait', reason: 'awaiting_dispute_window', recheckAt: iso(until) };
    }
    case 'disputed': {
      if (deposit.mode === 'charge_refund' || !deposit.securedAt) {
        return { action: 'wait', reason: 'awaiting_dispute_decision', recheckAt: null };
      }
      const actBy = ms(deposit.securedAt) + (opts.holdLifetimeHours - opts.holdSafetyMarginHours) * HOUR_MS;
      if (now < actBy) return { action: 'wait', reason: 'awaiting_dispute_decision', recheckAt: iso(actBy) };
      return opts.onDisputeAtHoldExpiry === 'capture'
        ? forfeit('dispute_open_at_hold_expiry', true)
        : release('dispute_open_at_hold_expiry');
    }
  }
}

/** Latest time a charge-and-refund deposit should be refunded after attendance (TRUST-062: within 1 hour). */
export function refundDueBy(checkedInAt: IsoDateTime): IsoDateTime {
  return iso(ms(checkedInAt) + HOUR_MS);
}

export type DepositStep = 'customer' | 'setup' | 'hold' | 'charge' | 'capture' | 'release' | 'refund';

/** Parses a key built by {@link depositIdempotencyKey}; `null` for foreign keys. */
export function parseDepositKey(key: string): { gameId: GameId; userId: UserId; step: DepositStep; attempt: number } | null {
  const m = /^deposit:([^:]+):([^:]+):(customer|setup|hold|charge|capture|release|refund)(?::(\d{1,3}))?$/.exec(key);
  if (!m) return null;
  return { gameId: m[1] as string, userId: m[2] as string, step: m[3] as DepositStep, attempt: m[4] ? Number(m[4]) : 0 };
}

/** Mode of a payment row: rows created as charges are charge-and-refund, setup rows lead to holds. */
export function modeOfPaymentKey(key: string): DepositMode {
  return parseDepositKey(key)?.step === 'charge' ? 'charge_refund' : 'hold';
}
