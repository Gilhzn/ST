/**
 * Pure state transitions driven by verified webhook events.
 *
 * Webhooks arrive at least once and in any order (e.g. `payment_intent.succeeded`
 * before `amount_capturable_updated`). Transitions are therefore monotonic: a
 * later-ranked status is never overwritten by an earlier one, and terminal
 * states only move along the few edges money can actually take.
 */
import type { DepositState, PaymentIntentStatus } from '@st/domain';
import type { PaymentEvent } from './port';

const RANK: Readonly<Record<PaymentIntentStatus, number>> = {
  requires_payment_method: 0,
  requires_confirmation: 1,
  requires_action: 2,
  processing: 3,
  failed: 3,
  requires_capture: 4,
  succeeded: 5,
  canceled: 5,
};

/** Monotonic merge of an incoming intent status into the stored one. */
export function advanceStatus(current: PaymentIntentStatus, incoming: PaymentIntentStatus): PaymentIntentStatus {
  if (current === incoming) return current;
  if (current === 'succeeded' || current === 'canceled') return current; // terminal
  // A failed attempt may be retried (back to requires_payment_method / action) or succeed later.
  if (current === 'failed') return incoming === 'requires_payment_method' || RANK[incoming] >= RANK.processing ? incoming : current;
  return RANK[incoming] >= RANK[current] ? incoming : current;
}

/** What the stored row knows about itself. */
export interface PaymentRowState {
  status: PaymentIntentStatus;
  depositState: DepositState;
  /** `setup` rows track a SetupIntent; `hold` and `charge` rows track a PaymentIntent. */
  step: 'setup' | 'hold' | 'charge';
}

export interface PaymentTransition extends PaymentRowState {
  changed: boolean;
  /** Side notes for the caller (audit, notifications). */
  notes: readonly ('hold_failed' | 'captured' | 'refunded' | 'dispute_opened' | 'setup_ready')[];
}

const TERMINAL_DEPOSIT: readonly DepositState[] = ['released', 'forfeited'];

/**
 * Applies one verified event to a payment row. Pure and idempotent: applying
 * the same event twice yields `changed: false` the second time.
 */
export function applyPaymentEvent(row: PaymentRowState, event: PaymentEvent): PaymentTransition {
  let status = row.status;
  let depositState = row.depositState;
  const notes: PaymentTransition['notes'][number][] = [];
  const terminal = TERMINAL_DEPOSIT.includes(depositState);

  switch (event.type) {
    case 'setup_succeeded':
      if (row.step === 'setup') {
        status = advanceStatus(status, 'succeeded');
        if (status !== row.status) notes.push('setup_ready');
      }
      break;
    case 'setup_failed':
      if (row.step === 'setup') status = advanceStatus(status, 'failed');
      break;
    case 'payment_processing':
      status = advanceStatus(status, 'processing');
      break;
    case 'payment_requires_action':
      status = advanceStatus(status, 'requires_action');
      break;
    case 'hold_authorized':
      status = advanceStatus(status, 'requires_capture');
      if (!terminal && status === 'requires_capture') depositState = 'held';
      break;
    case 'payment_succeeded':
      status = advanceStatus(status, 'succeeded');
      if (row.step === 'hold') {
        // A manual-capture intent only succeeds when we capture it: the deposit is forfeited.
        if (depositState !== 'released') {
          if (depositState !== 'forfeited') notes.push('captured');
          depositState = 'forfeited';
        }
      } else if (row.step === 'charge' && !terminal) {
        depositState = 'held'; // charged now, refundable on attendance
      }
      break;
    case 'payment_failed':
      status = advanceStatus(status, 'failed');
      if (!terminal && status === 'failed' && depositState !== 'held') {
        depositState = 'failed';
        notes.push('hold_failed');
      }
      break;
    case 'payment_canceled':
      status = advanceStatus(status, 'canceled');
      if (status === 'canceled' && depositState !== 'forfeited') depositState = 'released';
      break;
    case 'refund_updated': {
      const received = event.amountReceived?.amountMinor ?? 0;
      const refunded = event.amountRefunded?.amountMinor ?? 0;
      if (refunded > 0 && refunded >= received && depositState !== 'released') {
        depositState = 'released'; // full refund: attendance, cancel, or overturn after capture
        notes.push('refunded');
      }
      break;
    }
    case 'dispute_opened':
      notes.push('dispute_opened');
      break;
    case 'ignored':
      break;
  }
  return { step: row.step, status, depositState, changed: status !== row.status || depositState !== row.depositState, notes };
}

/** Provider object a ref points at (SetupIntent vs PaymentIntent), for events without our metadata. */
export function stepOfRef(ref: string | null, mode: 'hold' | 'charge_refund'): PaymentRowState['step'] {
  if (mode === 'charge_refund') return 'charge';
  return ref === null || /^seti_/.test(ref) ? 'setup' : 'hold';
}

export interface ReconciledRow {
  /** Row state to apply the event to. */
  base: PaymentRowState;
  /** The row should start tracking `event.ref` (the hold replaced the setup). */
  adoptRef: boolean;
  /** The event concerns an object the row no longer tracks: apply nothing. */
  stale: boolean;
}

/**
 * One deposit row tracks its SetupIntent first and then the hold PaymentIntent
 * (`payments.step` setup → hold). A hold event may arrive before the hold job
 * stored the new ref (webhooks race the API response), so a hold event for a
 * setup row adopts its ref with a fresh status; late events of the superseded
 * setup are stale.
 */
export function reconcileEventRow(
  row: { providerRef: string | null; status: PaymentIntentStatus; depositState: DepositState; step: PaymentRowState['step'] },
  event: PaymentEvent,
): ReconciledRow {
  const mode = row.step === 'charge' ? 'charge_refund' : 'hold';
  const meta = event.metadata.step;
  const eventStep: PaymentRowState['step'] = meta === 'setup' || meta === 'hold' || meta === 'charge' ? meta : stepOfRef(event.ref, mode);
  const base: PaymentRowState = { status: row.status, depositState: row.depositState, step: row.step };
  if (event.ref === null || event.ref === row.providerRef) return { base, adoptRef: false, stale: false };
  if (row.step === 'setup' && eventStep === 'hold') {
    return { base: { status: 'requires_payment_method', depositState: row.depositState, step: 'hold' }, adoptRef: true, stale: false };
  }
  if (row.providerRef === null && eventStep === row.step) return { base, adoptRef: true, stale: false };
  return { base, adoptRef: false, stale: true };
}
