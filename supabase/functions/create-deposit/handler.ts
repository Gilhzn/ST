/**
 * create-deposit: starts securing a no-show deposit for the caller's
 * participation (TRUST-060…067, MON-010…014).
 *
 * POST { gameId, methodType? = 'card' }  (user JWT) → DepositSetup & { mode, holdAt, refundDaysMax }
 *
 * - Hold-capable methods (cards, wallets, Link): a SetupIntent saves the method
 *   now (SCA/3DS here); the manual-capture hold is placed by `payments-hold` at
 *   max(T−24h, approval).
 * - Push methods (iDEAL, Pix, BLIK, Bancontact…): an automatic-capture
 *   PaymentIntent the payer confirms now ("charge-and-refund").
 * - Idempotent per participant: retries reuse the same row and provider
 *   idempotency key and return the same client secret.
 * Only an opaque client secret leaves the function; no card data touches it.
 */
import { StError, type GameId, type PaymentIntentStatus, type PaymentProviderId, type UserId } from '@st/domain';
import {
  capabilityOf,
  depositIdempotencyKey,
  depositMethodsFor,
  depositModeFor,
  isPaymentMethodType,
  planDeposit,
  routeFor,
  stripeMethodTypesFor,
  type DepositMode,
  type PaymentMethodType,
} from '@st/payments';
import { requireUser, type AuthVerifier } from '#shared/auth';
import { providerFor, type DepositGame, type DepositParticipant, type PaymentRow, type ProviderRegistry } from '#shared/deposit';
import { json, readJson, route, type CorsOptions } from '#shared/http';
import type { Logger } from '#shared/log';
import type { Clock, RateLimiter } from '#shared/runtime';
import { stringField, uuidField } from '#shared/validate';

export interface CreateDepositStore {
  loadContext(gameId: GameId, userId: UserId): Promise<{ game: DepositGame; participant: DepositParticipant | null; countryCode: string | null } | null>;
  /** Deposit rows of this participation, newest first. */
  listPayments(userId: UserId, gameId: GameId): Promise<PaymentRow[]>;
  getCustomer(userId: UserId, provider: PaymentProviderId): Promise<string | null>;
  /** Insert-if-absent; returns the stored customer id (an earlier concurrent insert wins). */
  saveCustomer(userId: UserId, provider: PaymentProviderId, customerId: string): Promise<string>;
  /** Insert-if-absent by idempotency key; returns the stored row. */
  insertPayment(row: { userId: UserId; gameId: GameId; amountMinor: number; currency: string; provider: PaymentProviderId; step: 'setup' | 'charge'; idempotencyKey: string }): Promise<PaymentRow>;
  /** Stores the provider object of a new row (no-op if a ref is already stored). */
  attachProviderRef(paymentId: string, ref: string, status: PaymentIntentStatus): Promise<void>;
}

export interface CreateDepositDeps {
  auth: AuthVerifier;
  store: CreateDepositStore;
  providers: ProviderRegistry;
  /** Route every method to this provider (e.g. `fake` for the e2e mock backend). */
  forceProvider?: PaymentProviderId;
  rateLimiter: RateLimiter;
  clock: Clock;
  log: Logger;
  cors: CorsOptions;
}

export interface CreateDepositResponse {
  paymentId: string;
  provider: PaymentProviderId;
  amount: { amountMinor: number; currency: string };
  clientSecret: string;
  status: PaymentIntentStatus;
  mode: DepositMode;
  /** When the hold will be placed (hold mode), else `null`. */
  holdAt: string | null;
  /** Shown before joining (TRUST-062/067). */
  refundDaysMax: number;
}

const JOINABLE = new Set(['requested', 'approved', 'waitlisted']);

