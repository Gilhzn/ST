/**
 * Readable legal page (design v2 §5 typography): large title, a draft notice, a lead
 * paragraph, then numbered sections (tabular "01" overline, title, relaxed body text) at a
 * comfortable reading width. Always reachable, also signed out.
 */
import { isolate, radius, spacing, Stack, Text, useTheme } from '@st/ui';
import { View } from 'react-native';

import { Notice } from '@/features/kit/Notice';
import { SettingsFrame } from '@/features/settings/SettingsFrame';
import { useT } from '@/i18n';
import { formatNumber } from '@/lib/format';

export function LegalArticle({ page, sections, testID }: { page: 'privacy' | 'terms'; sections: string[]; testID: string }) {
  const { t, locale } = useT();
  const theme = useTheme();
  return (
    <SettingsFrame title={t(`legal:${page}.title`)} testID={testID} backFallback="/">
      <View style={{ maxWidth: 680, gap: spacing.xl }}>
        <Notice tone="warning" icon="FileText" text={t('legal:placeholderNotice')} live="off" />
        <Text variant="body" style={{ fontSize: 18, lineHeight: 28 }}>
          {t(`legal:${page}.intro`)}
        </Text>
        <View style={{ borderRadius: radius.lg, overflow: 'hidden', ...theme.elevation(1) }}>
          {sections.map((s, i) => (
            <View key={s} style={{ flexDirection: 'row', gap: spacing.lg, padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl, borderTopWidth: i ? 1 : 0, borderTopColor: theme.colors.border }}>
              <Text variant="statSmall" color="primaryText" aria-hidden style={{ width: 28 }}>
                {isolate(formatNumber(i + 1, locale, { minimumIntegerDigits: 2 }), 'ltr')}
              </Text>
              <Stack gap="sm" style={{ flex: 1 }}>
                <Text variant="title3">{t(`legal:${page}.${s}.title`)}</Text>
                <Text variant="body" color="textSecondary" style={{ lineHeight: 26 }}>
                  {t(`legal:${page}.${s}.body`)}
                </Text>
              </Stack>
            </View>
          ))}
        </View>
      </View>
    </SettingsFrame>
  );
}
