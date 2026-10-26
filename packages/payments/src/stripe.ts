/**
 * StripeProvider: the primary PaymentProvider adapter.
 *
 * The Stripe SDK instance is injected (`StripeClientLike`), so this module
 * never imports the SDK at runtime: the Deno wiring builds the client with
 * `new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })` and tests
 * pass a mock. Parameter types come from the installed SDK, so every request
 * this adapter sends is type-checked against Stripe's own definitions.
 */
import type Stripe from 'stripe';
import { StError, type IsoDateTime, type Money, type PaymentIntentStatus } from '@st/domain';
import { fromStripeAmount, toStripeAmount } from './money';
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

type Opts = Stripe.RequestOptions;

/** The PaymentIntent fields this adapter reads. */
export type StripePaymentIntentLike = Pick<
  Stripe.PaymentIntent,
  'id' | 'status' | 'client_secret' | 'amount' | 'amount_received' | 'currency'
> & { last_payment_error?: { code?: string | null } | null };

/** The SetupIntent fields this adapter reads. */
export type StripeSetupIntentLike = Pick<Stripe.SetupIntent, 'id' | 'status' | 'client_secret'> & {
  payment_method: string | { id: string } | null;
};

export type StripeRefundLike = Pick<Stripe.Refund, 'id' | 'status' | 'amount' | 'currency'> & {
  payment_intent: string | { id: string } | null;
};

/** The webhook event fields this adapter reads (a `Stripe.Event` satisfies it). */
export interface StripeEventLike {
  id: string;
  type: string;
  created: number;
  data: { object: unknown };
}

/**
 * The subset of the Stripe SDK used here. A real `Stripe` instance is
 * assignable to it (checked in `test/stripe.compat.test.ts`).
 */
export interface StripeClientLike {
  customers: {
    create(params?: Stripe.CustomerCreateParams, options?: Opts): Promise<{ id: string }>;
    listPaymentMethods(
      id: string,
      params?: Stripe.CustomerListPaymentMethodsParams,
      options?: Opts,
    ): PromiseLike<{ data: { id: string }[]; has_more: boolean }>;
  };
  setupIntents: {
    create(params?: Stripe.SetupIntentCreateParams, options?: Opts): Promise<StripeSetupIntentLike>;
  };
  paymentIntents: {
    create(params: Stripe.PaymentIntentCreateParams, options?: Opts): Promise<StripePaymentIntentLike>;
    capture(id: string, params?: Stripe.PaymentIntentCaptureParams, options?: Opts): Promise<StripePaymentIntentLike>;
    cancel(id: string, params?: Stripe.PaymentIntentCancelParams, options?: Opts): Promise<StripePaymentIntentLike>;
    retrieve(id: string, params?: Stripe.PaymentIntentRetrieveParams, options?: Opts): Promise<StripePaymentIntentLike>;
  };
  refunds: {
    create(params?: Stripe.RefundCreateParams, options?: Opts): Promise<StripeRefundLike>;
  };
  paymentMethods: {
    detach(id: string, params?: Stripe.PaymentMethodDetachParams, options?: Opts): Promise<{ id: string }>;
  };
  webhooks: {
    constructEventAsync(payload: string, header: string, secret: string, tolerance?: number): Promise<StripeEventLike>;
  };
}

export interface StripeProviderOptions {
  client: StripeClientLike;
  /** `STRIPE_WEBHOOK_SECRET` (whsec_…). Required for {@link StripeProvider.parseWebhook}. */
  webhookSecret?: string;
  /** Signature timestamp tolerance in seconds (Stripe default 300). */
  webhookToleranceSeconds?: number;
}

const META = { paymentId: 'st_payment_id', userId: 'st_user_id', gameId: 'st_game_id', step: 'st_step' } as const;

function toStripeMetadata(m: PaymentMetadata): Record<string, string> {
  return { [META.paymentId]: m.paymentId, [META.userId]: m.userId, [META.gameId]: m.gameId, [META.step]: m.step };
}

