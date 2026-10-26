import { Stack, Text } from '@st/ui';

import { Screen } from '@/components/Screen';
import { useT } from '@/i18n';

export default function ContactScreen() {
  const { t } = useT();
  return (
    <Screen title={t('legal:contact.title')} testID="screen.legal.contact" backFallback="/">
      <Text variant="body">{t('legal:contact.body')}</Text>
      <Stack gap="xxs">
        <Text variant="label">{t('legal:contact.emailLabel')}</Text>
        <Text variant="body" selectable>
          {t('legal:contact.email')}
        </Text>
      </Stack>
      <Stack gap="xxs">
        <Text variant="label">{t('legal:contact.addressLabel')}</Text>
        <Text variant="body">{t('legal:contact.address')}</Text>
      </Stack>
    </Screen>
  );
}
