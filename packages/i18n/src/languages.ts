import { LOCALES } from '@st/domain';
import type { Locale } from '@st/domain';

import { isRTL } from './rtl';

/** One entry of the language picker. */
export interface LanguageInfo {
  locale: Locale;
  /** Name in the language itself (the endonym), rendered in its own script/font. */
  nativeName: string;
  /** English name, for logs and as a fallback when `Intl.DisplayNames` is missing. */
  englishName: string;
  rtl: boolean;
}

const NAMES: Record<Locale, readonly [native: string, english: string]> = {
  en: ['English', 'English'],
  he: ['עברית', 'Hebrew'],
  ar: ['العربية', 'Arabic'],
  es: ['Español', 'Spanish'],
  'zh-Hans': ['简体中文', 'Chinese (Simplified)'],
  'zh-Hant': ['繁體中文', 'Chinese (Traditional)'],
  ja: ['日本語', 'Japanese'],
  pt: ['Português', 'Portuguese'],
  ru: ['Русский', 'Russian'],
  fr: ['Français', 'French'],
  it: ['Italiano', 'Italian'],
  de: ['Deutsch', 'German'],
  hi: ['हिन्दी', 'Hindi'],
};

/** The 13 languages in picker order (same order as `LOCALES`). */
export const LANGUAGES: readonly LanguageInfo[] = LOCALES.map((locale) => {
  const [nativeName, englishName] = NAMES[locale];
  return { locale, nativeName, englishName, rtl: isRTL(locale) };
});

/** Endonyms by locale. */
export const NATIVE_NAMES: Readonly<Record<Locale, string>> = Object.fromEntries(
  LANGUAGES.map((l) => [l.locale, l.nativeName]),
) as Record<Locale, string>;

/** English names by locale. */
export const ENGLISH_NAMES: Readonly<Record<Locale, string>> = Object.fromEntries(
  LANGUAGES.map((l) => [l.locale, l.englishName]),
) as Record<Locale, string>;

/** The name of `locale` in its own language. */
export function nativeNameOf(locale: Locale): string {
  return NAMES[locale][0];
}

/**
 * The name of `language` written in `inLocale`, for the secondary line of the picker
 * ("Hebrew" under עברית in an English UI). Falls back to the English name where
 * `Intl.DisplayNames` is unavailable (Hermes).
 */
export function languageDisplayName(language: Locale, inLocale: Locale): string {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const name = new Intl.DisplayNames([inLocale], { type: 'language' }).of(language);
      if (name && name !== language) return name;
    }
  } catch {
    // fall through to the English name
  }
  return NAMES[language][1];
}
