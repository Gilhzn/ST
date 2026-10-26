/**
 * IANA time-zone arithmetic without dependencies, built on
 * `Intl.DateTimeFormat#formatToParts` (available in Node, Deno, browsers and
 * Hermes with Intl). Local calendar dates (`YYYY-MM-DD`) are handled as UTC
 * midnights so that date arithmetic never touches DST.
 *
 * DST rules for {@link zonedTimeToEpoch} (same as Temporal's `compatible`):
 * - an ambiguous wall time (fall back, the hour happens twice) resolves to the
 *   **earlier** instant;
 * - a non-existent wall time (spring forward gap) is shifted **forward** by the
 *   gap (01:30 on a 01:00→02:00 jump becomes 02:30 local).
 */
import type { EpochMs, IanaTimeZone, LocalDate, LocalTime, Weekday } from './types';
import { DAY_MS, MINUTE_MS } from './time';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: IanaTimeZone): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True when the runtime knows `timeZone` as an IANA zone. */
export function isValidTimeZone(timeZone: unknown): timeZone is IanaTimeZone {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(timeZone: IanaTimeZone, epochMs: EpochMs): WallClock {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(epochMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year as number,
    month: out.month as number,
    day: out.day as number,
    hour: (out.hour as number) % 24,
    minute: out.minute as number,
    second: out.second as number,
  };
}

/** UTC offset of `timeZone` at instant `epochMs`, in ms (e.g. +3 h for Asia/Jerusalem in summer). */
export function timeZoneOffsetMs(timeZone: IanaTimeZone, epochMs: EpochMs): number {
  const whole = Math.floor(epochMs / 1000) * 1000;
  const w = wallClock(timeZone, whole);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - whole;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses `YYYY-MM-DD` to the UTC midnight of that calendar date; throws `RangeError` when invalid. */
export function localDateToUtcMidnight(date: LocalDate): EpochMs {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Invalid local date: ${date}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new RangeError(`Invalid local date: ${date}`);
  }
  return ms;
}

/** True for a real calendar date in `YYYY-MM-DD` form. */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  try {
    localDateToUtcMidnight(value);
    return true;
  } catch {
    return false;
  }
}

/** True for `HH:MM` (00:00–23:59). */
export function isLocalTime(value: unknown): value is LocalTime {
  return typeof value === 'string' && TIME_RE.test(value);
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** Formats a UTC-midnight epoch as `YYYY-MM-DD`. */
export function utcMidnightToLocalDate(ms: EpochMs): LocalDate {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `date + days` (calendar days). */
export function addDaysToLocalDate(date: LocalDate, days: number): LocalDate {
  return utcMidnightToLocalDate(localDateToUtcMidnight(date) + days * DAY_MS);
}

/** Whole calendar days from `a` to `b` (negative when `b` is earlier). */
export function daysBetweenLocalDates(a: LocalDate, b: LocalDate): number {
  return Math.round((localDateToUtcMidnight(b) - localDateToUtcMidnight(a)) / DAY_MS);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function isoWeekdayOf(date: LocalDate): Weekday {
  const js = new Date(localDateToUtcMidnight(date)).getUTCDay();
  return (((js + 6) % 7) + 1) as Weekday;
}

/** The first date on or after `date` falling on `weekday`. */
export function nextWeekdayOnOrAfter(date: LocalDate, weekday: Weekday): LocalDate {
  const delta = (weekday - isoWeekdayOf(date) + 7) % 7;
  return addDaysToLocalDate(date, delta);
}

/** The wall-clock date, time and weekday of `epochMs` in `timeZone`. */
export function epochToZoned(epochMs: EpochMs, timeZone: IanaTimeZone): { date: LocalDate; time: LocalTime; weekday: Weekday } {
  const w = wallClock(timeZone, epochMs);
  const date = `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
  return { date, time: `${pad(w.hour)}:${pad(w.minute)}`, weekday: isoWeekdayOf(date) };
}

/**
 * The instant at which the wall clock in `timeZone` reads `date time` (see the
 * module doc for DST gaps and overlaps). Throws `RangeError` for invalid input.
 */
export function zonedTimeToEpoch(date: LocalDate, time: LocalTime, timeZone: IanaTimeZone): EpochMs {
  if (!isLocalTime(time)) throw new RangeError(`Invalid local time: ${time}`);
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Invalid time zone: ${timeZone}`);
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = localDateToUtcMidnight(date) + hh * 60 * MINUTE_MS + mm * MINUTE_MS;
  // Real zones change offset at most once within ±1 day, so the offsets one day
  // either side are the "before" and "after" offsets of any nearby transition.
  const before = timeZoneOffsetMs(timeZone, wall - DAY_MS);
  const after = timeZoneOffsetMs(timeZone, wall + DAY_MS);
  const a = wall - before;
  const b = wall - after;
  const aOk = timeZoneOffsetMs(timeZone, a) === before;
  const bOk = timeZoneOffsetMs(timeZone, b) === after;
  if (aOk && bOk) return Math.min(a, b);
  if (aOk) return a;
  if (bOk) return b;
  return a; // gap: the pre-transition offset lands after the jump, i.e. shifted forward by the gap
}
