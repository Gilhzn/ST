import { LOCALES } from '@st/domain';
import type { Locale } from '@st/domain';

const SIMPLIFIED_REGIONS = new Set(['CN', 'SG', 'MY']);
const TRADITIONAL_REGIONS = new Set(['TW', 'HK', 'MO']);

/** Legacy or alternative language subtags mapped to the ones we use. */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  iw: 'he',
  cmn: 'zh',
  yue: 'zh-Hant',
};

/**
 * Maps one BCP-47 tag (or a legacy platform tag such as `iw`, `zh_TW` or `pt_BR`)
 * to a supported {@link Locale}, or `null` when the language is not supported.
 *
 * - `zh-CN`, `zh-SG`, `zh-Hans*`, plain `zh` → `zh-Hans`
 * - `zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant*`, `yue*` → `zh-Hant`
 * - `pt-BR`, `pt-PT` → `pt`; `iw` → `he`; `en-GB`, `es-419`, ... → their language
 */
export function normalizeLocale(tag: string): Locale | null {
  const parts = tag.trim().replace(/_/g, '-').split('-').filter(Boolean);
  const first = parts[0];
  if (!first) return null;

  let language = first.toLowerCase();
  language = LANGUAGE_ALIASES[language] ?? language;

  let script: string | undefined;
  let region: string | undefined;
  for (const raw of parts.slice(1)) {
    if (raw.length === 1) break; // singleton: start of an extension (-u-, -x-)
    if (!script && /^[A-Za-z]{4}$/.test(raw)) script = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    else if (!region && /^([A-Za-z]{2}|\d{3})$/.test(raw)) region = raw.toUpperCase();
  }

  if (language === 'zh-Hant') return 'zh-Hant';
  if (language === 'zh') {
    if (script === 'Hant') return 'zh-Hant';
    if (script === 'Hans') return 'zh-Hans';
    if (region && TRADITIONAL_REGIONS.has(region)) return 'zh-Hant';
    if (region && SIMPLIFIED_REGIONS.has(region)) return 'zh-Hans';
    return 'zh-Hans';
  }

  return (LOCALES as readonly string[]).includes(language) ? (language as Locale) : null;
}

/**
 * Picks the first supported locale from the device's preferred languages
 * (for example `getLocales().map((l) => l.languageTag)` from `expo-localization`,
 * or `navigator.languages`). Falls back to `en`.
 */
export function detectLocale(systemLocales: readonly string[]): Locale {
  for (const tag of systemLocales) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return 'en';
}
