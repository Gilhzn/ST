import { getLocales } from 'expo-localization';

/** Device region (ISO 3166-1 alpha-2) for phone defaults, units and currency hints. */
export function deviceRegion(): string | null {
  try {
    const l = getLocales()[0];
    return l?.regionCode ?? l?.languageRegionCode ?? null;
  } catch {
    return null;
  }
}
