import { describe, expect, it } from 'vitest';
import { assertMoney, currencyExponent, fromMajor, fromStripeAmount, sameMoney, toMajor, toStripeAmount } from '../src/money';

describe('money', () => {
  it('knows ISO exponents', () => {
    expect(currencyExponent('EUR')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('krw')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
  });

  it('converts major ↔ minor', () => {
    expect(fromMajor(5.5, 'EUR')).toEqual({ amountMinor: 550, currency: 'EUR' });
    expect(fromMajor(0.1 + 0.2, 'USD')).toEqual({ amountMinor: 30, currency: 'USD' });
    expect(fromMajor(500, 'JPY')).toEqual({ amountMinor: 500, currency: 'JPY' });
    expect(toMajor({ amountMinor: 1234, currency: 'ILS' })).toBe(12.34);
  });

  it('rejects invalid money', () => {
    expect(() => assertMoney({ amountMinor: 1.5, currency: 'EUR' })).toThrow(/minor units/);
    expect(() => assertMoney({ amountMinor: -1, currency: 'EUR' })).toThrow();
    expect(() => assertMoney({ amountMinor: 1, currency: 'eur' })).toThrow(/currency/);
  });

  it('maps to Stripe wire amounts, including zero-decimal and special cases', () => {
    expect(toStripeAmount({ amountMinor: 500, currency: 'EUR' })).toBe(500);
    expect(toStripeAmount({ amountMinor: 500, currency: 'JPY' })).toBe(500); // ¥500, no ×100
    expect(toStripeAmount({ amountMinor: 1000, currency: 'KRW' })).toBe(1000);
    expect(toStripeAmount({ amountMinor: 500, currency: 'ISK' })).toBe(50000); // Stripe keeps ISK two-decimal
    expect(toStripeAmount({ amountMinor: 5000, currency: 'MGA' })).toBe(50);
    expect(() => toStripeAmount({ amountMinor: 5050, currency: 'MGA' })).toThrow(/not representable/);
    expect(toStripeAmount({ amountMinor: 1230, currency: 'KWD' })).toBe(1230);
    expect(() => toStripeAmount({ amountMinor: 1235, currency: 'KWD' })).toThrow(/end in 0/);
  });

  it('round-trips from Stripe amounts', () => {
    for (const m of [
      { amountMinor: 500, currency: 'EUR' },
      { amountMinor: 500, currency: 'JPY' },
      { amountMinor: 500, currency: 'ISK' },
      { amountMinor: 5000, currency: 'MGA' },
    ]) {
      const back = fromStripeAmount(toStripeAmount(m), m.currency.toLowerCase());
      expect(sameMoney(back, m)).toBe(true);
    }
  });
});
