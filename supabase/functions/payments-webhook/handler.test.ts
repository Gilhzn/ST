import { describe, expect, it } from 'vitest';
import { FakeProvider, type PaymentEvent } from '@st/payments';
import { body, memoryLogger, uuid } from '../_test/helpers';
import { PaymentsDb } from '../_test/payments-db';
import { handle, type WebhookDeps } from './handler';

const NOW = Date.parse('2026-11-13T18:00:00.000Z');

function setup() {
  const db = new PaymentsDb(() => NOW);
  const fake = new FakeProvider({ now: () => NOW, webhookSecret: 'whsec_test' });
  const log = memoryLogger();
  const deps: WebhookDeps = { providers: { fake }, store: db, log };
  db.payments.push({
    id: uuid(9001), userId: uuid(10), gameId: uuid(1), amountMinor: 500, currency: 'EUR', provider: 'fake', providerRef: 'seti_fake_0001', status: 'succeeded', depositState: 'setup',
    step: 'setup', paymentMethodId: 'pm_card_visa', securedAt: null, settlementRequested: null, holdRequestedAt: null, idempotencyKey: `deposit:${uuid(1)}:${uuid(10)}:setup`, createdAt: new Date(NOW).toISOString(),
  });
  const send = async (e: PaymentEvent, tamper = false) => {
    const s = await fake.signWebhook(e);
    return handle(new Request('https://fn.test/payments-webhook?provider=fake', { method: 'POST', headers: s.headers, body: tamper ? s.rawBody.replace('500', '900') : s.rawBody }), deps);
  };
  return { db, send, log, deps };
}

const event = (id: string, type: PaymentEvent['type'], patch: Partial<PaymentEvent> = {}): PaymentEvent => ({
  id, provider: 'fake', type, providerType: type, ref: 'pi_fake_0001', status: null, amount: { amountMinor: 500, currency: 'EUR' }, amountReceived: null, amountRefunded: null,
  paymentMethodId: null, paymentMethodType: 'card', failureCode: null, metadata: { paymentId: uuid(9001), step: 'hold' }, occurredAt: new Date(NOW).toISOString(), ...patch,
});

describe('payments-webhook', () => {
  it('rejects bad signatures with 400 and changes nothing', async () => {
    const { send, db, log } = setup();
    const res = await send(event('evt_1', 'hold_authorized'), true);
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ code: 'validation', details: { reason: 'bad_signature' } });
    expect(db.payments[0]!.depositState).toBe('setup');
    expect(db.events.size).toBe(0);
    expect(log.records.some((r) => r.event === 'payments.webhook_bad_signature')).toBe(true);
  });

  it('adopts the hold intent even when its event beats the hold job (race), then is idempotent by event id', async () => {
    const { send, db } = setup();
    expect(await body(await send(event('evt_1', 'hold_authorized')))).toMatchObject({ received: true });
    expect(db.payments[0]).toMatchObject({ providerRef: 'pi_fake_0001', step: 'hold', status: 'requires_capture', depositState: 'held', securedAt: new Date(NOW).toISOString() });
    expect(await body(await send(event('evt_1', 'hold_authorized')))).toEqual({ received: true, duplicate: true });
  });

  it('out-of-order: capture before authorisation ends forfeited, a late authorisation is a no-op', async () => {
    const { send, db } = setup();
    await send(event('evt_cap', 'payment_succeeded', { amountReceived: { amountMinor: 500, currency: 'EUR' } }));
    expect(db.payments[0]).toMatchObject({ status: 'succeeded', depositState: 'forfeited' });
    expect(await body(await send(event('evt_auth', 'hold_authorized')))).toMatchObject({ outcome: 'unchanged' });
    expect(db.payments[0]!.depositState).toBe('forfeited');
    expect(db.effects.some((e) => e.type === 'Audit' && e.action === 'deposit.captured')).toBe(true);
  });

  it('acknowledges unknown payments and ignored event types (so the PSP stops retrying)', async () => {
    const { send, db } = setup();
    expect(await body(await send(event('evt_x', 'hold_authorized', { ref: 'pi_unknown', metadata: {} })))).toMatchObject({ outcome: 'unknown_payment' });
    expect(await body(await send(event('evt_y', 'ignored')))).toEqual({ received: true, ignored: true });
    expect(db.events.has('evt_y')).toBe(true);
  });

  it('unknown provider → 404; GET → 405', async () => {
    const { deps } = setup();
    expect((await handle(new Request('https://fn.test/payments-webhook?provider=stripe', { method: 'POST', body: '{}' }), deps)).status).toBe(404);
    expect((await handle(new Request('https://fn.test/payments-webhook', { method: 'GET' }), deps)).status).toBe(405);
  });
});
