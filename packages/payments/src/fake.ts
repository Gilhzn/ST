/**
 * FakeProvider: deterministic, in-memory PaymentProvider for unit tests, the
 * mock data adapter and e2e. Mirrors Stripe semantics closely enough that the
 * Edge Function flows (setup → hold → capture/release, webhooks, idempotency)
 * behave the same against it.
 *
 * Determinism: ids are sequential (`pi_fake_0001`), time comes from the
 * injected clock, and failures are opt-in (`pm_card_declined`, `failNext`).
 */
import { StError, type Money, type PaymentIntentStatus } from '@st/domain';
import { hmacSha256Hex, timingSafeEqual } from './hmac';
import {
  UnsupportedOperationError,
  WebhookSignatureError,
  type CaptureInput,
  type CheckoutInput,
  type CreateCustomerInput,
  type CustomerRef,
  type DepositInput,
  type IntentResult,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentMetadata,
  type PaymentProvider,
  type RefundInput,
  type RefundResult,
  type ReleaseInput,
  type ReleaseResult,
  type SetupInput,
  type SetupResult,
  type WebhookInput,
} from './port';

/** Saved payment method that always declines off-session. */
export const FAKE_DECLINED_PM = 'pm_card_declined';
/** Saved payment method that succeeds. */
export const FAKE_OK_PM = 'pm_card_visa';
/** Webhook signature header used by the fake. */
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

export interface FakeProviderOptions {
  webhookSecret?: string;
  now?: () => number;
  toleranceSeconds?: number;
}

interface FakeIntent {
  ref: string;
  customerId: string;
  status: PaymentIntentStatus;
  amount: Money;
  received: number;
  refunded: number;
  manual: boolean;
  failureCode: string | null;
  metadata: PaymentMetadata;
}

interface FakeSetup {
  ref: string;
  customerId: string;
  status: PaymentIntentStatus;
  paymentMethodId: string | null;
  metadata: PaymentMetadata;
}

type Operation =
  | 'createCustomer'
  | 'createSetup'
  | 'createDepositHold'
  | 'captureDeposit'
  | 'releaseDeposit'
  | 'refund';

export class FakeProvider implements PaymentProvider {
  readonly id = 'fake' as const;
  readonly customers = new Map<string, { userId: string; paymentMethods: Set<string> }>();
  readonly setups = new Map<string, FakeSetup>();
  readonly intents = new Map<string, FakeIntent>();
  /** Every mutating call, in order (for assertions). */
  readonly calls: { op: Operation; idempotencyKey: string }[] = [];
  readonly #idem = new Map<string, { fingerprint: string; result: unknown }>();
  readonly #outbox: PaymentEvent[] = [];
  readonly #seq = new Map<string, number>();
  readonly #secret: string;
  readonly #now: () => number;
  readonly #tolerance: number;
  #failNext: { op: Operation; error: StError } | null = null;

  constructor(options: FakeProviderOptions = {}) {
    this.#secret = options.webhookSecret ?? 'whsec_fake';
    this.#now = options.now ?? (() => Date.now());
    this.#tolerance = options.toleranceSeconds ?? 300;
  }

  /** Makes the next call of `op` throw (simulates an outage). */
  failNext(op: Operation, error: StError = new StError('unavailable', 'fake outage')): void {
    this.#failNext = { op, error };
  }

  #id(prefix: string): string {
    const n = (this.#seq.get(prefix) ?? 0) + 1;
    this.#seq.set(prefix, n);
    return `${prefix}_fake_${String(n).padStart(4, '0')}`;
  }

