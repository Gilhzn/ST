// Provisional; replaced by the @st/i18n wiring once packages/i18n is ready.
import type { ReactNode } from 'react';
export type TFunction = (key: string, values?: Record<string, unknown>) => string;
export function useT(): { t: TFunction; locale: string } {
  return { t: (key) => key, locale: 'en' };
}
export function I18nProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
