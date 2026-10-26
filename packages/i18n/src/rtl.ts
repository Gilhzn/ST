import { isRtlLocale } from '@st/domain';
import type { Locale } from '@st/domain';

/** True when `locale` is written right-to-left (`he`, `ar`). */
export function isRTL(locale: Locale): boolean {
  return isRtlLocale(locale);
}

/** Text direction for `<html dir>` and the root `direction` style. */
export function dir(locale: Locale): 'rtl' | 'ltr' {
  return isRTL(locale) ? 'rtl' : 'ltr';
}

/**
 * Whether switching to `nextLocale` changes the layout direction, which on native
 * requires `I18nManager.forceRTL(...)` followed by a reload (design-system §13.17).
 *
 * @param currentIsRTL the direction the app is running with right now
 *   (`I18nManager.isRTL` on native, `document.dir === 'rtl'` on web).
 *
 * Web switches instantly, so callers use this only on native:
 * `if (needsRestart(I18nManager.isRTL, next)) showRestartDialog(next)`.
 */
export function needsRestart(currentIsRTL: boolean, nextLocale: Locale): boolean {
  return currentIsRTL !== isRTL(nextLocale);
}
