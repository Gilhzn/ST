/**
 * Locale-aware labels for recurring series (weekday names, wall-clock times, cadence,
 * the roster-only deadline). The cadence is a wall-clock rule in the series' own zone (with the
 * zone appended when it differs from the device's); concrete dates and deadlines are instants,
 * shown on the viewer's own clock like every other game time in the app.
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

/**
 * "Every Thursday at 20:00" / "Every other Thursday at 20:00". When the series runs in another
 * zone than the device ("8:00 PM" in London seen from Tel Aviv), the zone is appended ("8:00 PM GMT")
 * so the cadence never contradicts the game times shown in the viewer's own zone.
 */
export function cadenceLabel(series: Pick<GameSeries, 'recurrence' | 'weekday' | 'startTime'> & { timeZone?: string }, t: TFunction, locale: string): string {
  const zone = series.timeZone && series.timeZone !== deviceTimeZone() ? zoneAbbreviation(series.timeZone, locale) : null;
  const time = localTimeLabel(series.startTime, locale);
  return t('series:cadence', {
    recurrence: series.recurrence,
    weekday: weekdayName(series.weekday, locale),
    time: isolate(zone ? `${time} ${zone}` : time, 'ltr'),
  });
}

/** "GMT", "GMT+2", "BST" as the locale names the zone today. */
export function zoneAbbreviation(timeZone: string, locale: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short', hour: 'numeric' }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? null;
  } catch {
    return null;
  }
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

/** "Oct 30" in the series' zone (the weekday sits on the date tile). */
export function monthDay(iso: string, locale: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(timeZone ? { timeZone } : null) }).format(new Date(iso));
  } catch {
    return iso.slice(5, 10);
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
