/**
 * Segmented control (radio group): one choice of a few. Selection is shown by
 * fill, a heavier outline, bold text and a check glyph, never color alone.
 * Each segment is a 48 dp target; the control wraps its labels at large text sizes.
 */
import { radius, sizing, spacing, Text, useTheme } from '@st/ui';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';

export interface Segment<T extends string> {
  value: T;
  label: string;
  testID?: string;
}

export function SegmentedControl<T extends string>({
  value,
  segments,
  onChange,
  accessibilityLabel,
  testID,
}: {
  value: T;
  segments: readonly Segment<T>[];
  onChange: (next: T) => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const theme = useTheme();
  const { colors } = theme;
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', gap: spacing.xs, padding: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.surfaceSunken }}
    >
      {segments.map((s) => {
        const selected = s.value === value;
        return (
          <Pressable
            key={s.value}
            testID={s.testID}
            accessibilityRole="radio"
            accessibilityLabel={s.label}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={() => onChange(s.value)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: sizing.touchTarget,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.xs,
              paddingStart: spacing.sm,
              paddingEnd: spacing.sm,
              borderRadius: radius.md,
              borderWidth: 2,
              borderColor: selected ? colors.primary : 'transparent',
              backgroundColor: selected ? colors.surface : pressed ? colors.border : 'transparent',
            })}
          >
            {selected ? <Icon name="check" size={16} color="primaryText" /> : null}
            <Text variant={selected ? 'bodyStrong' : 'body'} color={selected ? 'primaryText' : 'textSecondary'} align="center" numberOfLines={2} style={{ flexShrink: 1 }}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
