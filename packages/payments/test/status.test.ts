import { describe, expect, it } from 'vitest';
import { advanceStatus, applyPaymentEvent, type PaymentRowState } from '../src/status';
import type { PaymentEvent } from '../src/port';

const ev = (type: PaymentEvent['type'], patch: Partial<PaymentEvent> = {}): PaymentEvent => ({
  id: 'evt_1', provider: 'fake', type, providerType: type, ref: 'pi_1', status: null, amount: null, amountReceived: null,
  amountRefunded: null, paymentMethodId: null, paymentMethodType: null, failureCode: null, metadata: {},
  occurredAt: '2026-11-10T00:00:00.000Z', ...patch,
});

describe('advanceStatus', () => {
  it('is monotonic and keeps terminal states', () => {
    expect(advanceStatus('requires_payment_method', 'requires_capture')).toBe('requires_capture');
    expect(advanceStatus('succeeded', 'requires_capture')).toBe('succeeded');
    expect(advanceStatus('requires_capture', 'processing')).toBe('requires_capture');
    expect(advanceStatus('canceled', 'succeeded')).toBe('canceled');
    expect(advanceStatus('failed', 'requires_capture')).toBe('requires_capture');
    expect(advanceStatus('failed', 'requires_action')).toBe('failed');
  });
});

describe('applyPaymentEvent', () => {
  const hold: PaymentRowState = { status: 'requires_payment_method', depositState: 'setup', step: 'hold' };

  it('hold authorised → held; capture → forfeited', () => {
    const a = applyPaymentEvent(hold, ev('hold_authorized'));
    expect(a).toMatchObject({ status: 'requires_capture', depositState: 'held', changed: true });
    const b = applyPaymentEvent(a, ev('payment_succeeded'));
    expect(b).toMatchObject({ status: 'succeeded', depositState: 'forfeited', notes: ['captured'] });
  });

  it('out of order: captured before authorised stays forfeited', () => {
    const a = applyPaymentEvent({ ...hold, depositState: 'held', status: 'requires_capture' }, ev('payment_succeeded'));
    const b = applyPaymentEvent(a, ev('hold_authorized'));
    expect(b).toMatchObject({ status: 'succeeded', depositState: 'forfeited', changed: false });
  });

  it('replaying an event is a no-op', () => {
    const a = applyPaymentEvent(hold, ev('hold_authorized'));
    expect(applyPaymentEvent(a, ev('hold_authorized')).changed).toBe(false);
  });

  it('cancelled hold → released; declined hold → failed with a fix-window note', () => {
    expect(applyPaymentEvent({ ...hold, status: 'requires_capture', depositState: 'held' }, ev('payment_canceled'))).toMatchObject({ depositState: 'released' });
    expect(applyPaymentEvent(hold, ev('payment_failed'))).toMatchObject({ status: 'failed', depositState: 'failed', notes: ['hold_failed'] });
  });

  it('charge-and-refund: charged → held, full refund → released', () => {
    const charge: PaymentRowState = { status: 'requires_action', depositState: 'setup', step: 'charge' };
    const a = applyPaymentEvent(charge, ev('payment_succeeded'));
    expect(a).toMatchObject({ status: 'succeeded', depositState: 'held' });
    const money = (n: number) => ({ amountMinor: n, currency: 'EUR' });
    expect(applyPaymentEvent(a, ev('refund_updated', { amountReceived: money(500), amountRefunded: money(200) })).depositState).toBe('held');
    expect(applyPaymentEvent(a, ev('refund_updated', { amountReceived: money(500), amountRefunded: money(500) }))).toMatchObject({ depositState: 'released', notes: ['refunded'] });
  });

  it('refund after capture (overturned dispute) releases a forfeited deposit', () => {
    const r = applyPaymentEvent({ status: 'succeeded', depositState: 'forfeited', step: 'hold' }, ev('refund_updated', { amountReceived: { amountMinor: 500, currency: 'EUR' }, amountRefunded: { amountMinor: 500, currency: 'EUR' } }));
    expect(r.depositState).toBe('released');
  });

  it('setup success marks the setup row ready; disputes only add a note', () => {
    expect(applyPaymentEvent({ status: 'requires_payment_method', depositState: 'setup', step: 'setup' }, ev('setup_succeeded'))).toMatchObject({ status: 'succeeded', notes: ['setup_ready'] });
    expect(applyPaymentEvent({ status: 'succeeded', depositState: 'forfeited', step: 'hold' }, ev('dispute_opened'))).toMatchObject({ changed: false, notes: ['dispute_opened'] });
  });
});
