/**
 * Notification preferences (design §13.14): a switch per category, safety notices
 * locked on (legal notice), and the OS permission state with a way to fix it.
 */
import { Button, Divider, Stack, Text } from '@st/ui';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { Banner } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { useT } from '@/i18n';
import { getPushPermission, registerForPush, type PushPermission } from '@/platform/push';

import { NOTIFICATION_CATEGORIES, useNotificationPrefs } from './notificationPrefs';
import { SwitchRow } from './SwitchRow';

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
    <Stack gap="md" testID="settings.notifications">
      {permission === 'denied' ? (
        <Stack gap="sm">
          <Banner tone="warning" text={t('settings:notifications.osOff')} testID="settings.notifications.osOff" />
          {Platform.OS !== 'web' ? (
            <Button testID="settings.notifications.openSettings" variant="secondary" label={t('settings:notifications.osOffAction')} onPress={() => void Linking.openSettings()} />
          ) : null}
        </Stack>
      ) : permission === 'undetermined' ? (
        <Button testID="settings.notifications.enable" label={t('auth:permissions.notifications.allow')} loading={busy} onPress={() => void turnOn()} />
      ) : permission === 'unavailable' ? (
        <Banner tone="info" text={t('settings:notifications.unavailable')} testID="settings.notifications.unavailable" />
      ) : null}

      <Stack gap="xxs" accessibilityRole="list">
        {NOTIFICATION_CATEGORIES.map((c) => (
          <SwitchRow
            key={c}
            testID={`settings.notifications.${c}`}
            label={t(`settings:notifications.${c}`)}
            value={prefs[c]}
            onChange={(on) => setCategory(c, on)}
          />
        ))}
        <Divider />
        <SwitchRow
          testID="settings.notifications.safety"
          label={t('settings:notifications.safety')}
          help={t('settings:notifications.safetyLocked')}
          value
          disabled
          onChange={() => undefined}
        />
      </Stack>
      <Text variant="caption" color="textSecondary">
        {t('settings:notifications.deviceNote')}
      </Text>
    </Stack>
  );
}
