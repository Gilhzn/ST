/**
 * Theme preference row (design v2 §15.15): icon + title with a live swatch of the active
 * palette, then System | Light | Dark as a Segmented control (radio semantics). Persists via
 * the ThemeProvider.
 */
import { Icon, radius, Row, Segmented, spacing, Text, useTheme, type ThemePreference } from '@st/ui';
import { View } from 'react-native';

import { useT } from '@/i18n';

export function ThemeSection() {
  const { t } = useT();
  const theme = useTheme();
  const { colors } = theme;
  return (
    <View testID="settings.theme" style={{ paddingStart: spacing.lg, paddingEnd: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.md }}>
      <Row gap="md">
        <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="Moon" size={20} weight="duotone" color="textSecondary" />
        </View>
        <Text variant="body" style={{ flex: 1 }}>
          {t('settings:theme.title')}
        </Text>
        {/* Decorative swatch of the active palette; the choice itself is announced by the radios. */}
        <View
          testID="settings.theme.preview"
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', padding: 3, gap: 3, borderRadius: radius.pill, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
        >
          {[colors.surface, colors.primary, colors.accent, colors.text].map((c, i) => (
            <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c, borderWidth: 1, borderColor: colors.border }} />
          ))}
        </View>
      </Row>
      <Segmented<ThemePreference>
        label={t('settings:theme.title')}
        value={theme.preference}
        onChange={(p) => theme.setPreference(p)}
        size="sm"
        options={[
          { value: 'system', label: t('settings:theme.system'), icon: 'GearSix', testID: 'settings.theme.system' },
          { value: 'light', label: t('settings:theme.light'), icon: 'Sun', testID: 'settings.theme.light' },
          { value: 'dark', label: t('settings:theme.dark'), icon: 'Moon', testID: 'settings.theme.dark' },
        ]}
      />
    </View>
  );
}
