/**
 * The PaymentProvider port (ADR 0006). Edge Functions depend on this interface
 * only; Stripe, local PSPs and the in-memory fake implement it.
 *
 * Rules every adapter follows:
 * - Amounts are {@link Money} in ISO minor units; adapters convert to the wire format.
 * - Every mutating call takes an `idempotencyKey`. Repeating a call with the same key
 *   returns the same result and never moves money twice.
 * - Provider state is advisory until the signed webhook confirms it
 *   (`payments-webhook` is the only path that advances `payments.status`).
 * - Adapters never log or return card data; only opaque provider references.
 */
import type { IsoDateTime, Money, PaymentIntentStatus, PaymentProviderId } from '@st/domain';
import type { DepositMode, PaymentMethodType } from './methods';

/** Metadata attached to provider objects, used to correlate webhooks with our rows. */
export interface PaymentMetadata {
  paymentId: string;
  userId: string;
  gameId: string;
  /** Lifecycle step, e.g. `setup`, `hold`, `charge`. */
  step: string;
}

export interface CreateCustomerInput {
  userId: string;
  idempotencyKey: string;
}

export interface CustomerRef {
  customerId: string;
}

export interface SetupInput {
  customerId: string;
  /** Method types the payment sheet may offer (holdable methods only). */
  methodTypes: readonly string[];
  idempotencyKey: string;
  metadata: PaymentMetadata;
}

/** A saved-method setup (Stripe SetupIntent). */
export interface SetupResult {
  ref: string;
  clientSecret: string;
  status: PaymentIntentStatus;
  /** Saved payment method once the setup succeeded. */
  paymentMethodId: string | null;
}

/** A SetupIntent as retrieved later (e.g. by the T−24h hold job). */
export interface SetupInfo {
  ref: string;
  status: PaymentIntentStatus;
  customerId: string | null;
  paymentMethodId: string | null;
}

export interface DepositInput {
  customerId: string;
  amount: Money;
  mode: DepositMode;
  /**
   * `hold`: saved method charged off-session at T−24h (`paymentMethodId` required).
   * `charge_refund`: customer present; `paymentMethodId` is null and the client
   * confirms with `clientSecret` (redirect / QR / app approval).
   */
  paymentMethodId: string | null;
  methodTypes: readonly string[];
  idempotencyKey: string;
  metadata: PaymentMetadata;
  /** Statement descriptor suffix (short game reference). */
  descriptorSuffix?: string;
}

/** A payment intent as the port sees it. */
export interface IntentResult {
  ref: string;
  status: PaymentIntentStatus;
  /** Present when the client must act (3DS, redirect, QR). Never logged. */
  clientSecret: string | null;
  amount: Money;
  /** Captured / charged amount so far. */
  amountReceived: Money;
  /** Provider decline/failure code, if any (e.g. `card_declined`). */
  failureCode: string | null;
}

export interface CaptureInput {
  ref: string;
  /** Partial capture; defaults to the full authorised amount. */
  amount?: Money;
  idempotencyKey: string;
}

export interface ReleaseInput {
  ref: string;
  idempotencyKey: string;
}

export interface RefundInput {
  ref: string;
  amount?: Money;
  idempotencyKey: string;
  reason: 'attended' | 'excused' | 'game_cancelled' | 'overturned' | 'account_deleted' | 'duplicate';
}

export interface RefundResult {
  ref: string;
  /** The payment intent the refund belongs to. */
  intentRef: string;
  status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'requires_action';
  amount: Money;
}

/** Outcome of releasing a deposit: a cancelled hold or a refund of a charge. */
export type ReleaseResult =
  | { kind: 'canceled'; intent: IntentResult }
  | { kind: 'refunded'; intent: IntentResult; refund: RefundResult }
  | { kind: 'noop'; intent: IntentResult };

export interface CheckoutInput {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

/** Normalised webhook event kinds. Unknown provider events map to `ignored`. */
export type PaymentEventType =
  | 'setup_succeeded'
  | 'setup_failed'
  | 'payment_processing'
  | 'payment_requires_action'
  | 'hold_authorized'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'payment_canceled'
  | 'refund_updated'
  | 'dispute_opened'
  | 'ignored';

/** A signature-verified, provider-neutral webhook event. */
export interface PaymentEvent {
  /** Provider event id; the idempotency key of webhook processing. */
  id: string;
  provider: PaymentProviderId;
  type: PaymentEventType;
  /** Raw provider event type (for audit), e.g. `payment_intent.succeeded`. */
  providerType: string;
  /** Payment/Setup intent the event concerns. */
  ref: string | null;
  /** Status of that intent after the event, when known. */
  status: PaymentIntentStatus | null;
  amount: Money | null;
  amountReceived: Money | null;
  amountRefunded: Money | null;
  paymentMethodId: string | null;
  paymentMethodType: PaymentMethodType | string | null;
  failureCode: string | null;
  /** Our correlation metadata, when present on the provider object. */
  metadata: Partial<PaymentMetadata>;
  occurredAt: IsoDateTime;
}

export interface WebhookInput {
  /** Exact raw request body; signatures are computed over bytes, never re-serialised JSON. */
  rawBody: string;
  headers: Headers;
}

/** Thrown by {@link PaymentProvider.parseWebhook} when the signature does not verify. */
export class WebhookSignatureError extends Error {
  override readonly name = 'WebhookSignatureError';
}

/** Thrown when an adapter cannot perform an operation (not implemented / not contracted). */
export class UnsupportedOperationError extends Error {
  override readonly name = 'UnsupportedOperationError';
}

/** The port. */
export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createCustomer(input: CreateCustomerInput): Promise<CustomerRef>;
  /** Saves a reusable payment method (SetupIntent, `usage: off_session`, SCA at setup time). */
  createSetup(input: SetupInput): Promise<SetupResult>;
  /** `hold` → manual-capture authorisation; `charge_refund` → immediate charge flagged refundable. */
  createDepositHold(input: DepositInput): Promise<IntentResult>;
  captureDeposit(input: CaptureInput): Promise<IntentResult>;
  /** Cancels a hold, or refunds a charge-and-refund payment in full. Safe to repeat. */
  releaseDeposit(input: ReleaseInput): Promise<ReleaseResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  retrieveIntent(ref: string): Promise<IntentResult>;
  /** Saved method and customer of a completed setup. */
  retrieveSetup(ref: string): Promise<SetupInfo>;
  /** Detaches every saved method of the customer (account deletion). Returns how many were detached. */
  detachPaymentMethods(customerId: string): Promise<number>;
  /** Pro subscriptions (web) — later phase. */
  createCheckout(input: CheckoutInput): Promise<{ url: string; ref: string }>;
  /** Verifies the signature and normalises the event. Throws {@link WebhookSignatureError}. */
  parseWebhook(input: WebhookInput): Promise<PaymentEvent>;
}
