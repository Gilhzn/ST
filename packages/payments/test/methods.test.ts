import { describe, expect, it } from 'vitest';
import { capabilityOf, depositMethodsFor, depositModeFor, routeFor, stripeMethodTypesFor } from '../src/methods';

const types = (q: Parameters<typeof depositMethodsFor>[0]) => depositMethodsFor(q).map((m) => m.type);

describe('method capability matrix', () => {
  it('only cards and wallets can hold', () => {
    expect(depositModeFor('card')).toBe('hold');
    expect(depositModeFor('apple_pay')).toBe('hold');
    expect(depositModeFor('google_pay')).toBe('hold');
    for (const t of ['ideal', 'pix', 'upi', 'bit', 'blik', 'bancontact'] as const) {
      expect(capabilityOf(t)?.canHold).toBe(false);
      expect(depositModeFor(t)).toBe('charge_refund');
    }
  });

  it('offers local methods only in their country and currency', () => {
    expect(types({ country: 'NL', currency: 'EUR' })).toEqual(expect.arrayContaining(['card', 'ideal']));
    expect(types({ country: 'DE', currency: 'EUR' })).not.toContain('ideal');
    expect(types({ country: 'NL', currency: 'USD' })).not.toContain('ideal');
    expect(types({ country: 'BR', currency: 'BRL' })).toContain('pix');
  });

  it('never offers SEPA or cash vouchers for deposits', () => {
    expect(types({ country: 'DE', currency: 'EUR' })).not.toContain('sepa_debit');
    expect(types({ country: 'MX', currency: 'MXN' })).not.toContain('oxxo');
    expect(types({ country: 'JP', currency: 'JPY' })).not.toContain('konbini');
  });

  it('hides planned providers unless asked', () => {
    expect(types({ country: 'IL', currency: 'ILS' })).not.toContain('bit');
    expect(types({ country: 'IL', currency: 'ILS', includePlanned: true })).toContain('bit');
    expect(types({ country: 'IN', currency: 'INR', includePlanned: true })).toContain('upi');
  });

  it('routes Israeli cards and Bit to the local PSP', () => {
    expect(routeFor('card', 'IL')).toBe('payplus');
    expect(routeFor('bit', 'IL')).toBe('payplus');
    expect(routeFor('card', 'NL')).toBe('stripe');
    expect(routeFor('upi', 'IN')).toBe('razorpay');
    expect(routeFor('link', 'IL')).toBe('stripe');
  });

  it('builds Stripe method lists per mode (wallets ride on card)', () => {
    expect(stripeMethodTypesFor({ country: 'NL', currency: 'EUR' }, 'hold')).toEqual(['card', 'link']);
    expect(stripeMethodTypesFor({ country: 'NL', currency: 'EUR' }, 'charge_refund')).toEqual(expect.arrayContaining(['ideal']));
    expect(stripeMethodTypesFor({ country: null, currency: 'EUR' }, 'hold')).toEqual(['card']);
  });
});
