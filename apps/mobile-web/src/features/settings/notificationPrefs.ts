/**
 * Per-category notification choices. The DataPort has no preferences API yet, so
 * they are stored on this device (AsyncStorage / localStorage) and the screen says so.
 * Account and safety notices (sanctions, legal) can never be switched off.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

export const NOTIFICATION_CATEGORIES = ['joinRequests', 'approvals', 'waitlist', 'reminders', 'chat'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationPrefs = Record<NotificationCategory, boolean>;

const KEY = 'st.settings.notifications';
const DEFAULTS: NotificationPrefs = { joinRequests: true, approvals: true, waitlist: true, reminders: true, chat: true };

export function parseNotificationPrefs(raw: string | null): NotificationPrefs {
  if (!raw) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const out = { ...DEFAULTS };
    for (const c of NOTIFICATION_CATEGORIES) if (typeof parsed[c] === 'boolean') out[c] = parsed[c];
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export function useNotificationPrefs(): { prefs: NotificationPrefs; loaded: boolean; setCategory: (c: NotificationCategory, on: boolean) => void } {
  const [prefs, setPrefs] = useState<NotificationPrefs>({ ...DEFAULTS });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (alive) setPrefs(parseNotificationPrefs(raw));
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setCategory = useCallback((c: NotificationCategory, on: boolean) => {
    setPrefs((prev) => {
      const next = { ...prev, [c]: on };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  return { prefs, loaded, setCategory };
}
