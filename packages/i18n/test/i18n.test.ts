import { beforeEach, describe, expect, it } from 'vitest';
import { LOCALES } from '@st/domain';
import type { Locale } from '@st/domain';
import { getI18n, initI18n, setLocale, tFor } from '../src/init';
import { errorKey, notificationKeys, sanctionReasonKey, statementKey } from '../src/keys';

const t = (locale: Locale) => {
  const i18n = initI18n({ locale });
  return i18n.t.bind(i18n);
};

describe('initI18n', () => {
  beforeEach(() => {
    initI18n({ locale: 'en' });
  });

  it('starts in the requested locale and returns a synchronous instance', () => {
    const i18n = initI18n({ locale: 'he' });
    expect(i18n.language).toBe('he');
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t('common:actions.save')).toBe('שמירה');
    expect(getI18n()).toBe(i18n);
  });

  it('resolves the default namespace and ns-prefixed keys', () => {
    const i18n = initI18n({ locale: 'en' });
    expect(i18n.t('actions.save')).toBe('Save');
    expect(i18n.t('common:actions.save')).toBe('Save');
    expect(i18n.t('errors:network')).toMatch(/connect/i);
  });

  it('supports all 13 locales, including the two Chinese scripts', () => {
    for (const locale of LOCALES) {
      const i18n = initI18n({ locale });
      expect(i18n.language, locale).toBe(locale);
      const text = i18n.t('errors:unknown');
      expect(text, locale).not.toBe('errors:unknown');
      if (locale !== 'en') expect(text, locale).not.toBe(initI18n({ locale: 'en' }).t('errors:unknown'));
    }
  });

  it('switches language at runtime', async () => {
    const i18n = initI18n({ locale: 'en' });
    await setLocale('de');
    expect(i18n.language).toBe('de');
    expect(i18n.t('common:actions.cancel')).toBe('Abbrechen');
  });

  it('falls back to English for a missing key', () => {
    const i18n = initI18n({ locale: 'hi' });
    i18n.removeResourceBundle('hi', 'errors');
    expect(i18n.t('errors:network')).toBe(initI18n({ locale: 'en' }).t('errors:network'));
  });

  it('tFor renders in another locale without switching the active one', () => {
    const i18n = initI18n({ locale: 'en' });
    expect(tFor('ar')('settings:language.restart.title', { language: 'العربية' })).toBe('هل تريد إعادة التشغيل للتبديل إلى العربية؟');
    expect(i18n.language).toBe('en');
    expect(i18n.t('settings:language.restart.title', { language: 'Arabic' })).toBe('Restart to switch to Arabic?');
  });

  it('returns the key itself for an unknown key', () => {
    expect(initI18n({ locale: 'en' }).t('errors:does_not_exist')).toBe('does_not_exist');
  });
});

describe('ICU plurals', () => {
  const count = (locale: Locale, n: number): string => initI18n({ locale }).t('common:players.count', { count: n });

  it('en: one / other', () => {
    expect([0, 1, 2, 5].map((n) => count('en', n))).toEqual(['0 players', '1 player', '2 players', '5 players']);
  });

  it('ar: zero / one / two / few / many / other', () => {
    expect(count('ar', 0)).toBe('0 لاعب');
    expect(count('ar', 1)).toBe('لاعب واحد');
    expect(count('ar', 2)).toBe('لاعبان');
    expect(count('ar', 3)).toBe('3 لاعبين');
    expect(count('ar', 10)).toBe('10 لاعبين');
    expect(count('ar', 11)).toBe('11 لاعبًا');
    expect(count('ar', 99)).toBe('99 لاعبًا');
    expect(count('ar', 100)).toBe('100 لاعب');
  });

  it('ru: one / few / many', () => {
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25, 101].map((n) => count('ru', n))).toEqual([
      '1 игрок',
      '2 игрока',
      '4 игрока',
      '5 игроков',
      '11 игроков',
      '12 игроков',
      '21 игрок',
      '22 игрока',
      '25 игроков',
      '101 игрок',
    ]);
  });

  it('he: one / two / other', () => {
    expect(count('he', 1)).toBe('שחקן אחד');
    expect(count('he', 2)).toBe('שני שחקנים');
    expect(count('he', 3)).toBe('3 שחקנים');
    expect(count('he', 20)).toBe('20 שחקנים');
  });

  it('ja and zh have a single form', () => {
    expect(count('ja', 1)).toBe('1人のプレイヤー');
    expect(count('ja', 12)).toBe('12人のプレイヤー');
    expect(count('zh-Hans', 1)).toBe('1 名玩家');
    expect(count('zh-Hant', 5)).toBe('5 位球友');
  });

  it('exact =0 matches win over the category', () => {
    const left = (locale: Locale, n: number): string => initI18n({ locale }).t('common:players.spotsLeft', { count: n });
    expect(left('en', 0)).toBe('Full');
    expect(left('en', 1)).toBe('1 spot left');
    expect(left('en', 4)).toBe('4 spots left');
    expect(left('ru', 0)).toBe('Мест нет');
    expect(left('ru', 3)).toBe('Остаётся 3 места');
    expect(left('ar', 0)).toBe('اكتمل العدد');
    expect(left('ar', 2)).toBe('بقي مكانان');
  });

  it('formats large numbers with grouping', () => {
    expect(initI18n({ locale: 'en' }).t('common:players.count', { count: 12345 })).toBe('12,345 players');
    expect(initI18n({ locale: 'de' }).t('common:players.count', { count: 12345 })).toBe('12.345 Spieler:innen');
  });
});

