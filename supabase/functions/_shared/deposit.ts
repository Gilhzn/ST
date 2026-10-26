/** Shared types for the deposit functions (create-deposit, payments-hold/settle, payments-webhook, delete-account). */
import type {
  AttendanceStatus,
  Effect,
  DepositForfeitTarget,
  DepositState,
  GameId,
  GameStatus,
  IsoDateTime,
  PaymentId,
  PaymentIntentStatus,
  PaymentProviderId,
  ParticipantStatus,
  SanctionStatus,
  UserId,
} from '@st/domain';
import { currencyExponent, type PaymentProvider } from '@st/payments';

/** A `payments` row (deposit). */
export interface PaymentRow {
  id: PaymentId;
  userId: UserId;
  gameId: GameId;
  amountMinor: number;
  currency: string;
  provider: PaymentProviderId;
  providerRef: string | null;
  status: PaymentIntentStatus;
  depositState: DepositState;
  step: 'setup' | 'hold' | 'charge';
  paymentMethodId: string | null;
  securedAt: IsoDateTime | null;
  settlementRequested: 'release' | 'forfeit' | null;
  holdRequestedAt: IsoDateTime | null;
  idempotencyKey: string;
  createdAt: IsoDateTime;
}

/** Game fields the deposit flows read. */
export interface DepositGame {
  id: GameId;
  title: string;
  hostId: UserId;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  status: GameStatus;
  depositMinor: number;
  currency: string;
  depositForfeitTo: DepositForfeitTarget;
}

export interface DepositParticipant {
  status: ParticipantStatus;
  attendance: AttendanceStatus;
  lateCancel: boolean;
  lateCancelRefilled: boolean;
  decidedAt: IsoDateTime | null;
  requestedAt: IsoDateTime;
}

/** The no-show / late-cancel card of this participation, if any. */
export interface DepositCardRow {
  status: SanctionStatus;
  disputeUntil: IsoDateTime | null;
}

/** Adapters by provider id; a missing entry means the provider is not configured in this deployment. */
export type ProviderRegistry = Readonly<Partial<Record<PaymentProviderId, PaymentProvider>>>;

export function providerFor(registry: ProviderRegistry, id: PaymentProviderId): PaymentProvider | null {
  return registry[id] ?? null;
}

/** Locale-neutral amount for notification params, e.g. `EUR 5.00` (push copy is ICU, not currency-aware). */
export function formatAmountParam(amountMinor: number, currency: string): string {
  const exp = currencyExponent(currency);
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: exp, maximumFractionDigits: exp }).format(amountMinor / 10 ** exp).replace(/[\u00A0\u202F]/g, ' ');
  } catch {
    return `${currency} ${(amountMinor / 10 ** exp).toFixed(exp)}`;
  }
}

/** `deposit_action_required` notification (TRUST-064). */
export function depositActionNotice(row: Pick<PaymentRow, 'userId' | 'gameId' | 'amountMinor' | 'currency'>, gameTitle: string): Effect {
  return {
    type: 'Notify',
    userId: row.userId,
    kind: 'deposit_action_required',
    params: { gameTitle, amount: formatAmountParam(row.amountMinor, row.currency) },
    gameId: row.gameId,
    sanctionDedupeKey: null,
  };
}
