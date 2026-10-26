/**
 * Native app restart, used after switching between LTR and RTL languages
 * (I18nManager.forceRTL only applies after a reload; design §13.17).
 */
import * as Updates from 'expo-updates';
import { DevSettings } from 'react-native';

export async function restartApp(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    // expo-updates is disabled in development builds.
    DevSettings.reload();
  }
}
