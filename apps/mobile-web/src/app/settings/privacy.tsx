import { PrivacySettings } from '@/features/settings/PrivacySettings';
import { SettingsFrame } from '@/features/settings/SettingsFrame';
import { useT } from '@/i18n';

export default function PrivacyScreen() {
  const { t } = useT();
  return (
    <SettingsFrame title={t('settings:privacy.title')} testID="screen.settings.privacy">
      <PrivacySettings />
    </SettingsFrame>
  );
}
