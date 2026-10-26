import { DeleteAccountFlow } from '@/features/settings/DeleteAccountFlow';
import { SettingsFrame } from '@/features/settings/SettingsFrame';
import { useT } from '@/i18n';

export default function DeleteAccountScreen() {
  const { t } = useT();
  return (
    <SettingsFrame title={t('settings:delete.title')} testID="screen.settings.delete">
      <DeleteAccountFlow />
    </SettingsFrame>
  );
}
