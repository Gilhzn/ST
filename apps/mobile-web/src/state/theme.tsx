/**
 * Theme provider wiring: persisted preference + locale-driven direction. Fonts are loaded by the
 * root layout (`useAppFonts`, Rubik + the locale's script fallback) and passed in as `brandFonts`.
 */
import { ThemeProvider, useAppFonts, type ThemePreference } from '@st/ui';
import { useEffect, useState, type ReactNode } from 'react';

import { getPref, PrefKeys, setPref } from './prefs';

export function AppThemeProvider({ locale, brandFonts, children }: { locale: string; brandFonts: boolean; children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePreference | null>(null);

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
      brandFonts={brandFonts}
      initialPreference={pref}
      onPreferenceChange={(p) => void setPref(PrefKeys.themePreference, p)}
    >
      {children}
    </ThemeProvider>
  );
}