describe('ICU select', () => {
  const method = (locale: Locale, m: string): string => initI18n({ locale }).t('checkin:success.method', { method: m });

  it('en', () => {
    expect(method('en', 'gps')).toBe('Confirmed by GPS');
    expect(method('en', 'qr')).toBe('Confirmed by QR code');
    expect(method('en', 'peer')).toBe('Confirmed by teammates');
    expect(method('en', 'host')).toBe('Confirmed by the host');
    expect(method('en', 'something_else')).toBe('Confirmed');
  });

  it('ar, ru and he keep the same cases', () => {
    expect(method('ar', 'gps')).toBe('تم التأكيد عبر GPS');
    expect(method('ar', 'other')).toBe('تم التأكيد');
    expect(method('ru', 'peer')).toBe('Подтверждено игроками');
    expect(method('ru', 'x')).toBe('Подтверждено');
    expect(method('he', 'host')).toBe('אושר על ידי המארח');
    expect(method('he', 'x')).toBe('אושר');
  });

  it('notification select with plural-free outcome', () => {
    const body = (locale: Locale, outcome: string): string =>
      initI18n({ locale }).t('notifications:appeal_decided.body', { outcome });
    expect(body('en', 'overturned')).toMatch(/reversed/);
    expect(body('en', 'upheld')).toMatch(/stands/);
    expect(body('en', 'withdrawn')).toBe('Open the app to read the decision.');
    expect(body('ru', 'overturned')).toMatch(/отменили/);
  });
});

describe('server-rendered copy', () => {
  it('renders a statement of reasons and its notification in the recipient locale', () => {
    const he = initI18n({ locale: 'he' });
    const reason = he.t(sanctionReasonKey('no_show'), { gameTitle: 'כדורגל', date: '3 בנוב׳' });
    expect(reason).toContain('כדורגל');
    expect(reason).toContain('3 בנוב׳');
    expect(he.t(statementKey('sanctions.reason.late_cancel'), { gameTitle: 'X', date: 'Y', hours: 2 })).toContain('שעתיים');

    const keys = notificationKeys('join_waitlisted');
    const en = initI18n({ locale: 'en' });
    expect(en.t(keys.title)).toBe('You’re on the waitlist');
    expect(en.t(keys.body, { gameTitle: 'Sunday Football', position: 3 })).toBe(
      'Sunday Football is full. You’re #3 on the waitlist, and we’ll tell you if a spot opens.',
    );
  });

  it('plurals inside statements use the recipient language rules', () => {
    const ru = initI18n({ locale: 'ru' });
    expect(ru.t(sanctionReasonKey('late_cancel'), { gameTitle: 'Игра', date: '3 нояб.', hours: 2 })).toContain('2 часа');
    expect(ru.t(sanctionReasonKey('late_cancel'), { gameTitle: 'Игра', date: '3 нояб.', hours: 5 })).toContain('5 часов');
    const ar = initI18n({ locale: 'ar' });
    expect(ar.t(sanctionReasonKey('late_cancel'), { gameTitle: 'X', date: 'Y', hours: 2 })).toContain('ساعتين');
  });

  it('maps every ErrorCode to a non-empty message in every locale', () => {
    for (const locale of LOCALES) {
      const i18n = initI18n({ locale });
      for (const code of ['network', 'game_full', 'join_banned', 'unknown'] as const) {
        const text = i18n.t(errorKey(code));
        expect(text.length, `${locale}/${code}`).toBeGreaterThan(5);
        expect(text).not.toContain('errors:');
      }
    }
  });
});

describe('helpers', () => {
  it('t is usable detached from the instance', () => {
    const translate = t('es');
    expect(translate('actions.save')).toBe('Guardar');
  });
});