  async #idempotent<T>(op: Operation, key: string, params: unknown, run: () => T): Promise<T> {
    this.calls.push({ op, idempotencyKey: key });
    if (this.#failNext?.op === op) {
      const { error } = this.#failNext;
      this.#failNext = null;
      throw error;
    }
    const fingerprint = `${op}:${JSON.stringify(params)}`;
    const prior = this.#idem.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new StError('conflict', 'idempotency key reused with different parameters');
      return structuredClone(prior.result) as T;
    }
    const result = run();
    this.#idem.set(key, { fingerprint, result: structuredClone(result) });
    return result;
  }

  #emit(type: PaymentEventType, providerType: string, patch: Partial<PaymentEvent>): void {
    this.#outbox.push({
      id: this.#id('evt'),
      provider: 'fake',
      type,
      providerType,
      ref: null,
      status: null,
      amount: null,
      amountReceived: null,
      amountRefunded: null,
      paymentMethodId: null,
      paymentMethodType: null,
      failureCode: null,
      metadata: {},
      occurredAt: new Date(this.#now()).toISOString(),
      ...patch,
    });
  }

  #intentEvent(type: PaymentEventType, providerType: string, pi: FakeIntent): void {
    this.#emit(type, providerType, {
      ref: pi.ref,
      status: pi.status,
      amount: pi.amount,
      amountReceived: { amountMinor: pi.received, currency: pi.amount.currency },
      amountRefunded: { amountMinor: pi.refunded, currency: pi.amount.currency },
      failureCode: pi.failureCode,
      metadata: pi.metadata,
    });
  }

  /** Returns and clears pending events (what Stripe would POST to the webhook). */
  drainEvents(): PaymentEvent[] {
    return this.#outbox.splice(0, this.#outbox.length);
  }

  /** Signs an event the way the fake webhook expects (for webhook handler tests). */
  async signWebhook(event: PaymentEvent, at: number = this.#now()): Promise<WebhookInput> {
    const rawBody = JSON.stringify(event);
    const t = Math.floor(at / 1000);
    const v1 = await hmacSha256Hex(this.#secret, `${t}.${rawBody}`);
    return { rawBody, headers: new Headers({ [FAKE_SIGNATURE_HEADER]: `t=${t},v1=${v1}` }) };
  }

  #result(pi: FakeIntent, clientSecret: string | null = null): IntentResult {
    return {
      ref: pi.ref,
      status: pi.status,
      clientSecret,
      amount: { ...pi.amount },
      amountReceived: { amountMinor: pi.received, currency: pi.amount.currency },
      failureCode: pi.failureCode,
    };
  }

  #intent(ref: string): FakeIntent {
    const pi = this.intents.get(ref);
    if (!pi) throw new StError('not_found', 'no such payment intent');
    return pi;
  }

  createCustomer(input: CreateCustomerInput): Promise<CustomerRef> {
    return this.#idempotent('createCustomer', input.idempotencyKey, input, () => {
      const customerId = this.#id('cus');
      this.customers.set(customerId, { userId: input.userId, paymentMethods: new Set() });
      return { customerId };
    });
  }

  createSetup(input: SetupInput): Promise<SetupResult> {
    return this.#idempotent('createSetup', input.idempotencyKey, input, () => {
      if (!this.customers.has(input.customerId)) throw new StError('not_found', 'no such customer');
      const ref = this.#id('seti');
      this.setups.set(ref, { ref, customerId: input.customerId, status: 'requires_payment_method', paymentMethodId: null, metadata: input.metadata });
      return { ref, clientSecret: `${ref}_secret`, status: 'requires_payment_method' as const, paymentMethodId: null };
    });
  }

  /** Test helper: the payer completes the payment sheet for a SetupIntent. */
  completeSetup(ref: string, paymentMethodId: string = FAKE_OK_PM): void {
    const si = this.setups.get(ref);
    if (!si) throw new StError('not_found', 'no such setup intent');
    si.status = 'succeeded';
    si.paymentMethodId = paymentMethodId;
    this.customers.get(si.customerId)?.paymentMethods.add(paymentMethodId);
    this.#emit('setup_succeeded', 'setup_intent.succeeded', { ref, status: 'succeeded', paymentMethodId, paymentMethodType: 'card', metadata: si.metadata });
  }

  createDepositHold(input: DepositInput): Promise<IntentResult> {
    return this.#idempotent('createDepositHold', input.idempotencyKey, input, () => {
      if (!this.customers.has(input.customerId)) throw new StError('not_found', 'no such customer');
      if (!Number.isSafeInteger(input.amount.amountMinor) || input.amount.amountMinor <= 0) {
        throw new StError('validation', 'deposit amount must be positive');
      }
      const ref = this.#id('pi');
      const pi: FakeIntent = {
        ref,
        customerId: input.customerId,
        status: 'requires_payment_method',
        amount: { ...input.amount },
        received: 0,
        refunded: 0,
        manual: input.mode === 'hold',
        failureCode: null,
        metadata: input.metadata,
      };
      this.intents.set(ref, pi);
      if (input.mode === 'charge_refund') {
        pi.status = 'requires_action'; // payer approves in their bank / wallet app
        return this.#result(pi, `${ref}_secret`);
      }
      if (!input.paymentMethodId) throw new StError('payment_required', 'a saved payment method is required');
      if (input.paymentMethodId === FAKE_DECLINED_PM) {
        pi.status = 'failed';
        pi.failureCode = 'card_declined';
        this.#intentEvent('payment_failed', 'payment_intent.payment_failed', pi);
        return this.#result(pi);
      }
      pi.status = 'requires_capture';
      this.#intentEvent('hold_authorized', 'payment_intent.amount_capturable_updated', pi);
      return this.#result(pi);
    });
  }

  /** Test helper: the payer approves a charge-and-refund payment (iDEAL redirect, Pix QR, Bit app). */
  confirmCharge(ref: string): void {
    const pi = this.#intent(ref);
    if (pi.manual || pi.status !== 'requires_action') throw new StError('conflict', 'not an approvable charge');
    pi.status = 'succeeded';
    pi.received = pi.amount.amountMinor;
    this.#intentEvent('payment_succeeded', 'payment_intent.succeeded', pi);
  }

  captureDeposit(input: CaptureInput): Promise<IntentResult> {
    return this.#idempotent('captureDeposit', input.idempotencyKey, input, () => {
      const pi = this.#intent(input.ref);
      if (pi.status !== 'requires_capture') throw new StError('conflict', `cannot capture a ${pi.status} intent`);
      const amount = input.amount?.amountMinor ?? pi.amount.amountMinor;
      if (amount <= 0 || amount > pi.amount.amountMinor) throw new StError('validation', 'capture amount out of range');
      pi.status = 'succeeded';
      pi.received = amount;
      this.#intentEvent('payment_succeeded', 'payment_intent.succeeded', pi);
      return this.#result(pi);
    });
  }

  releaseDeposit(input: ReleaseInput): Promise<ReleaseResult> {
    return this.#idempotent('releaseDeposit', input.idempotencyKey, input, (): ReleaseResult => {
      const pi = this.#intent(input.ref);
      if (pi.status === 'canceled' || pi.status === 'failed') return { kind: 'noop', intent: this.#result(pi) };
      if (pi.status === 'processing') throw new StError('conflict', 'processing');
      if (pi.status === 'succeeded') {
        if (pi.received - pi.refunded <= 0) return { kind: 'noop', intent: this.#result(pi) };
        const refund = this.#doRefund(pi, pi.received - pi.refunded);
        return { kind: 'refunded', intent: this.#result(pi), refund };
      }
      pi.status = 'canceled';
      this.#intentEvent('payment_canceled', 'payment_intent.canceled', pi);
      return { kind: 'canceled', intent: this.#result(pi) };
    });
  }

  #doRefund(pi: FakeIntent, amountMinor: number): RefundResult {
    if (amountMinor <= 0 || pi.refunded + amountMinor > pi.received) throw new StError('validation', 'refund exceeds amount received');
    pi.refunded += amountMinor;
    this.#intentEvent('refund_updated', 'charge.refunded', pi);
    return { ref: this.#id('re'), intentRef: pi.ref, status: 'succeeded', amount: { amountMinor, currency: pi.amount.currency } };
  }

  refund(input: RefundInput): Promise<RefundResult> {
    return this.#idempotent('refund', input.idempotencyKey, input, () => {
      const pi = this.#intent(input.ref);
      if (pi.status !== 'succeeded') throw new StError('conflict', 'nothing to refund');
      return this.#doRefund(pi, input.amount?.amountMinor ?? pi.received - pi.refunded);
    });
  }

  retrieveIntent(ref: string): Promise<IntentResult> {
    try {
      return Promise.resolve(this.#result(this.#intent(ref)));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  detachPaymentMethods(customerId: string): Promise<number> {
    const c = this.customers.get(customerId);
    if (!c) return Promise.resolve(0);
    const n = c.paymentMethods.size;
    c.paymentMethods.clear();
    return Promise.resolve(n);
  }

  createCheckout(_input: CheckoutInput): Promise<{ url: string; ref: string }> {
    return Promise.reject(new UnsupportedOperationError('Pro checkout is a later phase'));
  }

  async parseWebhook(input: WebhookInput): Promise<PaymentEvent> {
    const header = input.headers.get(FAKE_SIGNATURE_HEADER);
    const m = header ? /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header) : null;
    if (!m) throw new WebhookSignatureError('missing or malformed signature');
    const t = Number(m[1]);
    if (Math.abs(this.#now() / 1000 - t) > this.#tolerance) throw new WebhookSignatureError('timestamp outside tolerance');
    const expected = await hmacSha256Hex(this.#secret, `${t}.${input.rawBody}`);
    if (!timingSafeEqual(expected, m[2] as string)) throw new WebhookSignatureError('invalid signature');
    return JSON.parse(input.rawBody) as PaymentEvent;
  }
}
