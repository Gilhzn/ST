/** Legal copy page (always reachable, also signed out). Draft text from the `legal` namespace. */
import { Card, spacing, Text } from '@st/ui';
import { View } from 'react-native';

import { useT } from '@/i18n';

import { Banner } from './States';
import { Screen } from './Screen';

export function LegalPage({ page, sections, testID }: { page: 'privacy' | 'terms' | 'contact'; sections: string[]; testID: string }) {
  const { t } = useT();
  return (
    <Screen title={t(`legal:${page}.title`)} large eyebrow={t('common:app.name')} testID={testID} backFallback="/">
      <Banner tone="warning" text={t('legal:placeholderNotice')} />
      <Text variant="body" color="textSecondary">
        {t(page === 'contact' ? 'legal:contact.body' : `legal:${page}.intro`)}
      </Text>
      {sections.length ? (
        <Card padding="xl">
          <View style={{ gap: spacing.xl }}>
            {sections.map((s, i) => (
              <View key={s} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
                  <Text variant="statSmall" color="primaryText" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text variant="title3" role="heading" aria-level={2} style={{ flex: 1 }}>
                    {t(`legal:${page}.${s}.title`)}
                  </Text>
                </View>
                <Text variant="callout" color="textSecondary">
                  {t(`legal:${page}.${s}.body`)}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
