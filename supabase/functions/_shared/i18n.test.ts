import { describe, expect, it } from 'vitest';
import { createLocalizer, formatIcu } from '#shared/i18n';

describe('ICU subset', () => {
  it('formats arguments, plurals (with #, =n, CLDR categories) and selects', () => {
    expect(formatIcu('Hi {name}', { name: 'Dana' }, 'en')).toBe('Hi Dana');
    const p = '{hours, plural, =0 {now} one {# hour} other {# hours}}';
    expect(formatIcu(p, { hours: 0 }, 'en')).toBe('now');
    expect(formatIcu(p, { hours: 1 }, 'en')).toBe('1 hour');
    expect(formatIcu(p, { hours: 1000 }, 'en')).toBe('1,000 hours');
    expect(formatIcu('{n, plural, zero {z} one {o} two {t} few {f} many {m} other {x}}', { n: 3 }, 'ar')).toBe('f');
    expect(formatIcu('{o, select, upheld {kept} other {other}}', { o: 'upheld' }, 'en')).toBe('kept');
    expect(formatIcu('{o, select, upheld {kept} other {other}}', { o: 'zzz' }, 'en')).toBe('other');
    expect(() => formatIcu('{broken', {}, 'en')).toThrow();
  });
});

describe('localizer', () => {
  const catalogs = {
    en: { chat_muted: { title: 'Chat paused', body: 'Until {time}' }, join_approved: { title: 'You’re in', body: '{gameTitle}' } },
    he: { chat_muted: { title: 'הצ׳אט מושהה', body: 'עד {time}' } },
  };
  const l = createLocalizer(catalogs);
  it('renders in the recipient locale', () => {
    expect(l.notification('he', 'chat_muted', { time: '14:32' })).toEqual({ title: 'הצ׳אט מושהה', body: 'עד 14:32', locale: 'he' });
  });
  it('falls back to English, then to generic copy, never empty', () => {
    expect(l.notification('he', 'join_approved', { gameTitle: 'Padel' })).toMatchObject({ title: 'You’re in', body: 'Padel', locale: 'en' });
    expect(l.notification('xx', 'chat_muted', { time: '1' }).locale).toBe('en');
    const g = l.notification('en', 'venue_hidden', {});
    expect(g.title.length).toBeGreaterThan(0);
    expect(g.body.length).toBeGreaterThan(0);
  });
});
