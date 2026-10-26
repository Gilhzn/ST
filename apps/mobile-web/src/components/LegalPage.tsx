/** Legal copy page (always reachable, also signed out). Draft text from the `legal` namespace. */
import { Stack, Text } from '@st/ui';

import { useT } from '@/i18n';

import { Banner } from './States';
import { Screen } from './Screen';

export function LegalPage({ page, sections, testID }: { page: 'privacy' | 'terms' | 'contact'; sections: string[]; testID: string }) {
  const { t } = useT();
  return (
    <Screen title={t(`legal:${page}.title`)} testID={testID} backFallback="/">
      <Banner tone="warning" text={t('legal:placeholderNotice')} />
      <Text variant="body">{t(page === 'contact' ? 'legal:contact.body' : `legal:${page}.intro`)}</Text>
      {sections.map((s) => (
        <Stack key={s} gap="xs">
          <Text variant="title3">{t(`legal:${page}.${s}.title`)}</Text>
          <Text variant="body" color="textSecondary">
            {t(`legal:${page}.${s}.body`)}
          </Text>
        </Stack>
      ))}
    </Screen>
  );
}
