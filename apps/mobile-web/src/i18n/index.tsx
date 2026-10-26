/**
 * App wiring for @st/i18n (i18next + ICU, all catalogs bundled):
 * - Locale = saved choice (AsyncStorage) → device locale (expo-localization) → en.
 * - Web: <html lang dir> follow the locale (set by the @st/ui ThemeProvider) and switch instantly.
 * - Native: RTL needs I18nManager.forceRTL + reload; switching between LTR and RTL asks to
 *   restart first (design §13.17). On startup a mismatch is fixed with one automatic reload.
 * Components call `useT()` → `{ t, locale }`; every user-facing string goes through `t`.
 */
import { isLocale, type Locale } from '@st/domain';
import { detectLocale, getI18n, initI18n, isRTL, needsRestart, setLocale } from '@st/i18n';
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nManager, Platform } from 'react-native';

import { restartApp } from '@/platform/restart';
import { getPref, PrefKeys, setPref } from '@/state/prefs';

export type TFunction = (key: string, values?: Record<string, unknown>) => string;

interface I18nValue {
  t: TFunction;
  locale: Locale;
  deviceLocale: Locale;
  followsDevice: boolean;
  /** Persists the choice (`null` = follow the device). Returns whether a native restart is needed. */
  setLanguage: (next: Locale | null) => Promise<{ locale: Locale; needsRestart: boolean }>;
  restart: () => Promise<void>;
}

const I18nContext = createContext<I18nValue | null>(null);

export function deviceLocale(): Locale {
  try {
    return detectLocale(getLocales().map((l) => l.languageTag));
  } catch {
    return 'en';
  }
}

/** Native only: make the layout direction match `locale`; true when a reload was started. */
async function alignNativeDirection(locale: Locale): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  I18nManager.allowRTL(true);
  const rtl = isRTL(locale);
  if (I18nManager.isRTL === rtl) {
    await setPref(PrefKeys.rtlReloadAttempted, null);
    return false;
  }
  I18nManager.forceRTL(rtl);
  if (await getPref<boolean>(PrefKeys.rtlReloadAttempted)) return false; // never loop
  await setPref(PrefKeys.rtlReloadAttempted, true);
  await restartApp();
  return true;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ locale: Locale; followsDevice: boolean } | null>(null);
  const device = useMemo(deviceLocale, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await getPref<string>(PrefKeys.locale);
      const locale = isLocale(saved) ? saved : device;
      initI18n({ locale, debug: false });
      if (await alignNativeDirection(locale)) return;
      if (alive) setState({ locale, followsDevice: !isLocale(saved) });
    })();
    return () => {
      alive = false;
    };
  }, [device]);

  const setLanguage = useCallback(
    async (next: Locale | null) => {
      const locale = next ?? device;
      await setPref(PrefKeys.locale, next);
      if (Platform.OS !== 'web' && needsRestart(I18nManager.isRTL, locale)) {
        I18nManager.allowRTL(true);
        I18nManager.forceRTL(isRTL(locale));
        return { locale, needsRestart: true };
      }
      await setLocale(locale);
      setState({ locale, followsDevice: next === null });
      return { locale, needsRestart: false };
    },
    [device],
  );

  const value = useMemo<I18nValue | null>(() => {
    if (!state) return null;
    const fixed = getI18n().getFixedT(state.locale);
    const t: TFunction = (key, values) => fixed(key, values as never) as unknown as string;
    return {
      t,
      locale: state.locale,
      deviceLocale: device,
      followsDevice: state.followsDevice,
      setLanguage,
      restart: async () => {
        await setPref(PrefKeys.rtlReloadAttempted, null);
        await restartApp();
      },
    };
  }, [state, device, setLanguage]);

  if (!value) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT() must be used inside <I18nProvider>');
  return ctx;
}

/** Translation function and active locale. */
export function useT(): { t: TFunction; locale: Locale } {
  const { t, locale } = useI18n();
  return { t, locale };
}

/** Language settings (Settings → Language). */
export function useLanguage() {
  const { locale, deviceLocale: device, followsDevice, setLanguage, restart } = useI18n();
  return { locale, deviceLocale: device, followsDevice, setLanguage, restart };
}
