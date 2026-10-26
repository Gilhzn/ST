import { Screen } from '@/components/Screen';
import { NotificationSettings } from '@/features/settings/NotificationSettings';
import { useT } from '@/i18n';

export default function NotificationsScreen() {
  const { t } = useT();
  return (
    <Screen title={t('settings:notifications.title')} testID="screen.settings.notifications" backFallback="/settings">
      <NotificationSettings />
    </Screen>
  );
}
