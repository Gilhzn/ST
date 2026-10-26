/** Light haptic cues for map filters. No-ops on web and where the OS has haptics off. */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export function tick(): void {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => undefined);
}

export function warn(): void {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
