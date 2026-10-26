// Provisional; replaced by the @st/i18n wiring once packages/i18n is ready.
import type { Locale } from '@st/domain';
import type { ReactNode } from 'react';
export type TFunction = (key: string, values?: Record<string, unknown>) => string;
export function useT(): { t: TFunction; locale: Locale } {
  return { t: (key) => key, locale: 'en' };
}
export function useLanguage() {
  return {
    locale: 'en' as Locale,
    deviceLocale: 'en' as Locale,
    followsDevice: true,
    setLanguage: async (l: Locale | null) => ({ locale: (l ?? 'en') as Locale, needsRestart: false }),
    restart: async () => undefined,
  };
}
export function I18nProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
