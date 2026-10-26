import { describe, expect, it } from 'vitest';
import {
  distanceSystemFor,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatList,
  formatMoney,
  formatPercent,
  formatRelative,
  formatTime,
} from '../src/format';

/** ICU uses narrow no-break spaces in some patterns; compare with plain spaces. */
const plain = (s: string): string => s.replace(/[\s\u00a0\u202f]+/g, ' ');

describe('formatDistance', () => {
  it('uses metres below 1 km and kilometres above', () => {
    expect(plain(formatDistance(850, 'en'))).toBe('850 m');
    expect(plain(formatDistance(842, 'en'))).toBe('840 m');
    expect(plain(formatDistance(1200, 'en'))).toBe('1.2 km');
    expect(plain(formatDistance(12_400, 'en'))).toBe('12 km');
    expect(plain(formatDistance(0, 'en'))).toBe('10 m');
  });

  it('shows miles for en-US and en-GB, with the same underlying distance', () => {
    expect(distanceSystemFor('en-US')).toBe('imperial');
    expect(distanceSystemFor('en-GB')).toBe('imperial');
    expect(distanceSystemFor('en')).toBe('metric');
    expect(distanceSystemFor('de-DE')).toBe('metric');
    expect(plain(formatDistance(5000, 'en-US'))).toBe('3.1 mi');
    expect(plain(formatDistance(100, 'en-US'))).toBe('330 ft');
  });

  it('honours an explicit system', () => {
    expect(plain(formatDistance(5000, 'en', { system: 'imperial' }))).toBe('3.1 mi');
    expect(plain(formatDistance(5000, 'en-US', { system: 'metric' }))).toBe('5 km');
  });

  it('localizes digits and unit names', () => {
    expect(formatDistance(1200, 'de')).toMatch(/1,2/);
    expect(formatDistance(1200, 'he')).toMatch(/1\.2/);
    expect(formatDistance(1200, 'ja')).toMatch(/1\.2/);
  });
});

describe('formatMoney', () => {
  it('converts minor units by the currency exponent', () => {
    expect(plain(formatMoney(2000, 'ILS', 'en'))).toBe('₪20.00');
    expect(plain(formatMoney(2000, 'USD', 'en'))).toBe('$20.00');
    expect(plain(formatMoney(2000, 'JPY', 'en'))).toBe('¥2,000');
    expect(plain(formatMoney(1500, 'KWD', 'en'))).toMatch(/1\.500/);
  });

  it('follows the locale', () => {
    expect(plain(formatMoney(123456, 'EUR', 'de'))).toBe('1.234,56 €');
    expect(formatMoney(2000, 'ILS', 'he')).toContain('₪');
  });
});

describe('formatDateTime and friends', () => {
  const when = '2026-11-03T18:00:00Z';
  it('formats date and time in a given zone', () => {
    expect(plain(formatDateTime(when, 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }))).toBe('Nov 3, 2026, 6:00 PM');
    expect(plain(formatDateTime(when, 'de', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }))).toBe('03.11.2026, 18:00');
    expect(plain(formatDate(when, 'en', { dateStyle: 'medium', timeZone: 'UTC' }))).toBe('Nov 3, 2026');
    expect(plain(formatTime(when, 'fr', { timeStyle: 'short', timeZone: 'UTC' }))).toBe('18:00');
  });

  it('accepts Date, epoch ms and ISO strings alike', () => {
    const opts = { dateStyle: 'short', timeZone: 'UTC' } as const;
    const a = formatDate(new Date(when), 'en', opts);
    expect(formatDate(Date.parse(when), 'en', opts)).toBe(a);
    expect(formatDate(when, 'en', opts)).toBe(a);
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  it('picks a sensible unit', () => {
    expect(formatRelative(now + 10_000, 'en', now)).toBe('now');
    expect(formatRelative(now + 5 * 60_000, 'en', now)).toBe('in 5 minutes');
    expect(formatRelative(now - 12 * 60_000, 'en', now)).toBe('12 minutes ago');
    expect(formatRelative(now + 2 * 3_600_000, 'en', now)).toBe('in 2 hours');
    expect(formatRelative(now - 24 * 3_600_000, 'en', now)).toBe('yesterday');
    expect(formatRelative(now + 3 * 24 * 3_600_000, 'en', now)).toBe('in 3 days');
    expect(formatRelative(now + 60 * 24 * 3_600_000, 'en', now)).toBe('in 2 months');
  });

  it('localizes', () => {
    expect(formatRelative(now + 2 * 3_600_000, 'es', now)).toBe('dentro de 2 horas');
    expect(formatRelative(now + 2 * 3_600_000, 'de', now)).toBe('in 2 Stunden');
  });
});

describe('misc helpers', () => {
  it('formatPercent', () => {
    expect(formatPercent(0.924, 'en')).toBe('92%');
    expect(plain(formatPercent(0.5, 'de'))).toBe('50 %');
  });

  it('formatList', () => {
    expect(formatList(['football', 'tennis', 'padel'], 'en')).toBe('football, tennis, and padel');
    expect(formatList(['a', 'b'], 'es')).toBe('a y b');
    expect(formatList([], 'en')).toBe('');
  });

  it('formatDuration', () => {
    const day = 24 * 3_600_000;
    expect(formatDuration(6 * day + 4 * 3_600_000 + 20 * 60_000, 'en')).toBe('6 days, 4 hours');
    expect(formatDuration(72 * 60_000, 'en')).toBe('1 hour, 12 minutes');
    expect(formatDuration(5_000, 'en')).toBe('1 minute');
    expect(formatDuration(day + 2 * 3_600_000 + 5 * 60_000, 'en', 3)).toBe('1 day, 2 hours, 5 minutes');
  });

  it('formatCountdown', () => {
    expect(formatCountdown(30)).toBe('0:30');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-3)).toBe('0:00');
    expect(formatCountdown(9.2)).toBe('0:10');
  });
});
