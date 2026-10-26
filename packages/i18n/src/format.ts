/**
 * Number, date, distance and money helpers. All of them go through `Intl` with the
 * active locale (design-system §14.8), never through hand-written patterns. Where the
 * runtime lacks an `Intl` API (Hermes has no `ListFormat`, `RelativeTimeFormat` or
 * `DisplayNames`) they degrade to a plain, still readable result instead of throwing.
 *
 * `locale` is a BCP-47 tag: pass an app `Locale` (`'he'`, `'zh-Hans'`) or a device tag
 * with a region (`'en-US'`) when region-specific units (miles) matter.
 */

export type DateInput = Date | number | string;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.280839895;

/** Regions that show miles and feet (mirrors the map radius selector rule, design-system §13.3). */
const IMPERIAL_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Region subtag of a BCP-47 tag (`en-US` → `US`), if present. */
function regionOf(locale: string): string | undefined {
  const parts = locale.replace(/_/g, '-').split('-').slice(1);
  for (const part of parts) {
    if (part.length === 1) return undefined;
    if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
  }
  return undefined;
}

/** `'imperial'` for en-US / en-GB (and a few others), else `'metric'`. */
export function distanceSystemFor(locale: string): 'metric' | 'imperial' {
  const region = regionOf(locale);
  return region !== undefined && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
}

export interface FormatDistanceOptions {
  /** Overrides the system implied by the locale's region (the user's own setting). */
  system?: 'metric' | 'imperial';
}

/**
 * Formats a distance given in metres: `850 m`, `1.2 km`, `12 km`; or in the imperial
 * system `300 ft`, `0.8 mi`, `12 mi`. Digits and unit names follow the locale.
 */
export function formatDistance(meters: number, locale: string, options: FormatDistanceOptions = {}): string {
  const system = options.system ?? distanceSystemFor(locale);
  const fmt = (value: number, unit: string, maximumFractionDigits: number): string =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      maximumFractionDigits,
    }).format(value);

  const abs = Math.max(0, meters);
  if (system === 'imperial') {
    const miles = abs / METERS_PER_MILE;
    if (miles < 0.1) return fmt(Math.max(10, Math.round((abs * FEET_PER_METER) / 10) * 10), 'foot', 0);
    return fmt(miles, 'mile', miles < 10 ? 1 : 0);
  }
  if (abs < 1000) return fmt(Math.max(10, Math.round(abs / 10) * 10), 'meter', 0);
  const km = abs / 1000;
  return fmt(km, 'kilometer', km < 10 ? 1 : 0);
}

/** Formats a number with the locale's digits and grouping. */
export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Formats a 0..1 ratio as a percentage: `0.924` → `92%`. */
export function formatPercent(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

/**
 * Formats a date and time. Defaults to a medium date with a short time
 * (`Nov 3, 2026, 6:00 PM`, `3 בנוב׳ 2026, 18:00`); pass options to change it.
 */
export function formatDateTime(value: DateInput, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options ?? { dateStyle: 'medium', timeStyle: 'short' }).format(toDate(value));
}

/** Formats the date part only (`Nov 3, 2026`). */
export function formatDate(value: DateInput, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options ?? { dateStyle: 'medium' }).format(toDate(value));
}

/** Formats the time part only, in the locale's 12h/24h convention (`18:00`, `6:00 PM`). */
export function formatTime(value: DateInput, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options ?? { timeStyle: 'short' }).format(toDate(value));
}

/**
 * Formats a moment relative to `now`: `in 2 hours`, `yesterday`, `5 minutes ago`.
 * Details screens show this next to the absolute time (design-system §14.8).
 */
export function formatRelative(value: DateInput, locale: string, now: DateInput = Date.now()): string {
  const target = toDate(value);
  const diff = target.getTime() - toDate(now).getTime();
  const abs = Math.abs(diff);

  let amount: number;
  let unit: Intl.RelativeTimeFormatUnit;
  if (abs < 45 * SECOND) {
    amount = 0;
    unit = 'second';
  } else if (abs < 45 * MINUTE) {
    amount = Math.round(diff / MINUTE);
    unit = 'minute';
  } else if (abs < 22 * HOUR) {
    amount = Math.round(diff / HOUR);
    unit = 'hour';
  } else if (abs < 26 * DAY) {
    amount = Math.round(diff / DAY);
    unit = 'day';
  } else if (abs < 320 * DAY) {
    amount = Math.round(diff / (30 * DAY));
    unit = 'month';
  } else {
    amount = Math.round(diff / (365 * DAY));
    unit = 'year';
  }

  if (typeof Intl.RelativeTimeFormat === 'function') {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(amount, unit);
  }
  return formatDateTime(target, locale);
}

/**
 * Formats an amount held in minor units (agorot, cents; yen has none) as money.
 * The number of minor-unit digits comes from `Intl`, so JPY, USD and KWD all work.
 */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / 10 ** digits);
}

/** Joins items as a locale-aware list: `A, B, and C` / `א, ב ו-ג`. */
export function formatList(
  items: readonly string[],
  locale: string,
  type: 'conjunction' | 'disjunction' | 'unit' = 'conjunction',
): string {
  if (typeof Intl.ListFormat === 'function') {
    return new Intl.ListFormat(locale, { style: 'long', type }).format(items);
  }
  return items.join(', ');
}

/**
 * Formats a duration in the two largest non-zero units among days, hours and minutes
 * (`6 days, 4 hours`, `1 hour, 12 minutes`). Rounds up to a whole minute, minimum 1.
 */
export function formatDuration(ms: number, locale: string, maxUnits = 2): string {
  let remaining = Math.max(1, Math.ceil(ms / MINUTE));
  const parts: string[] = [];
  const units: [unit: string, size: number][] = [
    ['day', 24 * 60],
    ['hour', 60],
    ['minute', 1],
  ];
  for (const [unit, size] of units) {
    const value = Math.floor(remaining / size);
    remaining -= value * size;
    if (value > 0 && parts.length < maxUnits) {
      parts.push(
        new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long', maximumFractionDigits: 0 }).format(value),
      );
    }
  }
  return formatList(parts, locale, 'unit');
}

/** `m:ss` countdown for OTP resend and the QR refresh bar (`0:30`); callers wrap it as an LTR isolate. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
