/**
 * Native push (expo-notifications → Expo Push Service; `push-dispatch` sends).
 * Ask only after a meaningful moment (first join request / game creation) with
 * the in-app primer first (compliance §5.1). Tokens are registered through the
 * DataPort and refreshed on change.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { DataPort } from '@/data/DataPort';

export type PushPermission = 'granted' | 'undetermined' | 'denied' | 'unavailable';
export type PushRegistration = 'registered' | 'denied' | 'unavailable';

let handlerConfigured = false;

/** Foreground presentation: show banners for game updates while the app is open. */
export function configureNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export async function getPushPermission(): Promise<PushPermission> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/** Requests permission (after the primer), fetches the Expo token and registers it. */
export async function registerForPush(port: DataPort): Promise<PushRegistration> {
  try {
    configureNotificationHandler();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Game updates',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const p = await Notifications.requestPermissionsAsync();
    if (!p.granted) return 'denied';
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await port.registerPushToken(data, Platform.OS === 'ios' ? 'ios' : 'android');
    return 'registered';
  } catch {
    return 'unavailable';
  }
}

/** Keeps the server copy current when the OS rotates the token. Returns an unsubscribe. */
export function watchPushToken(port: DataPort): () => void {
  const sub = Notifications.addPushTokenListener(() => {
    void registerForPush(port);
  });
  return () => sub.remove();
}

/** Deep link carried by our notifications (`data.url`), for the tap handler. */
export function addNotificationTapListener(onUrl: (url: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const url = (r.notification.request.content.data as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string') onUrl(url);
  });
  return () => sub.remove();
}
