/** Settings (design §13.14). Language/theme/sign-out now; full sections next wave. */
import { Button, Divider, Row, Stack, Text, useTheme, type ThemePreference } from '@st/ui';
import { router } from 'expo-router';

import { ChoiceChip } from '@/components/ChoiceChip';
import { Screen } from '@/components/Screen';
import { LanguagePicker } from '@/features/settings/LanguagePicker';
import { useT } from '@/i18n';
import { useSession } from '@/state/session';

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

export default function SettingsScreen() {
  const { t } = useT();
  const theme = useTheme();
  const session = useSession();
  return (
    <Screen title={t('settings:title')} testID="screen.settings" backFallback="/profile">
      <Stack gap="lg">
        <LanguagePicker />
        <Divider />
        <Stack gap="sm">
          <Text variant="title3">{t('settings:theme.title')}</Text>
          <Row gap="sm" wrap accessibilityRole="radiogroup">
            {THEMES.map((p) => (
              <ChoiceChip
                key={p}
                testID={`settings.theme.${p}`}
                label={t(`settings:theme.${p}`)}
                selectionRole="radio"
                selected={theme.preference === p}
                onToggle={() => theme.setPreference(p)}
              />
            ))}
          </Row>
        </Stack>
        <Divider />
        <Stack gap="sm">
          <Text variant="title3">{t('settings:section.legal')}</Text>
          <Row gap="sm" wrap>
            <Button variant="ghost" label={t('legal:privacy.title')} onPress={() => router.push('/legal/privacy')} />
            <Button variant="ghost" label={t('legal:terms.title')} onPress={() => router.push('/legal/terms')} />
            <Button variant="ghost" label={t('legal:contact.title')} onPress={() => router.push('/legal/contact')} />
          </Row>
        </Stack>
        <Divider />
        <Button testID="settings.signOut" variant="secondary" label={t('settings:account.signOut')} onPress={() => void session.signOut()} />
      </Stack>
    </Screen>
  );
}
