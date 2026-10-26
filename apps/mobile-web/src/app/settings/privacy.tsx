import { Screen } from '@/components/Screen';
import { PrivacySettings } from '@/features/settings/PrivacySettings';
import { useT } from '@/i18n';

export default function PrivacyScreen() {
  const { t } = useT();
  return (
    <Screen title={t('settings:privacy.title')} testID="screen.settings.privacy" backFallback="/settings">
      <PrivacySettings />
    </Screen>
  );
}
