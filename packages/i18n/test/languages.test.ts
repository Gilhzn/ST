import { describe, expect, it } from 'vitest';
import { LOCALES } from '@st/domain';
import { ENGLISH_NAMES, LANGUAGES, NATIVE_NAMES, languageDisplayName, nativeNameOf } from '../src/languages';

describe('languages', () => {
  it('lists the 13 locales in LOCALES order with native names', () => {
    expect(LANGUAGES.map((l) => l.locale)).toEqual([...LOCALES]);
    expect(LANGUAGES.map((l) => l.nativeName)).toEqual([
      'English',
      'עברית',
      'العربية',
      'Español',
      '简体中文',
      '繁體中文',
      '日本語',
      'Português',
      'Русский',
      'Français',
      'Italiano',
      'Deutsch',
      'हिन्दी',
    ]);
    expect(nativeNameOf('he')).toBe('עברית');
    expect(NATIVE_NAMES.ar).toBe('العربية');
    expect(ENGLISH_NAMES['zh-Hant']).toBe('Chinese (Traditional)');
  });

  it('flags RTL languages', () => {
    expect(LANGUAGES.filter((l) => l.rtl).map((l) => l.locale)).toEqual(['he', 'ar']);
  });

  it('names a language in another language', () => {
    expect(languageDisplayName('he', 'en')).toBe('Hebrew');
    expect(languageDisplayName('en', 'en')).toBe('English');
    expect(languageDisplayName('de', 'fr')).toBe('allemand');
  });
});
