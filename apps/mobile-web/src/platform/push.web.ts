/**
 * Web push is a later phase (opt-in from Settings only, never on page load —
 * compliance §5.3). Web relies on the in-app inbox until then.
 * TODO(web-push): VAPID keys + service worker + `registerPushToken(sub, 'web')`.
 */
import type { DataPort } from '@/data/DataPort';

export type PushPermission = 'granted' | 'undetermined' | 'denied' | 'unavailable';
export type PushRegistration = 'registered' | 'denied' | 'unavailable';

export function configureNotificationHandler(): void {}

export async function getPushPermission(): Promise<PushPermission> {
  return 'unavailable';
}

export async function registerForPush(_port: DataPort): Promise<PushRegistration> {
  return 'unavailable';
}

export function watchPushToken(_port: DataPort): () => void {
  return () => undefined;
}

export function addNotificationTapListener(_onUrl: (url: string) => void): () => void {
  return () => undefined;
}
