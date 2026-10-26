/**
 * Deposit lifecycle end to end with FakeProvider: create-deposit → payer saves
 * the card → webhook → payments-hold at T−24h → webhook → settle (capture or
 * release) → webhook. Exercises the real handlers, pure policy and transitions.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FAKE_DECLINED_PM, FakeProvider } from '@st/payments';
import { handle as createDeposit, type CreateDepositDeps, type CreateDepositResponse } from '../create-deposit/handler';
import { handle as webhook, type WebhookDeps } from '../payments-webhook/handler';
import { INTERNAL_SECRET, allowAll, body, fakeAuth, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { PaymentsDb } from '../_test/payments-db';
import { handleHold, handleSettle, type DepositJobDeps } from './handler';

const H = 3_600_000;
const START = Date.parse('2026-11-14T18:00:00.000Z');
const END = START + 2 * H;
const GAME = uuid(1);
const HOST = uuid(2);
const PLAYER = uuid(10);

let clock: ReturnType<typeof mutableClock>;
let db: PaymentsDb;
let fake: FakeProvider;
let depositDeps: CreateDepositDeps;
let webhookDeps: WebhookDeps;
let jobDeps: DepositJobDeps;

beforeEach(() => {
  clock = mutableClock(START - 72 * H);
  db = new PaymentsDb(clock.now);
  fake = new FakeProvider({ now: clock.now, webhookSecret: 'whsec_test' });
  const providers = { fake };
  const log = memoryLogger();
  depositDeps = { auth: fakeAuth({ tok: PLAYER, host: HOST }), store: db, providers, forceProvider: 'fake', rateLimiter: allowAll, clock, log, cors: { allowedOrigins: [] } };
  webhookDeps = { providers, store: db, log };
  jobDeps = { internalSecrets: [INTERNAL_SECRET], store: db, providers, clock, log };
  db.games.set(GAME, { id: GAME, title: 'Sunday football', hostId: HOST, startsAt: new Date(START).toISOString(), endsAt: new Date(END).toISOString(), status: 'scheduled', depositMinor: 500, currency: 'EUR', depositForfeitTo: 'pot' });
  db.participants.set(db.key(GAME, PLAYER), { status: 'approved', attendance: 'unknown', lateCancel: false, lateCancelRefilled: false, decidedAt: new Date(START - 72 * H).toISOString(), requestedAt: new Date(START - 73 * H).toISOString() });
  db.countries.set(PLAYER, 'NL');
});

/** Delivers every pending fake PSP event through the real webhook handler. */
async function deliver(): Promise<string[]> {
  const outcomes: string[] = [];
  for (const e of fake.drainEvents()) {
    const signed = await fake.signWebhook(e);
    const res = await webhook(new Request('https://fn.test/payments-webhook?provider=fake', { method: 'POST', headers: signed.headers, body: signed.rawBody }), webhookDeps);
    expect(res.status).toBe(200);
    outcomes.push(String((await body(res))['outcome'] ?? 'dup'));
  }
  return outcomes;
}

const create = (b: Record<string, unknown> = {}, token = 'tok') => createDeposit(post('create-deposit', { gameId: GAME, ...b }, { token }), depositDeps);
const job = (fn: typeof handleHold, b: Record<string, unknown>) => fn(post('payments-job', b, { token: INTERNAL_SECRET }), jobDeps);

async function saveCard(pm?: string) {
  const res = await body<CreateDepositResponse>(await create());
  const row = db.payments[0]!;
  fake.completeSetup(row.providerRef!, pm);
  await deliver();
  return res;
}

