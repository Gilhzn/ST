/**
 * Locale-aware labels for recurring series (weekday names, wall-clock times, cadence,
 * the roster-only deadline). Times are formatted in the series' own time zone so a
 * Tel Aviv game reads "20:00" wherever the viewer is.
 */
import type { GameSeries, LocalTime, Weekday } from '@st/domain';
import { isolate } from '@st/ui';

import type { TFunction } from '@/i18n';
import { capitalize } from '@/components/GameCard';

/** A Monday (2024-01-01 was a Monday) + n days, at noon UTC (no DST edge). */
function isoForWeekday(weekday: Weekday): string {
  return new Date(Date.UTC(2024, 0, weekday, 12)).toISOString();
}

export function weekdayName(weekday: Weekday, locale: string, style: 'long' | 'short' = 'long'): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(new Date(isoForWeekday(weekday)));
  } catch {
    return String(weekday);
  }
}

/** Plural weekday where a language says "on Thursdays" differently: we keep the singular, ICU copy adapts. */
export function weekdayLabel(weekday: Weekday, locale: string): string {
  return capitalize(weekdayName(weekday, locale), locale);
}

/** `20:00` → "8:00 PM" / "20:00" per locale. */
export function localTimeLabel(time: LocalTime, locale: string): string {
  const [h, m] = time.split(':').map(Number);
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, h ?? 0, m ?? 0)));
  } catch {
    return time;
  }
}

/** "Every Thursday at 20:00" / "Every other Thursday at 20:00". */
export function cadenceLabel(series: Pick<GameSeries, 'recurrence' | 'weekday' | 'startTime'>, t: TFunction, locale: string): string {
  return t('series:cadence', {
    recurrence: series.recurrence,
    weekday: weekdayName(series.weekday, locale),
    time: isolate(localTimeLabel(series.startTime, locale), 'ltr'),
  });
}

/** "Thu 20:00" in a given time zone (deadlines such as the regulars-only window). */
export function shortDayTime(iso: string, locale: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : null) }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

/** "Thu 30 Oct" in the series' zone. */
export function dayLabel(iso: string, locale: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(timeZone ? { timeZone } : null) }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** "20:00" wall clock in the series' zone. */
export function timeIn(iso: string, locale: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : null) }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

/** The device's IANA zone (series created on this device use it). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
