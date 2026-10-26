import { SettingsFrame } from '@/features/settings/SettingsFrame';
import { LanguagePicker } from '@/features/settings/LanguagePicker';
import { useT } from '@/i18n';

/** Language picker: 13 locales in their native names; device language option; RTL restart prompt on native. */
export default function LanguageScreen() {
  const { t } = useT();
  return (
    <SettingsFrame title={t('settings:language.title')} testID="screen.settings.language">
      <LanguagePicker />
    </SettingsFrame>
  );
}
