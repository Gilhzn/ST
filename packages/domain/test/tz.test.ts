import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDaysToLocalDate,
  daysBetweenLocalDates,
  epochToZoned,
  isLocalDate,
  isLocalTime,
  isValidTimeZone,
  isoWeekdayOf,
  localDateToUtcMidnight,
  nextWeekdayOnOrAfter,
  timeZoneOffsetMs,
  zonedTimeToEpoch,
} from '../src';

const at = (s: string) => Date.parse(s);

describe('IANA time zones (no deps)', () => {
  it('validates zones, dates and times', () => {
    expect(isValidTimeZone('Asia/Jerusalem')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(3)).toBe(false);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-1-1')).toBe(false);
    expect(isLocalDate(20260101)).toBe(false);
    expect(isLocalTime('23:59')).toBe(true);
    expect(isLocalTime('24:00')).toBe(false);
    expect(() => localDateToUtcMidnight('nope')).toThrow(RangeError);
    expect(() => zonedTimeToEpoch('2026-10-20', '25:00', 'UTC')).toThrow(RangeError);
    expect(() => zonedTimeToEpoch('2026-10-20', '20:00', 'Nowhere/City')).toThrow(RangeError);
  });

  it('offsets across DST', () => {
    expect(timeZoneOffsetMs('Europe/London', at('2026-07-01T12:00:00Z'))).toBe(3_600_000);
    expect(timeZoneOffsetMs('Europe/London', at('2026-12-01T12:00:00Z'))).toBe(0);
    expect(timeZoneOffsetMs('Asia/Jerusalem', at('2026-07-01T12:00:00Z'))).toBe(3 * 3_600_000);
    expect(timeZoneOffsetMs('America/New_York', at('2026-12-01T12:00:00Z'))).toBe(-5 * 3_600_000);
  });

  it('wall time → instant keeps 20:00 local across the autumn change', () => {
    expect(new Date(zonedTimeToEpoch('2026-10-20', '20:00', 'Europe/London')).toISOString()).toBe('2026-10-20T19:00:00.000Z');
    expect(new Date(zonedTimeToEpoch('2026-10-27', '20:00', 'Europe/London')).toISOString()).toBe('2026-10-27T20:00:00.000Z');
    expect(new Date(zonedTimeToEpoch('2026-10-20', '20:00', 'Asia/Jerusalem')).toISOString()).toBe('2026-10-20T17:00:00.000Z');
    expect(new Date(zonedTimeToEpoch('2026-10-27', '20:00', 'Asia/Jerusalem')).toISOString()).toBe('2026-10-27T18:00:00.000Z');
  });

  it('gap (spring forward) shifts forward; overlap (fall back) takes the earlier instant', () => {
    expect(new Date(zonedTimeToEpoch('2026-03-29', '01:30', 'Europe/London')).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(epochToZoned(zonedTimeToEpoch('2026-03-29', '01:30', 'Europe/London'), 'Europe/London').time).toBe('02:30');
    expect(new Date(zonedTimeToEpoch('2026-10-25', '01:30', 'Europe/London')).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(new Date(zonedTimeToEpoch('2026-03-27', '02:30', 'Asia/Jerusalem')).toISOString()).toBe('2026-03-27T00:30:00.000Z');
  });

  it('calendar helpers', () => {
    expect(isoWeekdayOf('2026-10-26')).toBe(1);
    expect(isoWeekdayOf('2026-11-01')).toBe(7);
    expect(nextWeekdayOnOrAfter('2026-10-26', 2)).toBe('2026-10-27');
    expect(nextWeekdayOnOrAfter('2026-10-27', 2)).toBe('2026-10-27');
    expect(nextWeekdayOnOrAfter('2026-10-28', 2)).toBe('2026-11-03');
    expect(addDaysToLocalDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetweenLocalDates('2026-10-25', '2026-11-08')).toBe(14);
    expect(epochToZoned(at('2026-10-26T22:30:00Z'), 'Asia/Jerusalem')).toEqual({ date: '2026-10-27', time: '00:30', weekday: 2 });
  });

  it('property: round trip at noon in several zones', () => {
    const zones = ['Europe/London', 'Asia/Jerusalem', 'America/New_York', 'Asia/Kolkata', 'Australia/Sydney', 'UTC'];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3650 }), fc.constantFrom(...zones), fc.integer({ min: 9, max: 22 }), (d, z, h) => {
        const date = addDaysToLocalDate('2024-01-01', d);
        const time = `${String(h).padStart(2, '0')}:15`;
        expect(epochToZoned(zonedTimeToEpoch(date, time, z), z)).toMatchObject({ date, time });
      }),
    );
  });
});