export async function handle(req: Request, deps: CreateDepositDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'], cors: deps.cors }, async (cors) => {
    const user = await requireUser(req, deps.auth);
    const input = await readJson(req, 4 * 1024);
    const gameId = uuidField(input, 'gameId');
    const methodRaw = stringField(input, 'methodType', { max: 32, optional: true }) ?? 'card';
    if (!isPaymentMethodType(methodRaw)) throw new StError('validation', 'unknown payment method', { field: 'methodType' });
    const methodType: PaymentMethodType = methodRaw;

    const limit = await deps.rateLimiter.hit(`deposit:${user.userId}`, 10, 60_000);
    if (!limit.allowed) throw new StError('rate_limited', 'too many attempts', { retryAfterMs: limit.retryAfterMs });

    const ctx = await deps.store.loadContext(gameId, user.userId);
    if (!ctx) throw new StError('not_found');
    const { game, participant, countryCode } = ctx;
    const now = deps.clock.now();
    if (game.depositMinor <= 0) throw new StError('validation', 'this game has no deposit', { reason: 'no_deposit' });
    if (game.hostId === user.userId) throw new StError('validation', 'hosts do not pay a deposit', { reason: 'host_exempt' });
    if (game.status !== 'scheduled' || now >= Date.parse(game.startsAt)) throw new StError('game_not_open');
    if (!participant || !JOINABLE.has(participant.status)) throw new StError('forbidden', 'request to join first');

    const offered = depositMethodsFor({ country: countryCode, currency: game.currency });
    if (!offered.some((m) => m.type === methodType)) throw new StError('validation', 'method not available for this game', { reason: 'method_unavailable' });
    const mode = depositModeFor(methodType);
    const methodRoute = routeFor(methodType, countryCode);
    const providerId: PaymentProviderId | null = deps.forceProvider ?? (methodRoute === 'razorpay' ? null : methodRoute);
    const provider = providerId ? providerFor(deps.providers, providerId) : null;
    if (!provider || !providerId) throw new StError('unavailable', 'payment provider not available', { reason: 'provider_unavailable' });

    const rows = await deps.store.listPayments(user.userId, gameId);
    const latest = rows[0];
    if (latest && (latest.depositState === 'held' || latest.depositState === 'forfeited' || latest.depositState === 'released')) {
      throw new StError('conflict', 'deposit already handled', { reason: `deposit_${latest.depositState}` });
    }
    const wantStep = mode === 'hold' ? 'setup' : 'charge';
    const reusable = latest && latest.depositState === 'setup' && latest.step === wantStep && latest.provider === providerId && latest.status !== 'failed' && latest.status !== 'canceled';
    const amount = { amountMinor: game.depositMinor, currency: game.currency };

    let customerId = await deps.store.getCustomer(user.userId, providerId);
    if (!customerId) {
      const created = await provider.createCustomer({ userId: user.userId, idempotencyKey: `customer:${providerId}:${user.userId}` });
      customerId = await deps.store.saveCustomer(user.userId, providerId, created.customerId);
    }

    const row = reusable
      ? latest
      : await deps.store.insertPayment({
          userId: user.userId,
          gameId,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          provider: providerId,
          step: wantStep,
          idempotencyKey: depositIdempotencyKey(gameId, user.userId, wantStep, rows.length),
        });

    const metadata = { paymentId: row.id, userId: user.userId, gameId, step: wantStep };
    let ref: string;
    let clientSecret: string | null;
    let status: PaymentIntentStatus;
    if (mode === 'hold') {
      const setup = await provider.createSetup({
        customerId,
        methodTypes: stripeMethodTypesFor({ country: countryCode, currency: game.currency }, 'hold'),
        idempotencyKey: row.idempotencyKey,
        metadata,
      });
      ({ ref, clientSecret, status } = setup);
    } else {
      const charge = await provider.createDepositHold({
        customerId,
        amount,
        mode: 'charge_refund',
        paymentMethodId: null,
        methodTypes: [methodType],
        idempotencyKey: row.idempotencyKey,
        metadata,
        descriptorSuffix: 'DEPOSIT',
      });
      ({ ref, clientSecret, status } = charge);
    }
    if (!clientSecret) throw new StError('unavailable', 'provider returned no client secret');
    if (row.providerRef !== ref) await deps.store.attachProviderRef(row.id, ref, status);

    const plan = planDeposit({ game: { startsAt: game.startsAt, depositMinor: game.depositMinor }, mode, approvedAt: participant.decidedAt, now });
    deps.log.info('deposit.created', { gameId, paymentId: row.id, mode, provider: providerId, reused: reusable === true });
    const body: CreateDepositResponse = {
      paymentId: row.id,
      provider: providerId,
      amount,
      clientSecret,
      status,
      mode,
      holdAt: plan.kind === 'hold' ? plan.holdAt : null,
      refundDaysMax: capabilityOf(methodType)?.refundDaysMax ?? 10,
    };
    return json(body, 200, cors);
  });
}
