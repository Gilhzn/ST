import { NotificationSettings } from '@/features/settings/NotificationSettings';
import { SettingsFrame } from '@/features/settings/SettingsFrame';
import { useT } from '@/i18n';

export default function NotificationsScreen() {
  const { t } = useT();
  return (
    <SettingsFrame title={t('settings:notifications.title')} testID="screen.settings.notifications">
      <NotificationSettings />
    </SettingsFrame>
  );
}