describe('deposit lifecycle (FakeProvider)', () => {
  it('card: setup at join, hold at T−24h, capture after the 48h dispute window on a no-show', async () => {
    const setup = await body<CreateDepositResponse>(await create());
    expect(setup).toMatchObject({ provider: 'fake', mode: 'hold', status: 'requires_payment_method', holdAt: new Date(START - 24 * H).toISOString(), amount: { amountMinor: 500, currency: 'EUR' } });
    expect(setup.clientSecret).toMatch(/secret/);

    // Retry returns the same row and secret (idempotent).
    const again = await body<CreateDepositResponse>(await create());
    expect(again.paymentId).toBe(setup.paymentId);
    expect(again.clientSecret).toBe(setup.clientSecret);
    expect(db.payments).toHaveLength(1);

    fake.completeSetup(db.payments[0]!.providerRef!);
    await deliver();
    expect(db.payments[0]).toMatchObject({ status: 'succeeded', depositState: 'setup', paymentMethodId: 'pm_card_visa' });

    // Too early for the hold.
    expect(await body(await job(handleHold, { payment_id: setup.paymentId }))).toMatchObject({ results: [{ outcome: 'not_due' }] });
    clock.set(START - 24 * H);
    expect(await body(await job(handleHold, { sweep: true }))).toMatchObject({ results: [{ outcome: 'held' }] });
    await deliver();
    expect(db.payments[0]).toMatchObject({ step: 'hold', status: 'requires_capture', depositState: 'held' });

    // No-show after the game: card issued, dispute window open → wait; then capture.
    clock.set(END + H);
    db.participants.get(db.key(GAME, PLAYER))!.attendance = 'no_show_unverified';
    db.games.get(GAME)!.status = 'completed';
    db.cards.set(db.key(GAME, PLAYER), { status: 'active', disputeUntil: new Date(END + 49 * H).toISOString() });
    expect(await body(await job(handleSettle, { payment_id: setup.paymentId, outcome: 'forfeit' }))).toMatchObject({ results: [{ outcome: 'deferred:awaiting_dispute_window' }] });
    expect(db.payments[0]!.depositState).toBe('held');

    clock.set(END + 49 * H);
    expect(await body(await job(handleSettle, { payment_id: setup.paymentId, outcome: 'forfeit' }))).toMatchObject({ results: [{ outcome: 'forfeit' }] });
    expect(await deliver()).toEqual(['captured']);
    expect(db.payments[0]).toMatchObject({ status: 'succeeded', depositState: 'forfeited' });
    expect(fake.calls.find((c) => c.op === 'captureDeposit')?.idempotencyKey).toBe(`deposit:${GAME}:${PLAYER}:capture`);
    expect(db.effects.some((e) => e.type === 'Audit' && e.action === 'deposit.forfeit')).toBe(true);
  });

  it('card: attendance verified → hold cancelled, nothing captured', async () => {
    const setup = await saveCard();
    clock.set(START - 24 * H);
    await job(handleHold, { payment_id: setup.paymentId });
    await deliver();
    db.participants.get(db.key(GAME, PLAYER))!.attendance = 'verified';
    clock.set(START + H);
    expect(await body(await job(handleSettle, { payment_id: setup.paymentId, outcome: 'release' }))).toMatchObject({ results: [{ outcome: 'release' }] });
    await deliver();
    expect(db.payments[0]).toMatchObject({ status: 'canceled', depositState: 'released' });
    expect(fake.calls.some((c) => c.op === 'captureDeposit')).toBe(false);
  });

  it('declined off-session hold → player notified at once (TRUST-064), row marked failed by the webhook', async () => {
    const setup = await saveCard(FAKE_DECLINED_PM);
    clock.set(START - 24 * H);
    expect(await body(await job(handleHold, { payment_id: setup.paymentId }))).toMatchObject({ results: [{ outcome: 'declined' }] });
    expect(db.effects.find((e) => e.type === 'Notify')).toMatchObject({ kind: 'deposit_action_required', userId: PLAYER, params: { gameTitle: 'Sunday football', amount: 'EUR 5.00' } });
    await deliver();
    expect(db.payments[0]).toMatchObject({ status: 'failed', depositState: 'failed' });
    // A new attempt gets a fresh row and idempotency key.
    const retry = await body<CreateDepositResponse>(await create());
    expect(retry.paymentId).not.toBe(setup.paymentId);
    expect(db.payments.at(-1)!.idempotencyKey).toBe(`deposit:${GAME}:${PLAYER}:setup:1`);
  });

  it('iDEAL (NL): charged while present, refunded on attendance (charge-and-refund)', async () => {
    const res = await body<CreateDepositResponse>(await create({ methodType: 'ideal' }));
    expect(res).toMatchObject({ mode: 'charge_refund', holdAt: null, status: 'requires_action', refundDaysMax: 5 });
    fake.confirmCharge(db.payments[0]!.providerRef!);
    await deliver();
    expect(db.payments[0]).toMatchObject({ step: 'charge', status: 'succeeded', depositState: 'held' });
    db.participants.get(db.key(GAME, PLAYER))!.attendance = 'verified';
    clock.set(START + H);
    await job(handleSettle, { payment_id: res.paymentId, outcome: 'release' });
    expect(await deliver()).toEqual(['refunded']);
    expect(db.payments[0]!.depositState).toBe('released');
  });

  it('iDEAL no-show forfeits without a provider call (money already captured)', async () => {
    const res = await body<CreateDepositResponse>(await create({ methodType: 'ideal' }));
    fake.confirmCharge(db.payments[0]!.providerRef!);
    await deliver();
    db.participants.get(db.key(GAME, PLAYER))!.attendance = 'no_show_unverified';
    db.games.get(GAME)!.status = 'completed';
    db.cards.set(db.key(GAME, PLAYER), { status: 'upheld', disputeUntil: null });
    clock.set(END + 50 * H);
    expect(await body(await job(handleSettle, { payment_id: res.paymentId, outcome: 'forfeit' }))).toMatchObject({ results: [{ outcome: 'forfeit' }] });
    expect(db.payments[0]!.depositState).toBe('forfeited');
    expect(fake.calls.filter((c) => c.op === 'captureDeposit' || c.op === 'refund')).toHaveLength(0);
  });

  it('game cancelled before the hold: setup-only row closed as released', async () => {
    const setup = await saveCard();
    db.games.get(GAME)!.status = 'cancelled';
    expect(await body(await job(handleSettle, { payment_id: setup.paymentId, outcome: 'release' }))).toMatchObject({ results: [{ outcome: 'release' }] });
    expect(db.payments[0]!.depositState).toBe('released');
  });

  it('settlement request that disagrees with the domain policy is deferred, not executed', async () => {
    const setup = await saveCard();
    clock.set(START - 24 * H);
    await job(handleHold, { payment_id: setup.paymentId });
    await deliver();
    db.participants.get(db.key(GAME, PLAYER))!.attendance = 'verified';
    clock.set(END);
    expect(await body(await job(handleSettle, { payment_id: setup.paymentId, outcome: 'forfeit' }))).toMatchObject({ results: [{ outcome: 'deferred:attended' }] });
    expect(db.payments[0]!.depositState).toBe('held');
    expect(fake.calls.some((c) => c.op === 'captureDeposit')).toBe(false);
  });

  it('jobs are internal-only', async () => {
    expect((await handleHold(post('payments-hold', { sweep: true }, { token: 'tok' }), jobDeps)).status).toBe(401);
  });
});

