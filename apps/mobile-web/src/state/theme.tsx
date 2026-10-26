/** Theme provider wiring: persisted preference + locale-driven fonts and direction. */
import { ThemeProvider, type ThemePreference } from '@st/ui';
import { useEffect, useState, type ReactNode } from 'react';

import { useAppFonts } from '@/platform/fonts';

import { getPref, PrefKeys, setPref } from './prefs';

export function AppThemeProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePreference | null>(null);
  const fontsLoaded = useAppFonts(locale);

  useEffect(() => {
    let alive = true;
    getPref<ThemePreference>(PrefKeys.themePreference).then((p) => {
      if (alive) setPrefState(p === 'light' || p === 'dark' || p === 'system' ? p : 'system');
    });
    return () => {
      alive = false;
    };
  }, []);

  if (pref === null) return null;
  return (
    <ThemeProvider
      locale={locale}
      fontsLoaded={fontsLoaded}
      initialPreference={pref}
      onPreferenceChange={(p) => void setPref(PrefKeys.themePreference, p)}
    >
      {children}
    </ThemeProvider>
  );
}
