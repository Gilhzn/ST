/**
 * Notification preferences (design v2 §15.15): a grouped switch per category with tinted
 * icons, safety notices locked on (legal notice), and the OS permission state with a fix.
 */
import { Button, ListGroup, Stack, type IconName, type ListItemLeadTone } from '@st/ui';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { useData } from '@/data/DataProvider';
import { Notice } from '@/features/kit/Notice';
import { useT } from '@/i18n';
import { getPushPermission, registerForPush, type PushPermission } from '@/platform/push';

import { NOTIFICATION_CATEGORIES, useNotificationPrefs, type NotificationCategory } from './notificationPrefs';
import { SwitchRow } from './SwitchRow';

const ICONS: Record<NotificationCategory, [IconName, ListItemLeadTone]> = {
  joinRequests: ['UserPlus', 'brand'],
  approvals: ['CheckCircle', 'success'],
  waitlist: ['Hourglass', 'info'],
  reminders: ['CalendarDots', 'warning'],
  chat: ['ChatsCircle', 'brand'],
};

export function NotificationSettings() {
  const { t } = useT();
  const port = useData();
  const { prefs, setCategory } = useNotificationPrefs();
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshPermission = useCallback(async () => setPermission(await getPushPermission()), []);
  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  const turnOn = async () => {
    setBusy(true);
    try {
      await registerForPush(port);
    } finally {
      setBusy(false);
      void refreshPermission();
    }
  };

  return (
    <Stack gap="xl" testID="settings.notifications">
      {permission === 'denied' ? (
        <Stack gap="sm">
          <Notice tone="warning" icon="BellSlash" text={t('settings:notifications.osOff')} testID="settings.notifications.osOff" />
          {Platform.OS !== 'web' ? (
            <Button testID="settings.notifications.openSettings" variant="secondary" icon="GearSix" label={t('settings:notifications.osOffAction')} onPress={() => void Linking.openSettings()} />
          ) : null}
        </Stack>
      ) : permission === 'undetermined' ? (
        <Button testID="settings.notifications.enable" size="lg" fullWidth icon="Bell" label={t('auth:permissions.notifications.allow')} loading={busy} onPress={() => void turnOn()} />
      ) : permission === 'unavailable' ? (
        <Notice tone="info" icon="Info" text={t('settings:notifications.unavailable')} testID="settings.notifications.unavailable" />
      ) : null}

      <ListGroup title={t('settings:notifications.groupTitle')} footer={t('settings:notifications.deviceNote')}>
        {NOTIFICATION_CATEGORIES.map((c) => (
          <SwitchRow
            key={c}
            testID={`settings.notifications.${c}`}
            icon={ICONS[c][0]}
            tone={ICONS[c][1]}
            label={t(`settings:notifications.${c}`)}
            value={prefs[c]}
            onChange={(on) => setCategory(c, on)}
          />
        ))}
      </ListGroup>
      <ListGroup>
        <SwitchRow
          testID="settings.notifications.safety"
          icon="ShieldCheck"
          tone="success"
          label={t('settings:notifications.safety')}
          help={t('settings:notifications.safetyLocked')}
          value
          disabled
          onChange={() => undefined}
        />
      </ListGroup>
    </Stack>
  );
}
