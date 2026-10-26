import { Screen } from '@/components/Screen';
import { DeleteAccountFlow } from '@/features/settings/DeleteAccountFlow';
import { useT } from '@/i18n';

export default function DeleteAccountScreen() {
  const { t } = useT();
  return (
    <Screen title={t('settings:delete.title')} testID="screen.settings.delete" backFallback="/settings">
      <DeleteAccountFlow />
    </Screen>
  );
}
