import { describe, expect, it, vi } from 'vitest';
import { normalizeStripeEvent, StripeProvider, type StripeClientLike, type StripePaymentIntentLike } from '../src/stripe';
import { WebhookSignatureError, type PaymentMetadata } from '../src/port';

const meta: PaymentMetadata = { paymentId: 'p1', userId: 'u1', gameId: 'g1', step: 'hold' };

function pi(over: Partial<StripePaymentIntentLike> = {}): StripePaymentIntentLike {
  return { id: 'pi_1', status: 'requires_capture', client_secret: 'pi_1_secret', amount: 500, amount_received: 0, currency: 'eur', ...over } as StripePaymentIntentLike;
}

function mockClient() {
  return {
    customers: {
      create: vi.fn(async () => ({ id: 'cus_1' })),
      listPaymentMethods: vi.fn(),
    },
    setupIntents: {
      create: vi.fn(async () => ({ id: 'seti_1', status: 'requires_payment_method', client_secret: 'seti_1_secret', payment_method: null })),
      retrieve: vi.fn(async () => ({ id: 'seti_1', status: 'succeeded', client_secret: null, payment_method: { id: 'pm_1' }, customer: 'cus_1' })),
    },
    paymentIntents: {
      create: vi.fn(async () => pi()),
      capture: vi.fn(async () => pi({ status: 'succeeded', amount_received: 500 })),
      cancel: vi.fn(async () => pi({ status: 'canceled' })),
      retrieve: vi.fn(async () => pi()),
    },
    refunds: { create: vi.fn(async () => ({ id: 're_1', status: 'succeeded', amount: 500, currency: 'eur', payment_intent: 'pi_1' })) },
    paymentMethods: { detach: vi.fn(async (id: string) => ({ id })) },
    webhooks: { constructEventAsync: vi.fn() },
  } satisfies StripeClientLike;
}

