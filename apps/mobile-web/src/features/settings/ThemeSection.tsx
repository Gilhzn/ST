/** Theme preference (design §13.14): System / Light / Dark radios with a live preview swatch. Persists via the ThemeProvider. */
import { radius, Row, spacing, Stack, Text, useTheme, type ThemePreference } from '@st/ui';
import { View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { useT } from '@/i18n';

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

export function ThemeSection() {
  const { t } = useT();
  const theme = useTheme();
  const { colors } = theme;
  return (
    <Stack gap="sm" testID="settings.theme">
      <Text variant="title3">{t('settings:theme.title')}</Text>
      <Row gap="sm" wrap accessibilityRole="radiogroup" accessibilityLabel={t('settings:theme.title')}>
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
      <Row gap="sm" align="center">
        <Text variant="caption" color="textSecondary">
          {t('settings:theme.preview')}
        </Text>
        {/* Decorative swatch of the active palette; the choice itself is announced by the radios above. */}
        <View
          testID="settings.theme.preview"
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', gap: spacing.xs, padding: spacing.xs, borderRadius: radius.md, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderStrong }}
        >
          {[colors.surface, colors.primary, colors.accent, colors.text].map((c, i) => (
            <View key={i} style={{ width: 24, height: 24, borderRadius: radius.sm, backgroundColor: c, borderWidth: 1, borderColor: colors.border }} />
          ))}
        </View>
      </Row>
    </Stack>
  );
}
