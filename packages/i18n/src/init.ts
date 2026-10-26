import i18next from 'i18next';
import type { i18n as I18nInstance } from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES } from '@st/domain';
import type { Locale } from '@st/domain';

import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resources';

export interface InitI18nOptions {
  /** The UI locale to start with. */
  locale: Locale;
  /** Locale used for keys missing in `locale` (default `en`). */
  fallback?: Locale;
  /** Log missing keys and ICU problems to the console. */
  debug?: boolean;
}

let current: I18nInstance | undefined;

/**
 * Creates and returns the i18next instance, ready to use synchronously (all catalogs are
 * bundled). Uses ICU MessageFormat (plurals, select, number/date) and registers itself with
 * `react-i18next`, so `useTranslation()` works in any component afterwards.
 *
 * Call once at startup; calling it again replaces the instance (tests, hot reload).
 * On Hermes, polyfill `Intl.PluralRules` first or plurals fall back to the raw message.
 */
export function initI18n({ locale, fallback = DEFAULT_LOCALE, debug = false }: InitI18nOptions): I18nInstance {
  const instance = i18next.createInstance();
  instance
    .use(new ICU())
    .use(initReactI18next)
    .init({
      lng: locale,
      fallbackLng: fallback,
      supportedLngs: [...LOCALES],
      nonExplicitSupportedLngs: false,
      load: 'currentOnly',
      resources,
      ns: [...NAMESPACES],
      defaultNS: DEFAULT_NAMESPACE,
      // Values are interpolated as plain text; React and RN escape on render.
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      initAsync: false,
      debug,
    })
    .catch(() => {
      // Resources are bundled, so init cannot fail asynchronously; `debug` shows sync problems.
    });
  current = instance;
  return instance;
}

/** The instance created by {@link initI18n}; throws when called before it. */
export function getI18n(): I18nInstance {
  if (!current) throw new Error('initI18n() has not been called');
  return current;
}

/**
 * A `t` bound to another locale than the active one, for text that must be shown in a
 * different language, such as the RTL restart dialog (shown in the *target* language plus
 * the current one): `tFor('ar')('settings:language.restart.title', { language: nativeNameOf('ar') })`.
 */
export function tFor(locale: Locale) {
  return getI18n().getFixedT(locale);
}

/** Switches the active locale. The caller handles the RTL restart flow (see `needsRestart`). */
export async function setLocale(locale: Locale): Promise<void> {
  await getI18n().changeLanguage(locale);
}
