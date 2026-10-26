/**
 * Per-device preferences in AsyncStorage (localStorage on web). Never stores
 * secrets or personal data beyond UI choices. All reads tolerate missing or
 * corrupt values.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'st.pref.';

export const PrefKeys = {
  themePreference: 'themePreference',
  /** Explicit UI language, or absent to follow the device. */
  locale: 'locale',
  /** Epoch ms until which the age gate is soft-locked after an under-16 answer (design §13.2). */
  ageGateLockedUntil: 'ageGateLockedUntil',
  /** The prominent location disclosure was shown (accepted or not). */
  locationDisclosureSeen: 'locationDisclosureSeen',
  mapFilters: 'mapFilters',
  createGameDraft: 'createGameDraft',
  /** Guards the one automatic reload that aligns native RTL with the saved language. */
  rtlReloadAttempted: 'rtlReloadAttempted',
} as const;

export type PrefKey = (typeof PrefKeys)[keyof typeof PrefKeys];

export async function getPref<T>(key: PrefKey): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export async function setPref<T>(key: PrefKey, value: T | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(PREFIX + key);
    else await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode); preferences just won't persist.
  }
}
