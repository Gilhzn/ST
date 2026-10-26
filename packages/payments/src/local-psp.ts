/**
 * Local PSP adapter skeleton (MON-002): e.g. PayPlus or Grow/Meshulam for
 * Israeli cards and Bit, Razorpay for UPI. The PSP contract is not signed yet,
 * so this is the seam only: a narrow client interface the concrete integration
 * will implement, and an adapter that maps it onto the PaymentProvider port.
 *
 * Bit (and UPI) cannot hold, so deposits through a local PSP use
 * charge-and-refund. Israeli card holds through the PSP are expected to work
 * like Stripe manual capture ("J5" pre-authorisation) and are routed here by
 * `routeFor()`; until the client implements `authorize`, holds are unsupported.
 */
import type { Money, PaymentIntentStatus, PaymentProviderId } from '@st/domain';
import {
  UnsupportedOperationError,
  type CaptureInput,
  type CheckoutInput,
  type CreateCustomerInput,
  type CustomerRef,
  type DepositInput,
  type IntentResult,
  type PaymentEvent,
  type PaymentProvider,
  type RefundInput,
  type RefundResult,
  type ReleaseInput,
  type ReleaseResult,
  type SetupInput,
  type SetupResult,
  type WebhookInput,
} from './port';

/** What a concrete local PSP integration must provide. */
export interface LocalPspClient {
  /** Creates a hosted payment page / app approval request; the payer completes it in the PSP UI. */
  createPayment(input: {
    amount: Money;
    method: 'bit' | 'upi' | 'card';
    reference: string;
    idempotencyKey: string;
  }): Promise<{ ref: string; status: PaymentIntentStatus; redirectUrl: string }>;
  /** Card pre-authorisation (optional; not every PSP offers it). */
  authorize?(input: { amount: Money; token: string; reference: string; idempotencyKey: string }): Promise<{ ref: string; status: PaymentIntentStatus }>;
  capture?(input: { ref: string; amount?: Money; idempotencyKey: string }): Promise<{ status: PaymentIntentStatus }>;
  voidAuthorization?(input: { ref: string; idempotencyKey: string }): Promise<{ status: PaymentIntentStatus }>;
  refund(input: { ref: string; amount?: Money; idempotencyKey: string }): Promise<{ refundRef: string; status: RefundResult['status']; amount: Money }>;
  getPayment(ref: string): Promise<{ ref: string; status: PaymentIntentStatus; amount: Money; amountReceived: Money }>;
  /** Verifies the PSP callback signature and returns a normalised event (throws WebhookSignatureError). */
  verifyCallback(input: WebhookInput): Promise<PaymentEvent>;
}

export class LocalPspProvider implements PaymentProvider {
  readonly id: PaymentProviderId;
  readonly #client: LocalPspClient;

  constructor(options: { id: Extract<PaymentProviderId, 'payplus'>; client: LocalPspClient }) {
    this.id = options.id;
    this.#client = options.client;
  }

  createCustomer(input: CreateCustomerInput): Promise<CustomerRef> {
    // Local PSPs key saved tokens by our own reference; no customer object is needed.
    return Promise.resolve({ customerId: `local:${input.userId}` });
  }

  createSetup(_input: SetupInput): Promise<SetupResult> {
    return Promise.reject(new UnsupportedOperationError('card tokenisation through the local PSP is not integrated yet'));
  }

  async createDepositHold(input: DepositInput): Promise<IntentResult> {
    if (input.mode === 'hold') {
      if (!this.#client.authorize || !input.paymentMethodId) {
        throw new UnsupportedOperationError('holds are not supported by this local PSP integration');
      }
      const r = await this.#client.authorize({ amount: input.amount, token: input.paymentMethodId, reference: input.metadata.paymentId, idempotencyKey: input.idempotencyKey });
      return { ref: r.ref, status: r.status, clientSecret: null, amount: input.amount, amountReceived: { amountMinor: 0, currency: input.amount.currency }, failureCode: null };
    }
    const method = input.methodTypes.includes('upi') ? 'upi' : 'bit';
    const r = await this.#client.createPayment({ amount: input.amount, method, reference: input.metadata.paymentId, idempotencyKey: input.idempotencyKey });
    // The redirect URL plays the role of Stripe's client secret for the app.
    return { ref: r.ref, status: r.status, clientSecret: r.redirectUrl, amount: input.amount, amountReceived: { amountMinor: 0, currency: input.amount.currency }, failureCode: null };
  }

  async captureDeposit(input: CaptureInput): Promise<IntentResult> {
    if (!this.#client.capture) throw new UnsupportedOperationError('capture not supported');
    await this.#client.capture(input);
    return this.retrieveIntent(input.ref);
  }

  async releaseDeposit(input: ReleaseInput): Promise<ReleaseResult> {
    const current = await this.retrieveIntent(input.ref);
    if (current.status === 'canceled' || current.status === 'failed') return { kind: 'noop', intent: current };
    if (current.status === 'succeeded') {
      const refund = await this.refund({ ref: input.ref, idempotencyKey: `${input.idempotencyKey}:refund`, reason: 'attended' });
      return { kind: 'refunded', intent: current, refund };
    }
    if (!this.#client.voidAuthorization) throw new UnsupportedOperationError('void not supported');
    await this.#client.voidAuthorization({ ref: input.ref, idempotencyKey: `${input.idempotencyKey}:cancel` });
    return { kind: 'canceled', intent: await this.retrieveIntent(input.ref) };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const r = await this.#client.refund({ ref: input.ref, amount: input.amount, idempotencyKey: input.idempotencyKey });
    return { ref: r.refundRef, intentRef: input.ref, status: r.status, amount: r.amount };
  }

  async retrieveIntent(ref: string): Promise<IntentResult> {
    const p = await this.#client.getPayment(ref);
    return { ref: p.ref, status: p.status, clientSecret: null, amount: p.amount, amountReceived: p.amountReceived, failureCode: null };
  }

  detachPaymentMethods(_customerId: string): Promise<number> {
    return Promise.resolve(0); // tokens are deleted at the PSP by the integration when implemented
  }

  createCheckout(_input: CheckoutInput): Promise<{ url: string; ref: string }> {
    return Promise.reject(new UnsupportedOperationError('subscriptions are not sold through local PSPs'));
  }

  parseWebhook(input: WebhookInput): Promise<PaymentEvent> {
    return this.#client.verifyCallback(input);
  }
}
