/**
 * Segmented step progress (design v2 §15.5): equal bars, brand fill, 4 dp, gap 4.
 * Flows start → end, so it mirrors in RTL. The caption is a polite live region.
 */
import { radius, spacing, Text, useTheme } from '@st/ui';
import { View } from 'react-native';

export function StepBar({ total, current, caption, testID }: { total: number; current: number; caption: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ gap: spacing.sm }}>
      <View aria-hidden style={{ flexDirection: 'row', gap: spacing.xs }}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: i < current ? colors.primary : colors.surfaceSunken }} />
        ))}
      </View>
      <Text variant="footnote" weight="medium" color="textSecondary" aria-live="polite">
        {caption}
      </Text>
    </View>
  );
}