describe('create-deposit validation', () => {
  it('rejects hosts, games without deposit, unavailable methods and non-participants', async () => {
    expect(await body(await create({}, 'host'))).toMatchObject({ code: 'validation', details: { reason: 'host_exempt' } });
    expect(await body(await create({ methodType: 'pix' }))).toMatchObject({ details: { reason: 'method_unavailable' } });
    expect(await body(await create({ methodType: 'sepa_debit' }))).toMatchObject({ details: { reason: 'method_unavailable' } });
    expect((await create({ methodType: 'bogus' })).status).toBe(400);
    db.participants.get(db.key(GAME, PLAYER))!.status = 'rejected';
    expect((await create()).status).toBe(403);
    db.games.get(GAME)!.depositMinor = 0;
    expect(await body(await create())).toMatchObject({ details: { reason: 'no_deposit' } });
  });

  it('refuses when the game already started or the deposit is already held', async () => {
    await saveCard();
    clock.set(START - 24 * H);
    await job(handleHold, { payment_id: db.payments[0]!.id });
    await deliver();
    expect(await body(await create())).toMatchObject({ code: 'conflict', details: { reason: 'deposit_held' } });
    clock.set(START + 1);
    expect(await body(await create())).toMatchObject({ code: 'game_not_open' });
  });

  it('returns 503 when no provider serves the route (e.g. UPI before a PSP is contracted)', async () => {
    depositDeps.forceProvider = undefined;
    expect(await body(await create())).toMatchObject({ code: 'unavailable', details: { reason: 'provider_unavailable' } });
  });
});
