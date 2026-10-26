/**
 * Series schedule (GAME-010): slots are `anchorDate + k · period` (period 7 or
 * 14 days), each starting at the series' local `startTime` in its IANA
 * `timeZone`, so a 20:00 game stays at 20:00 local across DST changes.
 */
import type { EpochMs, GameSeries, LocalDate, SeriesId, SeriesOccurrence, SeriesRecurrence, SeriesSchedule } from '../types';
import { MINUTE_MS } from '../time';
import { addDaysToLocalDate, daysBetweenLocalDates, epochToZoned, isLocalDate, zonedTimeToEpoch } from '../tz';
import { stableUuid } from '../crypto/uuid';

/** Days between consecutive slots. */
export function recurrencePeriodDays(recurrence: SeriesRecurrence): 7 | 14 {
  return recurrence === 'biweekly' ? 14 : 7;
}

/** Start and end instants of the slot on `slotDate`. */
export function slotTimes(schedule: SeriesSchedule, slotDate: LocalDate): { startsAt: EpochMs; endsAt: EpochMs } {
  const startsAt = zonedTimeToEpoch(slotDate, schedule.startTime, schedule.timeZone);
  return { startsAt, endsAt: startsAt + schedule.durationMinutes * MINUTE_MS };
}

type SlotSeries = Pick<GameSeries, 'anchorDate' | 'endDate' | 'recurrence'>;

/** True when `date` is a slot of the series (on the cadence, not before the anchor, not after `endDate`). */
export function isSeriesSlot(series: SlotSeries, date: LocalDate): boolean {
  if (!isLocalDate(date)) return false;
  const d = daysBetweenLocalDates(series.anchorDate, date);
  if (d < 0 || d % recurrencePeriodDays(series.recurrence) !== 0) return false;
  return series.endDate === null || date <= series.endDate;
}

/** Slot dates within `[fromDate, toDate]` (inclusive), in order. */
export function slotDatesBetween(series: SlotSeries, fromDate: LocalDate, toDate: LocalDate): LocalDate[] {
  const period = recurrencePeriodDays(series.recurrence);
  const offset = daysBetweenLocalDates(series.anchorDate, fromDate);
  let k = Math.max(0, Math.ceil(offset / period));
  const out: LocalDate[] = [];
  for (;;) {
    const date = addDaysToLocalDate(series.anchorDate, k * period);
    if (date > toDate || (series.endDate !== null && date > series.endDate)) return out;
    out.push(date);
    k++;
  }
}

/**
 * Slot dates whose start lies in `(fromMs, toMs]`, in order. The local date
 * range is widened by a day on each side so zone offsets never drop a slot.
 */
export function slotDatesInRange(series: SlotSeries & SeriesSchedule, fromMs: EpochMs, toMs: EpochMs): LocalDate[] {
  const from = addDaysToLocalDate(epochToZoned(fromMs, series.timeZone).date, -1);
  const to = addDaysToLocalDate(epochToZoned(toMs, series.timeZone).date, 1);
  return slotDatesBetween(series, from, to).filter((d) => {
    const s = slotTimes(series, d).startsAt;
    return s > fromMs && s <= toMs;
  });
}

/** `${seriesId}:${scheduleRevision}:${slotDate}` */
export function occurrenceKey(seriesId: SeriesId, scheduleRevision: number, slotDate: LocalDate): string {
  return `${seriesId}:${scheduleRevision}:${slotDate}`;
}

/** Parses an {@link occurrenceKey}; `null` when malformed. */
export function parseOccurrenceKey(key: string): { seriesId: SeriesId; scheduleRevision: number; slotDate: LocalDate } | null {
  const last = key.lastIndexOf(':');
  const mid = key.lastIndexOf(':', last - 1);
  if (mid <= 0) return null;
  const seriesId = key.slice(0, mid);
  const rev = key.slice(mid + 1, last);
  const slotDate = key.slice(last + 1);
  if (!/^\d+$/.test(rev) || !isLocalDate(slotDate)) return null;
  return { seriesId, scheduleRevision: Number(rev), slotDate };
}

/** Game id of an occurrence: `stableUuid('occurrence:' + occurrenceKey)`. */
export function deriveOccurrenceGameId(key: string): string {
  return stableUuid(`occurrence:${key}`);
}

/** Convenience: the key of an occurrence-like row. */
export function keyOf(o: Pick<SeriesOccurrence, 'seriesId' | 'scheduleRevision' | 'slotDate'>): string {
  return occurrenceKey(o.seriesId, o.scheduleRevision, o.slotDate);
}
