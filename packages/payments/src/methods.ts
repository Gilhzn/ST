/**
 * Payment-method capability matrix (PRD v5 §8.3, MON-010…012).
 *
 * The only question that matters for deposits is `canHold`: card networks and
 * card-backed wallets support a manual-capture authorisation ("hold"); push
 * methods (iDEAL, Pix, UPI, Bit, BLIK, Bancontact, Alipay, WeChat Pay…) move
 * money immediately, so a deposit paid with them is charged and refunded
 * ("charge-and-refund", TRUST-062). Debit methods with multi-day settlement
 * (SEPA) and cash vouchers (OXXO, Konbini) are never offered for deposits.
 */
import type { CountryCode, CurrencyCode, PaymentProviderId } from '@st/domain';

/** Payment method types we know about (Stripe `payment_method_types` vocabulary, plus local PSP methods). */
export type PaymentMethodType =
  | 'card'
  | 'apple_pay'
  | 'google_pay'
  | 'link'
  | 'sepa_debit'
  | 'ideal'
  | 'bancontact'
  | 'blik'
  | 'pix'
  | 'upi'
  | 'bit'
  | 'alipay'
  | 'wechat_pay'
  | 'oxxo'
  | 'konbini';

/** How a deposit is secured with a given method. */
export type DepositMode =
  /** Manual-capture authorisation placed at T−24h; released or captured later. */
  | 'hold'
  /** Charged with the customer present (at join/approval); refunded on attendance. */
  | 'charge_refund';

/** Which adapter processes the method. Local PSPs implement the same port. */
export type MethodRoute = Extract<PaymentProviderId, 'stripe' | 'payplus'> | 'razorpay';

export interface MethodCapability {
  type: PaymentMethodType;
  /** Supports a manual-capture hold (cards and card-backed wallets only, MON-011). */
  canHold: boolean;
  /** May be used for a no-show deposit at all. */
  depositEligible: boolean;
  /** Can be charged later without the customer present (saved via SetupIntent). */
  offSessionReusable: boolean;
  /** Provider that processes it. */
  route: MethodRoute;
  /** `'*'` or the list of buyer countries where it is offered. */
  countries: '*' | readonly CountryCode[];
  /** `'*'` or the list of currencies it can settle in. */
  currencies: '*' | readonly CurrencyCode[];
  /** Typical maximum business days for a refund to reach the payer (shown before joining, TRUST-062). */
  refundDaysMax: number;
  /** `planned` methods are modelled but not yet available (provider not contracted). */
  availability: 'live' | 'planned';
}

const EU_EEA = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT',
  'LI', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'] as const;

/**
 * The matrix. Order is the display order (most preferred first). Card-network
 * routing per country (e.g. Israeli cards through the local PSP) is decided by
 * {@link routeFor}, not by duplicating rows.
 */
