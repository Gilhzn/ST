import { Screen } from '@/components/Screen';
import { LanguagePicker } from '@/features/settings/LanguagePicker';
import { useT } from '@/i18n';

/** Language picker: 13 locales in their native names; device language option; RTL restart prompt on native. */
export default function LanguageScreen() {
  const { t } = useT();
  return (
    <Screen title={t('settings:language.title')} testID="screen.settings.language" backFallback="/settings">
      <LanguagePicker showTitle={false} />
    </Screen>
  );
}
