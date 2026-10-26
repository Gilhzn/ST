/**
 * Money helpers. Every amount in Sport Talent is an integer in the currency's
 * ISO 4217 minor unit (`Money.amountMinor`). Providers disagree with ISO for a
 * handful of currencies, so conversion to a provider's wire amount lives here
 * and nowhere else.
 */
import { StError, type CurrencyCode, type Money } from '@st/domain';

/** ISO 4217 currencies with no minor unit (exponent 0). */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** ISO 4217 currencies with three decimals (exponent 3). */
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/**
 * Currencies Stripe treats as zero-decimal: the wire `amount` is in major units.
 * https://docs.stripe.com/currencies#zero-decimal
 * `ISK` is deliberately absent: Stripe keeps it two-decimal for backwards
 * compatibility (amount × 100, must be divisible by 100).
 */
const STRIPE_ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

const CURRENCY_RE = /^[A-Z]{3}$/;

/** True for a syntactically valid ISO 4217 code (upper case). */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCY_RE.test(value);
}

/** Number of decimals of the ISO minor unit (0, 2 or 3). */
export function currencyExponent(currency: CurrencyCode): 0 | 2 | 3 {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** True when the currency has no minor unit (e.g. JPY, KRW). */
export function isZeroDecimal(currency: CurrencyCode): boolean {
  return currencyExponent(currency) === 0;
}

/** Validates a {@link Money} value; throws `StError('validation')` otherwise. */
export function assertMoney(money: Money): void {
  if (!isCurrencyCode(money.currency)) {
    throw new StError('validation', 'invalid currency', { field: 'currency' });
  }
  if (!Number.isSafeInteger(money.amountMinor) || money.amountMinor < 0) {
    throw new StError('validation', 'amount must be a non-negative integer in minor units', { field: 'amountMinor' });
  }
}

/** Builds a {@link Money} from a decimal major-unit amount (e.g. `5.5` EUR → 550). Rounds half away from zero. */
export function fromMajor(major: number, currency: CurrencyCode): Money {
  const factor = 10 ** currencyExponent(currency);
  const amountMinor = Math.sign(major) * Math.round(Math.abs(major) * factor);
  const money = { amountMinor, currency: currency.toUpperCase() };
  assertMoney(money);
  return money;
}

/** Major-unit number for display only (never for arithmetic on money). */
export function toMajor(money: Money): number {
  return money.amountMinor / 10 ** currencyExponent(money.currency);
}

/**
 * Converts our ISO minor-unit amount to Stripe's wire `amount`.
 * - ISO zero-decimal currencies that Stripe also treats as zero-decimal: identical.
 * - `ISK` (ISO 0, Stripe 2): × 100.
 * - `MGA` (ISO 2 in our table, Stripe 0): ÷ 100, must be whole.
 * - Three-decimal currencies: identical, but Stripe requires the last digit to be 0.
 */
export function toStripeAmount(money: Money): number {
  assertMoney(money);
  const c = money.currency.toUpperCase();
  const isoExp = currencyExponent(c);
  const stripeExp = STRIPE_ZERO_DECIMAL.has(c) ? 0 : isoExp === 3 ? 3 : 2;
  if (isoExp === 3 && money.amountMinor % 10 !== 0) {
    throw new StError('validation', 'three-decimal amounts must end in 0 for Stripe', { currency: c });
  }
  if (stripeExp === isoExp) return money.amountMinor;
  if (stripeExp > isoExp) return money.amountMinor * 10 ** (stripeExp - isoExp);
  const divisor = 10 ** (isoExp - stripeExp);
  if (money.amountMinor % divisor !== 0) {
    throw new StError('validation', 'amount not representable for this currency at Stripe', { currency: c });
  }
  return money.amountMinor / divisor;
}

/** Inverse of {@link toStripeAmount}. `currency` may be Stripe's lower-case code. */
export function fromStripeAmount(amount: number, currency: string): Money {
  const c = currency.toUpperCase();
  const isoExp = currencyExponent(c);
  const stripeExp = STRIPE_ZERO_DECIMAL.has(c) ? 0 : isoExp === 3 ? 3 : 2;
  const amountMinor =
    stripeExp === isoExp
      ? amount
      : stripeExp > isoExp
        ? Math.round(amount / 10 ** (stripeExp - isoExp))
        : amount * 10 ** (isoExp - stripeExp);
  return { amountMinor, currency: c };
}

/** Equality on currency and amount. */
export function sameMoney(a: Money, b: Money): boolean {
  return a.amountMinor === b.amountMinor && a.currency.toUpperCase() === b.currency.toUpperCase();
}