export const METHOD_CAPABILITIES: readonly MethodCapability[] = [
  { type: 'card', canHold: true, depositEligible: true, offSessionReusable: true, route: 'stripe', countries: '*', currencies: '*', refundDaysMax: 10, availability: 'live' },
  { type: 'apple_pay', canHold: true, depositEligible: true, offSessionReusable: true, route: 'stripe', countries: '*', currencies: '*', refundDaysMax: 10, availability: 'live' },
  { type: 'google_pay', canHold: true, depositEligible: true, offSessionReusable: true, route: 'stripe', countries: '*', currencies: '*', refundDaysMax: 10, availability: 'live' },
  { type: 'link', canHold: true, depositEligible: true, offSessionReusable: true, route: 'stripe', countries: [...EU_EEA, 'US', 'GB', 'CA', 'AU', 'NZ', 'SG', 'HK', 'JP', 'MX', 'CH'], currencies: '*', refundDaysMax: 10, availability: 'live' },
  { type: 'ideal', canHold: false, depositEligible: true, offSessionReusable: false, route: 'stripe', countries: ['NL'], currencies: ['EUR'], refundDaysMax: 5, availability: 'live' },
  { type: 'bancontact', canHold: false, depositEligible: true, offSessionReusable: false, route: 'stripe', countries: ['BE'], currencies: ['EUR'], refundDaysMax: 5, availability: 'live' },
  { type: 'blik', canHold: false, depositEligible: true, offSessionReusable: false, route: 'stripe', countries: ['PL'], currencies: ['PLN'], refundDaysMax: 5, availability: 'live' },
  { type: 'pix', canHold: false, depositEligible: true, offSessionReusable: false, route: 'stripe', countries: ['BR'], currencies: ['BRL'], refundDaysMax: 3, availability: 'live' },
  { type: 'alipay', canHold: false, depositEligible: true, offSessionReusable: false, route: 'stripe', countries: ['CN', 'HK', 'JP', 'SG', ...EU_EEA, 'GB', 'US'], currencies: ['CNY', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD', 'USD', 'AUD', 'CAD', 'NZD', 'MYR'], refundDaysMax: 7, availability: 'live' },
  { type: 'wechat_pay', canHold: false, depositEligible: true, offSessionReusable: false, route: 'stripe', countries: ['CN', 'HK', 'JP', 'SG', ...EU_EEA, 'GB', 'US'], currencies: ['CNY', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD', 'USD', 'AUD', 'CAD'], refundDaysMax: 7, availability: 'live' },
  { type: 'bit', canHold: false, depositEligible: true, offSessionReusable: false, route: 'payplus', countries: ['IL'], currencies: ['ILS'], refundDaysMax: 5, availability: 'planned' },
  { type: 'upi', canHold: false, depositEligible: true, offSessionReusable: false, route: 'razorpay', countries: ['IN'], currencies: ['INR'], refundDaysMax: 7, availability: 'planned' },
  // Never for deposits: SEPA settles in days and can be reversed for 8 weeks; vouchers are cash.
  { type: 'sepa_debit', canHold: false, depositEligible: false, offSessionReusable: true, route: 'stripe', countries: EU_EEA, currencies: ['EUR'], refundDaysMax: 10, availability: 'live' },
  { type: 'oxxo', canHold: false, depositEligible: false, offSessionReusable: false, route: 'stripe', countries: ['MX'], currencies: ['MXN'], refundDaysMax: 10, availability: 'live' },
  { type: 'konbini', canHold: false, depositEligible: false, offSessionReusable: false, route: 'stripe', countries: ['JP'], currencies: ['JPY'], refundDaysMax: 10, availability: 'live' },
];

const BY_TYPE = new Map(METHOD_CAPABILITIES.map((m) => [m.type, m] as const));

/** Capability row for a method, or `undefined` for unknown strings (e.g. from a webhook). */
export function capabilityOf(type: string): MethodCapability | undefined {
  return BY_TYPE.get(type as PaymentMethodType);
}

/** True when `type` is a method we model. */
export function isPaymentMethodType(type: unknown): type is PaymentMethodType {
  return typeof type === 'string' && BY_TYPE.has(type as PaymentMethodType);
}

function matches(list: '*' | readonly string[], value: string | null): boolean {
  return list === '*' || (value !== null && list.includes(value.toUpperCase()));
}

/**
 * Card traffic for buyers in these countries is routed to a local PSP: Stripe
 * does not onboard Israeli merchants (MON-002). The UI and `create-deposit`
 * use this to pick the adapter.
 */
const LOCAL_CARD_ROUTES: Readonly<Record<string, MethodRoute>> = { IL: 'payplus' };

/** Adapter that processes `type` for a buyer in `country`. */
export function routeFor(type: PaymentMethodType, country: CountryCode | null): MethodRoute {
  const cap = BY_TYPE.get(type);
  if (!cap) return 'stripe';
  const holdable = cap.canHold && (type === 'card' || type === 'apple_pay' || type === 'google_pay');
  const local = country ? LOCAL_CARD_ROUTES[country.toUpperCase()] : undefined;
  return holdable && local ? local : cap.route;
}

export interface MethodQuery {
  /** Buyer country, if known. `null` offers only globally available methods. */
  country: CountryCode | null;
  /** Game currency (deposits are always in the game currency). */
  currency: CurrencyCode;
  /** Include methods whose provider is not live yet (default false). */
  includePlanned?: boolean;
}

/** Methods offered for a deposit to this buyer in this currency, in display order (MON-010). */
export function depositMethodsFor(q: MethodQuery): MethodCapability[] {
  return METHOD_CAPABILITIES.filter(
    (m) =>
      m.depositEligible &&
      (q.includePlanned === true || m.availability === 'live') &&
      matches(m.countries, q.country) &&
      matches(m.currencies, q.currency),
  );
}

/** Deposit mode for a method: `hold` only where a manual-capture authorisation exists. */
export function depositModeFor(type: PaymentMethodType): DepositMode {
  return BY_TYPE.get(type)?.canHold === true ? 'hold' : 'charge_refund';
}

/** Stripe `payment_method_types` for a deposit flow in a given mode. */
export function stripeMethodTypesFor(q: MethodQuery, mode: DepositMode): string[] {
  const wanted = depositMethodsFor(q).filter((m) => m.route === 'stripe' && (mode === 'hold' ? m.canHold : !m.canHold));
  // Apple Pay / Google Pay / Link ride on the `card` type at Stripe (wallets are surfaced by the Payment Element).
  const types = new Set(wanted.map((m) => (m.type === 'apple_pay' || m.type === 'google_pay' ? 'card' : m.type)));
  return [...types];
}