describe('StripeProvider', () => {
  it('creates a pseudonymous customer with an idempotency key', async () => {
    const client = mockClient();
    const p = new StripeProvider({ client });
    await expect(p.createCustomer({ userId: 'u1', idempotencyKey: 'k1' })).resolves.toEqual({ customerId: 'cus_1' });
    expect(client.customers.create).toHaveBeenCalledWith({ metadata: { st_user_id: 'u1' } }, { idempotencyKey: 'k1' });
  });

  it('creates an off-session SetupIntent', async () => {
    const client = mockClient();
    const r = await new StripeProvider({ client }).createSetup({ customerId: 'cus_1', methodTypes: ['card'], idempotencyKey: 'k', metadata: { ...meta, step: 'setup' } });
    expect(r).toEqual({ ref: 'seti_1', clientSecret: 'seti_1_secret', status: 'requires_payment_method', paymentMethodId: null });
    expect(client.setupIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', usage: 'off_session', allowed_payment_method_types: ['card'] }),
      { idempotencyKey: 'k' },
    );
  });

  it('places a manual-capture off-session hold in minor units', async () => {
    const client = mockClient();
    const r = await new StripeProvider({ client }).createDepositHold({
      customerId: 'cus_1', amount: { amountMinor: 500, currency: 'EUR' }, mode: 'hold', paymentMethodId: 'pm_1',
      methodTypes: ['card'], idempotencyKey: 'deposit:g1:u1:hold', metadata: meta, descriptorSuffix: 'ST-Game #42!',
    });
    expect(r.status).toBe('requires_capture');
    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, currency: 'eur', capture_method: 'manual', confirm: true, off_session: true, payment_method: 'pm_1', statement_descriptor_suffix: 'STGame 42' }),
      { idempotencyKey: 'deposit:g1:u1:hold' },
    );
  });

  it('handles zero-decimal currencies (JPY is not multiplied)', async () => {
    const client = mockClient();
    client.paymentIntents.create.mockResolvedValueOnce(pi({ amount: 1000, currency: 'jpy' }));
    const r = await new StripeProvider({ client }).createDepositHold({
      customerId: 'cus_1', amount: { amountMinor: 1000, currency: 'JPY' }, mode: 'hold', paymentMethodId: 'pm_1', methodTypes: ['card'], idempotencyKey: 'k', metadata: meta,
    });
    expect(client.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000, currency: 'jpy' }), expect.anything());
    expect(r.amount).toEqual({ amountMinor: 1000, currency: 'JPY' });
  });

  it('charge-and-refund creates an automatic-capture intent the payer confirms', async () => {
    const client = mockClient();
    client.paymentIntents.create.mockResolvedValueOnce(pi({ status: 'requires_payment_method' }));
    const r = await new StripeProvider({ client }).createDepositHold({
      customerId: 'cus_1', amount: { amountMinor: 500, currency: 'EUR' }, mode: 'charge_refund', paymentMethodId: null, methodTypes: ['ideal'], idempotencyKey: 'k', metadata: { ...meta, step: 'charge' },
    });
    expect(r.clientSecret).toBe('pi_1_secret');
    const params = (client.paymentIntents.create.mock.calls as unknown as [Record<string, unknown>][])[0]?.[0];
    expect(params).toMatchObject({ capture_method: 'automatic', allowed_payment_method_types: ['ideal'] });
    expect(params).not.toHaveProperty('off_session');
  });

  it('requires a saved method for holds', async () => {
    await expect(
      new StripeProvider({ client: mockClient() }).createDepositHold({ customerId: 'c', amount: { amountMinor: 500, currency: 'EUR' }, mode: 'hold', paymentMethodId: null, methodTypes: ['card'], idempotencyKey: 'k', metadata: meta }),
    ).rejects.toMatchObject({ code: 'payment_required' });
  });

  it('returns off-session declines as a failed intent (TRUST-064), maps other errors to StError', async () => {
    const client = mockClient();
    client.paymentIntents.create.mockRejectedValueOnce({ type: 'StripeCardError', code: 'authentication_required', payment_intent: pi({ status: 'requires_payment_method' }) });
    const p = new StripeProvider({ client });
    const input = { customerId: 'c', amount: { amountMinor: 500, currency: 'EUR' }, mode: 'hold' as const, paymentMethodId: 'pm', methodTypes: ['card'], idempotencyKey: 'k', metadata: meta };
    await expect(p.createDepositHold(input)).resolves.toMatchObject({ status: 'failed', failureCode: 'authentication_required', ref: 'pi_1' });
    client.paymentIntents.create.mockRejectedValueOnce({ type: 'StripeAPIError' });
    await expect(p.createDepositHold(input)).rejects.toMatchObject({ name: 'StError', code: 'unavailable' });
    client.paymentIntents.create.mockRejectedValueOnce({ type: 'StripeIdempotencyError' });
    await expect(p.createDepositHold(input)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('captures, and releases by cancel (hold) or refund (charge)', async () => {
    const client = mockClient();
    const p = new StripeProvider({ client });
    await expect(p.captureDeposit({ ref: 'pi_1', idempotencyKey: 'cap' })).resolves.toMatchObject({ status: 'succeeded', amountReceived: { amountMinor: 500 } });
    expect(client.paymentIntents.capture).toHaveBeenCalledWith('pi_1', {}, { idempotencyKey: 'cap' });

    await expect(p.releaseDeposit({ ref: 'pi_1', idempotencyKey: 'rel' })).resolves.toMatchObject({ kind: 'canceled' });
    expect(client.paymentIntents.cancel).toHaveBeenCalledWith('pi_1', { cancellation_reason: 'requested_by_customer' }, { idempotencyKey: 'rel:cancel' });

    client.paymentIntents.retrieve.mockResolvedValueOnce(pi({ status: 'succeeded', amount_received: 500 }));
    await expect(p.releaseDeposit({ ref: 'pi_1', idempotencyKey: 'rel' })).resolves.toMatchObject({ kind: 'refunded', refund: { status: 'succeeded' } });
    expect(client.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_1' }), { idempotencyKey: 'rel:refund' });

    client.paymentIntents.retrieve.mockResolvedValueOnce(pi({ status: 'canceled' }));
    await expect(p.releaseDeposit({ ref: 'pi_1', idempotencyKey: 'rel' })).resolves.toMatchObject({ kind: 'noop' });
    client.paymentIntents.retrieve.mockResolvedValueOnce(pi({ status: 'processing' }));
    await expect(p.releaseDeposit({ ref: 'pi_1', idempotencyKey: 'rel' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('retrieves the saved method and customer of a setup', async () => {
    await expect(new StripeProvider({ client: mockClient() }).retrieveSetup('seti_1')).resolves.toEqual({ ref: 'seti_1', status: 'succeeded', customerId: 'cus_1', paymentMethodId: 'pm_1' });
  });

  it('detaches every saved method', async () => {
    const client = mockClient();
    client.customers.listPaymentMethods
      .mockResolvedValueOnce({ data: [{ id: 'pm_1' }, { id: 'pm_2' }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: 'pm_3' }], has_more: false });
    await expect(new StripeProvider({ client }).detachPaymentMethods('cus_1')).resolves.toBe(3);
    expect(client.paymentMethods.detach).toHaveBeenCalledTimes(3);
  });

  it('Pro checkout is a stub', async () => {
    await expect(new StripeProvider({ client: mockClient() }).createCheckout({ customerId: 'c', priceId: 'p', successUrl: 's', cancelUrl: 'c', idempotencyKey: 'k' })).rejects.toThrow(/later phase/);
  });

  it('verifies webhook signatures through the SDK and rejects bad ones', async () => {
    const client = mockClient();
    const p = new StripeProvider({ client, webhookSecret: 'whsec_x' });
    const headers = new Headers({ 'stripe-signature': 't=1,v1=abc' });
    client.webhooks.constructEventAsync.mockRejectedValueOnce(new Error('No signatures found'));
    await expect(p.parseWebhook({ rawBody: '{}', headers })).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(p.parseWebhook({ rawBody: '{}', headers: new Headers() })).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(new StripeProvider({ client }).parseWebhook({ rawBody: '{}', headers })).rejects.toBeInstanceOf(WebhookSignatureError);

    client.webhooks.constructEventAsync.mockResolvedValueOnce({
      id: 'evt_1', type: 'payment_intent.amount_capturable_updated', created: 1_800_000_000,
      data: { object: { id: 'pi_1', status: 'requires_capture', amount: 500, amount_received: 0, currency: 'eur', metadata: { st_payment_id: 'p1', st_step: 'hold' } } },
    });
    await expect(p.parseWebhook({ rawBody: '{"x":1}', headers })).resolves.toMatchObject({
      id: 'evt_1', type: 'hold_authorized', ref: 'pi_1', status: 'requires_capture', amount: { amountMinor: 500, currency: 'EUR' }, metadata: { paymentId: 'p1', step: 'hold' },
    });
    expect(client.webhooks.constructEventAsync).toHaveBeenLastCalledWith('{"x":1}', 't=1,v1=abc', 'whsec_x', 300);
  });
});

describe('normalizeStripeEvent', () => {
  it('maps failures, refunds, disputes and unknown events', () => {
    expect(normalizeStripeEvent({ id: 'e', type: 'payment_intent.payment_failed', created: 0, data: { object: { id: 'pi_1', status: 'requires_payment_method', currency: 'eur', amount: 500, last_payment_error: { code: 'card_declined', payment_method: { type: 'card' } } } } }))
      .toMatchObject({ type: 'payment_failed', status: 'failed', failureCode: 'card_declined', paymentMethodType: 'card' });
    expect(normalizeStripeEvent({ id: 'e', type: 'charge.refunded', created: 0, data: { object: { id: 'ch_1', payment_intent: 'pi_1', currency: 'jpy', amount: 1000, amount_captured: 1000, amount_refunded: 1000 } } }))
      .toMatchObject({ type: 'refund_updated', ref: 'pi_1', amountRefunded: { amountMinor: 1000, currency: 'JPY' } });
    expect(normalizeStripeEvent({ id: 'e', type: 'charge.dispute.created', created: 0, data: { object: { id: 'dp_1', payment_intent: 'pi_1', currency: 'eur', amount: 500 } } }))
      .toMatchObject({ type: 'dispute_opened', ref: 'pi_1' });
    expect(normalizeStripeEvent({ id: 'e', type: 'setup_intent.succeeded', created: 0, data: { object: { id: 'seti_1', status: 'succeeded', payment_method: 'pm_1' } } }))
      .toMatchObject({ type: 'setup_succeeded', ref: 'seti_1', paymentMethodId: 'pm_1' });
    expect(normalizeStripeEvent({ id: 'e', type: 'customer.created', created: 0, data: { object: { id: 'cus_1' } } })).toMatchObject({ type: 'ignored' });
  });
});