function fromStripeMetadata(raw: unknown): Partial<PaymentMetadata> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<PaymentMetadata> = {};
  for (const [k, sk] of Object.entries(META) as [keyof PaymentMetadata, string][]) {
    const v = r[sk];
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

function normalizeStatus(status: string): PaymentIntentStatus {
  switch (status) {
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'processing':
    case 'requires_capture':
    case 'succeeded':
    case 'canceled':
      return status;
    default:
      return 'processing';
  }
}

function intentResult(pi: StripePaymentIntentLike): IntentResult {
  return {
    ref: pi.id,
    status: normalizeStatus(pi.status),
    clientSecret: pi.client_secret ?? null,
    amount: fromStripeAmount(pi.amount, pi.currency),
    amountReceived: fromStripeAmount(pi.amount_received ?? 0, pi.currency),
    failureCode: pi.last_payment_error?.code ?? null,
  };
}

interface StripeErrorShape {
  type?: unknown;
  code?: unknown;
  statusCode?: unknown;
  raw?: { payment_intent?: StripePaymentIntentLike } | undefined;
  payment_intent?: StripePaymentIntentLike | undefined;
}

/** Maps SDK errors to `StError`. Card declines are returned as data, not thrown, by callers. */
function mapStripeError(e: unknown): StError {
  const err = (e ?? {}) as StripeErrorShape;
  const type = typeof err.type === 'string' ? err.type : '';
  const code = typeof err.code === 'string' ? err.code : null;
  if (type === 'StripeCardError') return new StError('payment_failed', 'card declined', { providerCode: code });
  if (type === 'StripeIdempotencyError') return new StError('conflict', 'idempotency key reused with different parameters');
  if (type === 'StripeInvalidRequestError') return new StError('validation', 'provider rejected the request', { providerCode: code });
  if (type === 'StripeRateLimitError') return new StError('rate_limited', 'provider rate limit');
  return new StError('unavailable', 'payment provider unavailable', { providerCode: code });
}

function refOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

const str = (o: Record<string, unknown>, k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
const num = (o: Record<string, unknown>, k: string): number | null => (typeof o[k] === 'number' ? (o[k] as number) : null);

const EVENT_MAP: Readonly<Record<string, PaymentEventType>> = {
  'setup_intent.succeeded': 'setup_succeeded',
  'setup_intent.setup_failed': 'setup_failed',
  'setup_intent.requires_action': 'payment_requires_action',
  'payment_intent.processing': 'payment_processing',
  'payment_intent.requires_action': 'payment_requires_action',
  'payment_intent.amount_capturable_updated': 'hold_authorized',
  'payment_intent.succeeded': 'payment_succeeded',
  'payment_intent.payment_failed': 'payment_failed',
  'payment_intent.canceled': 'payment_canceled',
  'charge.refunded': 'refund_updated',
  'charge.dispute.created': 'dispute_opened',
};

/** Normalises a verified Stripe event. Exported for tests. */
export function normalizeStripeEvent(event: StripeEventLike): PaymentEvent {
  const type = EVENT_MAP[event.type] ?? 'ignored';
  const obj = (event.data.object && typeof event.data.object === 'object' ? event.data.object : {}) as Record<string, unknown>;
  const occurredAt: IsoDateTime = new Date(event.created * 1000).toISOString();
  const currency = str(obj, 'currency');
  const money = (amount: number | null): Money | null =>
    amount !== null && currency ? fromStripeAmount(amount, currency) : null;
  const base: PaymentEvent = {
    id: event.id,
    provider: 'stripe',
    type,
    providerType: event.type,
    ref: null,
    status: null,
    amount: null,
    amountReceived: null,
    amountRefunded: null,
    paymentMethodId: null,
    paymentMethodType: null,
    failureCode: null,
    metadata: fromStripeMetadata(obj['metadata']),
    occurredAt,
  };
  if (type === 'ignored') return { ...base, ref: str(obj, 'id') };

  if (event.type.startsWith('setup_intent.')) {
    const err = (obj['last_setup_error'] ?? null) as Record<string, unknown> | null;
    const pm = obj['payment_method'] as string | { id: string } | null | undefined;
    return {
      ...base,
      ref: str(obj, 'id'),
      status: type === 'setup_failed' ? 'failed' : normalizeStatus(str(obj, 'status') ?? 'processing'),
      paymentMethodId: refOf(pm),
      failureCode: err ? str(err, 'code') : null,
    };
  }
  if (event.type.startsWith('payment_intent.')) {
    const err = (obj['last_payment_error'] ?? null) as Record<string, unknown> | null;
    const errPm = err && typeof err['payment_method'] === 'object' ? (err['payment_method'] as Record<string, unknown>) : null;
    const types = Array.isArray(obj['payment_method_types']) ? (obj['payment_method_types'] as unknown[]) : [];
    return {
      ...base,
      ref: str(obj, 'id'),
      status: type === 'payment_failed' ? 'failed' : normalizeStatus(str(obj, 'status') ?? 'processing'),
      amount: money(num(obj, 'amount')),
      amountReceived: money(num(obj, 'amount_received')),
      paymentMethodId: refOf(obj['payment_method'] as string | { id: string } | null | undefined),
      paymentMethodType: (errPm ? str(errPm, 'type') : null) ?? (types.length === 1 && typeof types[0] === 'string' ? types[0] : null),
      failureCode: err ? str(err, 'code') ?? str(err, 'decline_code') : null,
    };
  }
  // charge.refunded / charge.dispute.created: correlate through the payment intent.
  return {
    ...base,
    ref: refOf(obj['payment_intent'] as string | { id: string } | null | undefined),
    amount: money(num(obj, 'amount')),
    amountReceived: event.type === 'charge.refunded' ? money(num(obj, 'amount_captured')) : null,
    amountRefunded: event.type === 'charge.refunded' ? money(num(obj, 'amount_refunded')) : null,
  };
}

export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe' as const;
  readonly #client: StripeClientLike;
  readonly #webhookSecret: string | undefined;
  readonly #tolerance: number;

  constructor(options: StripeProviderOptions) {
    this.#client = options.client;
    this.#webhookSecret = options.webhookSecret;
    this.#tolerance = options.webhookToleranceSeconds ?? 300;
  }

  async createCustomer(input: CreateCustomerInput): Promise<CustomerRef> {
    try {
      // Data minimisation: no name, phone or email at the PSP; only our pseudonymous id.
      const c = await this.#client.customers.create(
        { metadata: { [META.userId]: input.userId } },
        { idempotencyKey: input.idempotencyKey },
      );
      return { customerId: c.id };
    } catch (e) {
      throw mapStripeError(e);
    }
  }

  async createSetup(input: SetupInput): Promise<SetupResult> {
    try {
      const si = await this.#client.setupIntents.create(
        {
          customer: input.customerId,
          usage: 'off_session',
          allowed_payment_method_types: [...input.methodTypes] as Stripe.SetupIntentCreateParams.AllowedPaymentMethodType[],
          metadata: toStripeMetadata(input.metadata),
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (!si.client_secret) throw new StError('unavailable', 'setup intent without client secret');
      return {
        ref: si.id,
        clientSecret: si.client_secret,
        status: normalizeStatus(si.status),
        paymentMethodId: refOf(si.payment_method),
      };
    } catch (e) {
      throw e instanceof StError ? e : mapStripeError(e);
    }
  }

  async createDepositHold(input: DepositInput): Promise<IntentResult> {
    const amount = toStripeAmount(input.amount);
    const currency = input.amount.currency.toLowerCase();
    const metadata = toStripeMetadata(input.metadata);
    const allowed = [...input.methodTypes] as Stripe.PaymentIntentCreateParams.AllowedPaymentMethodType[];
    const suffix = input.descriptorSuffix ? input.descriptorSuffix.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 22) : undefined;
    const params: Stripe.PaymentIntentCreateParams =
      input.mode === 'hold'
        ? {
            amount,
            currency,
            customer: input.customerId,
            payment_method: input.paymentMethodId ?? undefined,
            allowed_payment_method_types: allowed,
            capture_method: 'manual',
            confirm: true,
            off_session: true,
            metadata,
            ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
          }
        : {
            amount,
            currency,
            customer: input.customerId,
            allowed_payment_method_types: allowed,
            capture_method: 'automatic',
            metadata,
            ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
          };
    if (input.mode === 'hold' && !input.paymentMethodId) {
      throw new StError('payment_required', 'a saved payment method is required for an off-session hold');
    }
    try {
      return intentResult(await this.#client.paymentIntents.create(params, { idempotencyKey: input.idempotencyKey }));
    } catch (e) {
      // Off-session declines (incl. authentication_required) carry the failed intent: return it as data
      // so the caller can start the TRUST-064 fix window instead of treating it as an outage.
      const err = (e ?? {}) as StripeErrorShape;
      const pi = err.payment_intent ?? err.raw?.payment_intent;
      if (err.type === 'StripeCardError' && pi) {
        const r = intentResult(pi);
        return { ...r, status: 'failed', failureCode: typeof err.code === 'string' ? err.code : r.failureCode };
      }
      throw mapStripeError(e);
    }
  }

  async captureDeposit(input: CaptureInput): Promise<IntentResult> {
    try {
      const params: Stripe.PaymentIntentCaptureParams = input.amount ? { amount_to_capture: toStripeAmount(input.amount) } : {};
      return intentResult(await this.#client.paymentIntents.capture(input.ref, params, { idempotencyKey: input.idempotencyKey }));
    } catch (e) {
      throw mapStripeError(e);
    }
  }

  async retrieveIntent(ref: string): Promise<IntentResult> {
    try {
      return intentResult(await this.#client.paymentIntents.retrieve(ref));
    } catch (e) {
      throw mapStripeError(e);
    }
  }

  async releaseDeposit(input: ReleaseInput): Promise<ReleaseResult> {
    const current = await this.retrieveIntent(input.ref);
    switch (current.status) {
      case 'canceled':
      case 'failed':
        return { kind: 'noop', intent: current };
      case 'processing':
        throw new StError('conflict', 'payment is processing; retry release later');
      case 'succeeded': {
        if (current.amountReceived.amountMinor === 0) return { kind: 'noop', intent: current };
        const refund = await this.refund({ ref: input.ref, idempotencyKey: `${input.idempotencyKey}:refund`, reason: 'attended' });
        return { kind: 'refunded', intent: current, refund };
      }
      default:
        try {
          const pi = await this.#client.paymentIntents.cancel(
            input.ref,
            { cancellation_reason: 'requested_by_customer' },
            { idempotencyKey: `${input.idempotencyKey}:cancel` },
          );
          return { kind: 'canceled', intent: intentResult(pi) };
        } catch (e) {
          throw mapStripeError(e);
        }
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    try {
      const params: Stripe.RefundCreateParams = {
        payment_intent: input.ref,
        reason: input.reason === 'duplicate' ? 'duplicate' : 'requested_by_customer',
        metadata: { st_reason: input.reason },
        ...(input.amount ? { amount: toStripeAmount(input.amount) } : {}),
      };
      const r = await this.#client.refunds.create(params, { idempotencyKey: input.idempotencyKey });
      const status = r.status;
      return {
        ref: r.id,
        intentRef: refOf(r.payment_intent) ?? input.ref,
        status:
          status === 'succeeded' || status === 'failed' || status === 'canceled' || status === 'requires_action'
            ? status
            : 'pending',
        amount: fromStripeAmount(r.amount, r.currency),
      };
    } catch (e) {
      throw mapStripeError(e);
    }
  }

  async detachPaymentMethods(customerId: string): Promise<number> {
    let detached = 0;
    try {
      // Detached methods disappear from the list, so re-list until empty (bounded).
      for (let page = 0; page < 20; page++) {
        const list = await this.#client.customers.listPaymentMethods(customerId, { limit: 100 });
        if (list.data.length === 0) break;
        for (const pm of list.data) {
          await this.#client.paymentMethods.detach(pm.id);
          detached++;
        }
        if (!list.has_more) break;
      }
      return detached;
    } catch (e) {
      throw mapStripeError(e);
    }
  }

  createCheckout(_input: CheckoutInput): Promise<{ url: string; ref: string }> {
    return Promise.reject(new UnsupportedOperationError('Pro checkout is a later phase (Stripe Billing on web, IAP on native)'));
  }

  async parseWebhook(input: WebhookInput): Promise<PaymentEvent> {
    if (!this.#webhookSecret) throw new WebhookSignatureError('webhook secret not configured');
    const signature = input.headers.get('stripe-signature');
    if (!signature) throw new WebhookSignatureError('missing stripe-signature header');
    let event: StripeEventLike;
    try {
      event = await this.#client.webhooks.constructEventAsync(input.rawBody, signature, this.#webhookSecret, this.#tolerance);
    } catch {
      throw new WebhookSignatureError('invalid signature');
    }
    return normalizeStripeEvent(event);
  }
}
