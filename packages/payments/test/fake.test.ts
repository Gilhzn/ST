import { describe, expect, it } from 'vitest';
import { FAKE_DECLINED_PM, FAKE_SIGNATURE_HEADER, FakeProvider } from '../src/fake';
import { WebhookSignatureError, type PaymentMetadata } from '../src/port';
import { applyPaymentEvent, type PaymentRowState } from '../src/status';

const NOW = Date.parse('2026-11-09T18:00:00.000Z');
const meta = (step: string): PaymentMetadata => ({ paymentId: 'p1', userId: 'u1', gameId: 'g1', step });
const EUR5 = { amountMinor: 500, currency: 'EUR' };

async function setupCustomer(p: FakeProvider) {
  const { customerId } = await p.createCustomer({ userId: 'u1', idempotencyKey: 'deposit:g1:u1:customer' });
  const setup = await p.createSetup({ customerId, methodTypes: ['card'], idempotencyKey: 'deposit:g1:u1:setup', metadata: meta('setup') });
  p.completeSetup(setup.ref);
  return { customerId, setup };
}

describe('FakeProvider', () => {
  it('is deterministic', async () => {
    const a = new FakeProvider({ now: () => NOW });
    const b = new FakeProvider({ now: () => NOW });
    expect((await setupCustomer(a)).customerId).toBe('cus_fake_0001');
    expect((await setupCustomer(b)).setup.ref).toBe('seti_fake_0001');
  });

  it('runs the hold lifecycle: setup → hold → capture, with webhook-driven state', async () => {
    const p = new FakeProvider({ now: () => NOW });
    const { customerId } = await setupCustomer(p);
    const hold = await p.createDepositHold({ customerId, amount: EUR5, mode: 'hold', paymentMethodId: 'pm_card_visa', methodTypes: ['card'], idempotencyKey: 'deposit:g1:u1:hold', metadata: meta('hold') });
    expect(hold.status).toBe('requires_capture');
    const captured = await p.captureDeposit({ ref: hold.ref, idempotencyKey: 'deposit:g1:u1:capture' });
    expect(captured.amountReceived).toEqual(EUR5);

    let row: PaymentRowState = { status: 'requires_payment_method', depositState: 'setup', step: 'hold' };
    const events = p.drainEvents().filter((e) => e.ref === hold.ref);
    for (const e of events) row = applyPaymentEvent(row, e);
    expect(row).toMatchObject({ status: 'succeeded', depositState: 'forfeited' });
  });

  it('is idempotent and rejects key reuse with different parameters', async () => {
    const p = new FakeProvider({ now: () => NOW });
    const { customerId } = await setupCustomer(p);
    const input = { customerId, amount: EUR5, mode: 'hold' as const, paymentMethodId: 'pm_card_visa', methodTypes: ['card'], idempotencyKey: 'k', metadata: meta('hold') };
    const a = await p.createDepositHold(input);
    const b = await p.createDepositHold(input);
    expect(b.ref).toBe(a.ref);
    expect(p.intents.size).toBe(1);
    await expect(p.createDepositHold({ ...input, amount: { amountMinor: 900, currency: 'EUR' } })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('declines off-session with the declined test method', async () => {
    const p = new FakeProvider({ now: () => NOW });
    const { customerId } = await setupCustomer(p);
    const r = await p.createDepositHold({ customerId, amount: EUR5, mode: 'hold', paymentMethodId: FAKE_DECLINED_PM, methodTypes: ['card'], idempotencyKey: 'k', metadata: meta('hold') });
    expect(r).toMatchObject({ status: 'failed', failureCode: 'card_declined' });
  });

  it('charge-and-refund: payer confirms, release refunds in full', async () => {
    const p = new FakeProvider({ now: () => NOW });
    const { customerId } = await p.createCustomer({ userId: 'u1', idempotencyKey: 'c' });
    const charge = await p.createDepositHold({ customerId, amount: EUR5, mode: 'charge_refund', paymentMethodId: null, methodTypes: ['ideal'], idempotencyKey: 'ch', metadata: meta('charge') });
    expect(charge.clientSecret).toMatch(/secret/);
    p.confirmCharge(charge.ref);
    const released = await p.releaseDeposit({ ref: charge.ref, idempotencyKey: 'rel' });
    expect(released).toMatchObject({ kind: 'refunded', refund: { amount: EUR5 } });
    // Releasing again returns the cached result (no second refund).
    await p.releaseDeposit({ ref: charge.ref, idempotencyKey: 'rel' });
    expect(p.intents.get(charge.ref)?.refunded).toBe(500);
  });

  it('cancels a hold on release and cannot capture afterwards', async () => {
    const p = new FakeProvider({ now: () => NOW });
    const { customerId } = await setupCustomer(p);
    const hold = await p.createDepositHold({ customerId, amount: EUR5, mode: 'hold', paymentMethodId: 'pm_card_visa', methodTypes: ['card'], idempotencyKey: 'h', metadata: meta('hold') });
    await expect(p.releaseDeposit({ ref: hold.ref, idempotencyKey: 'r' })).resolves.toMatchObject({ kind: 'canceled' });
    await expect(p.captureDeposit({ ref: hold.ref, idempotencyKey: 'c' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('simulates outages', async () => {
    const p = new FakeProvider({ now: () => NOW });
    p.failNext('createCustomer');
    await expect(p.createCustomer({ userId: 'u', idempotencyKey: 'x' })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(p.createCustomer({ userId: 'u', idempotencyKey: 'x' })).resolves.toMatchObject({ customerId: 'cus_fake_0001' });
  });

  it('signs and verifies webhooks; rejects tampering and stale timestamps', async () => {
    let now = NOW;
    const p = new FakeProvider({ now: () => now, webhookSecret: 'whsec_test' });
    await setupCustomer(p);
    const [event] = p.drainEvents();
    expect(event).toBeDefined();
    const signed = await p.signWebhook(event!);
    await expect(p.parseWebhook(signed)).resolves.toEqual(event);
    await expect(p.parseWebhook({ ...signed, rawBody: signed.rawBody.replace('setup', 'setop') })).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(p.parseWebhook({ rawBody: signed.rawBody, headers: new Headers({ [FAKE_SIGNATURE_HEADER]: 'nope' }) })).rejects.toBeInstanceOf(WebhookSignatureError);
    now = NOW + 10 * 60_000;
    await expect(p.parseWebhook(signed)).rejects.toThrow(/tolerance/);
    const other = new FakeProvider({ now: () => NOW, webhookSecret: 'whsec_other' });
    await expect(other.parseWebhook(await p.signWebhook(event!, NOW))).rejects.toThrow(/invalid signature/);
  });

  it('retrieves completed setups', async () => {
    const p = new FakeProvider({ now: () => NOW });
    const { customerId, setup } = await setupCustomer(p);
    await expect(p.retrieveSetup(setup.ref)).resolves.toEqual({ ref: setup.ref, status: 'succeeded', customerId, paymentMethodId: 'pm_card_visa' });
    await expect(p.retrieveSetup('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('detaches payment methods', async () => {
    const p = new FakeProvider({ now: () => NOW });
    const { customerId } = await setupCustomer(p);
    await expect(p.detachPaymentMethods(customerId)).resolves.toBe(1);
    await expect(p.detachPaymentMethods(customerId)).resolves.toBe(0);
  });
});
