import type { CountryCode, CurrencyCode } from '@st/domain';

const EURO = new Set(['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK']);
const OTHER: Record<string, CurrencyCode> = {
  IL: 'ILS', US: 'USD', GB: 'GBP', JP: 'JPY', IN: 'INR', BR: 'BRL', CA: 'CAD', AU: 'AUD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  PL: 'PLN', CZ: 'CZK', TR: 'TRY', MX: 'MXN', AR: 'ARS', CN: 'CNY', TW: 'TWD', HK: 'HKD', KR: 'KRW', SG: 'SGD', AE: 'AED', SA: 'SAR',
  ZA: 'ZAR', RU: 'RUB',
};

/** Deposit currency follows the venue's country (design §13.5). */
export function currencyForCountry(country: CountryCode | null | undefined): CurrencyCode {
  if (!country) return 'EUR';
  const c = country.toUpperCase();
  return EURO.has(c) ? 'EUR' : (OTHER[c] ?? 'USD');
}
