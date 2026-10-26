/**
 * Locale-aware formatting (design §14.8: numbers and dates always come from Intl).
 * Thin app helpers over `@st/i18n` formatters; values embedded in translated
 * sentences are passed as ICU params (wrap with `isolate()` where direction matters).
 */
import type { CurrencyCode } from '@st/domain';
import {
  formatCountdown,
  formatDate as i18nFormatDate,
  formatDateTime as i18nFormatDateTime,
  formatDistance as i18nFormatDistance,
  formatDuration as i18nFormatDuration,
  formatList as i18nFormatList,
  formatMoney as i18nFormatMoney,
  formatNumber as i18nFormatNumber,
  formatPercent as i18nFormatPercent,
  formatRelative as i18nFormatRelative,
  formatTime as i18nFormatTime,
} from '@st/i18n';

const DAY = 24 * 60 * 60 * 1000;

/** Formatting must never crash a screen (old engines may miss some Intl features). */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function formatTime(iso: string, locale: string): string {
  return safe(() => i18nFormatTime(iso, locale), iso.slice(11, 16));
}

export function formatDate(
  iso: string,
  locale: string,
  opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' },
): string {
  return safe(() => i18nFormatDate(iso, locale, opts), iso.slice(0, 10));
}

export function formatDateTime(iso: string, locale: string): string {
  return safe(
    () => i18nFormatDateTime(iso, locale, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
    iso,
  );
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "today" / "tomorrow" / "Sat 26 Oct" in the user's language. */
export function formatDay(iso: string, locale: string, now: number = Date.now()): string {
  const diff = Math.round((startOfDay(Date.parse(iso)) - startOfDay(now)) / DAY);
  if (Math.abs(diff) <= 1) {
    return safe(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(diff, 'day'), formatDate(iso, locale));
  }
  return formatDate(iso, locale);
}

/** "in 45 minutes" — always shown next to an absolute time on details screens. */
export function formatRelative(iso: string, locale: string, now: number = Date.now()): string {
  return safe(() => i18nFormatRelative(iso, locale, now), '');
}

export function formatNumber(n: number, locale: string, opts?: Intl.NumberFormatOptions): string {
  return safe(() => i18nFormatNumber(n, locale, opts), String(n));
}

export function formatPercent(fraction: number, locale: string): string {
  return safe(() => i18nFormatPercent(fraction, locale), `${Math.round(fraction * 100)}%`);
}

const MILES_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

/** Imperial distances for en-US/en-GB style regions (same km steps underneath; design §13.3). */
export function usesMiles(region: string | null | undefined): boolean {
  return !!region && MILES_REGIONS.has(region.toUpperCase());
}

export function formatDistance(meters: number, locale: string, miles = false): string {
  return safe(() => i18nFormatDistance(meters, locale, { system: miles ? 'imperial' : 'metric' }), `${Math.round(meters)} m`);
}

export function formatKm(km: number, locale: string, miles = false): string {
  return formatDistance(km * 1000, locale, miles);
}

/** Minor-unit exponent of a currency (JPY 0, KWD 3), from Intl. */
export function currencyDigits(currency: CurrencyCode, locale = 'en'): number {
  return safe(() => new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2, 2);
}

export function formatMoney(amountMinor: number, currency: CurrencyCode, locale: string): string {
  return safe(() => i18nFormatMoney(amountMinor, currency, locale), `${amountMinor} ${currency}`);
}

/** "1 hour, 30 minutes". */
export function formatDuration(minutes: number, locale: string): string {
  return safe(() => i18nFormatDuration(minutes * 60_000, locale), `${minutes} min`);
}

/** Countdown "0:30" (LTR digits; isolate when embedding). */
export function formatClock(totalSeconds: number): string {
  return formatCountdown(totalSeconds);
}

/** Localized list; never join translated strings by hand. */
export function formatList(items: readonly string[], locale: string, type: 'conjunction' | 'unit' = 'unit'): string {
  const list = items.filter(Boolean);
  return safe(() => i18nFormatList(list, locale, type), list.join(', '));
}
