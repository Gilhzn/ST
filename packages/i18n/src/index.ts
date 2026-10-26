/**
 * @st/i18n: ICU MessageFormat strings (i18next + i18next-icu) for 13 locales.
 *
 * Adding copy (app developers):
 *  1. Add the key to `locales/en/<namespace>.json` (nested keys, ICU `{name}` placeholders,
 *     `{count, plural, one {# item} other {# items}}` for counts, `select` for variants).
 *     English is the source; never concatenate strings in code.
 *  2. Run `npm run i18n:check`. Other locales will report the key as missing until they are
 *     translated (the localization owner does that after the English strings freeze).
 *  3. Use it: `t('games:details.action.join')`, `t('common:players.count', { count })`.
 *
 * Keys derived from domain enums have typed builders in `keys.ts` (`errorKey`, ...).
 */
export { initI18n, getI18n, setLocale, tFor } from './init';
export type { InitI18nOptions } from './init';
export { detectLocale, normalizeLocale } from './locale';
export { isRTL, dir, needsRestart } from './rtl';
export { LANGUAGES, NATIVE_NAMES, ENGLISH_NAMES, nativeNameOf, languageDisplayName } from './languages';
export type { LanguageInfo } from './languages';
export {
  formatDistance,
  distanceSystemFor,
  formatNumber,
  formatPercent,
  formatDateTime,
  formatDate,
  formatTime,
  formatRelative,
  formatMoney,
  formatList,
  formatDuration,
  formatCountdown,
} from './format';
export type { DateInput, FormatDistanceOptions } from './format';
export { NAMESPACES, DEFAULT_NAMESPACE, resources, sourceResources } from './resources';
export type { Namespace, Catalog } from './resources';
export { STATEMENT_PARAMS, NOTIFICATION_PARAMS, PHASE15_NOTIFICATION_PARAMS } from './params';
export * from './keys';
