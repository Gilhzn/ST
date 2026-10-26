/**
 * Locale-aware formatting (design §14.8: numbers and dates always come from Intl).
 * Values meant to sit inside translated sentences are passed through ICU params;
 * isolate them with `isolate()` from @st/ui where direction matters.
 */
import type { CurrencyCode } from '@st/domain';

const DAY = 24 * 60 * 60 * 1000;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Intl wants BCP-47; our zh locales are already script tags. */
function tag(locale: string): string {
  return locale || 'en';
}

export function formatTime(iso: string, locale: string): string {
  return safe(() => new Intl.DateTimeFormat(tag(locale), { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)), iso.slice(11, 16));
}

export function formatDate(iso: string, locale: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return safe(() => new Intl.DateTimeFormat(tag(locale), opts).format(new Date(iso)), iso.slice(0, 10));
}

export function formatDateTime(iso: string, locale: string): string {
  return safe(
    () => new Intl.DateTimeFormat(tag(locale), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)),
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
    return safe(() => new Intl.RelativeTimeFormat(tag(locale), { numeric: 'auto' }).format(diff, 'day'), formatDate(iso, locale));
  }
  return formatDate(iso, locale);
}

/** "in 45 minutes" / "2 hours ago" — always shown next to an absolute time on details screens. */
export function formatRelative(iso: string, locale: string, now: number = Date.now()): string {
  const deltaMin = Math.round((Date.parse(iso) - now) / 60_000);
  const rtf = (v: number, u: Intl.RelativeTimeFormatUnit) =>
    safe(() => new Intl.RelativeTimeFormat(tag(locale), { numeric: 'auto' }).format(v, u), '');
  if (Math.abs(deltaMin) < 60) return rtf(deltaMin, 'minute');
  if (Math.abs(deltaMin) < 48 * 60) return rtf(Math.round(deltaMin / 60), 'hour');
  return rtf(Math.round(deltaMin / (24 * 60)), 'day');
}

export function formatNumber(n: number, locale: string, opts?: Intl.NumberFormatOptions): string {
  return safe(() => new Intl.NumberFormat(tag(locale), opts).format(n), String(n));
}

export function formatPercent(fraction: number, locale: string): string {
  return formatNumber(fraction, locale, { style: 'percent', maximumFractionDigits: 0 });
}

const MILES_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

export function usesMiles(region: string | null | undefined): boolean {
  return !!region && MILES_REGIONS.has(region.toUpperCase());
}

/** "1.2 km" / "800 m" / "0.7 mi" with unit names localized by Intl. */
export function formatDistance(meters: number, locale: string, miles = false): string {
  if (miles) {
    return formatNumber(meters / 1609.344, locale, { style: 'unit', unit: 'mile', unitDisplay: 'short', maximumFractionDigits: 1 });
  }
  if (meters < 1000) {
    return formatNumber(Math.round(meters / 10) * 10, locale, { style: 'unit', unit: 'meter', unitDisplay: 'short' });
  }
  return formatNumber(meters / 1000, locale, { style: 'unit', unit: 'kilometer', unitDisplay: 'short', maximumFractionDigits: meters < 10_000 ? 1 : 0 });
}

export function formatKm(km: number, locale: string, miles = false): string {
  return formatDistance(km * 1000, locale, miles);
}

/** Minor units → localized currency ("₪20", "¥1,000"); exponent from Intl (JPY 0, KWD 3). */
export function currencyDigits(currency: CurrencyCode, locale = 'en'): number {
  return safe(() => new Intl.NumberFormat(tag(locale), { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2, 2);
}

export function formatMoney(amountMinor: number, currency: CurrencyCode, locale: string): string {
  const digits = currencyDigits(currency, locale);
  const value = amountMinor / 10 ** digits;
  return safe(
    () =>
      new Intl.NumberFormat(tag(locale), {
        style: 'currency',
        currency,
        minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
        maximumFractionDigits: digits,
      }).format(value),
    `${value} ${currency}`,
  );
}

/** "1 hr 30 min" via Intl unit formatting. */
export function formatDuration(minutes: number, locale: string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (h) parts.push(formatNumber(h, locale, { style: 'unit', unit: 'hour', unitDisplay: 'short' }));
  if (m || !h) parts.push(formatNumber(m, locale, { style: 'unit', unit: 'minute', unitDisplay: 'short' }));
  return safe(() => new Intl.ListFormat(tag(locale), { type: 'unit', style: 'narrow' }).format(parts), parts.join(' '));
}

/** Countdown "0:30" (LTR digits; isolate when embedding). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Localized list ("football, tennis and padel"); never join translated strings by hand. */
export function formatList(items: readonly string[], locale: string, type: 'conjunction' | 'unit' = 'unit'): string {
  const list = items.filter(Boolean);
  return safe(() => new Intl.ListFormat(tag(locale), { type, style: type === 'unit' ? 'narrow' : 'long' }).format(list), list.join(', '));
}
