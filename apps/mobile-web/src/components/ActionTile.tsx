/**
 * Secondary action as a labelled round tonal button (52dp well + caption), for action rows under
 * a primary CTA (Chat, Directions, Share, Teams…). Spring press; optional unread badge; danger tone.
 */
import { borderWidth, Icon, radius, spacing, Text, usePressScale, useTheme, type IconName } from '@st/ui';
import { Animated, Pressable, View, type ViewStyle } from 'react-native';

import { focusVisible } from './focusVisible';

export function ActionTile({
  icon,
  label,
  onPress,
  testID,
  tone = 'neutral',
  badge,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
  tone?: 'neutral' | 'brand' | 'danger';
  badge?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const press = usePressScale(0.94);
  const [bg, fg] = tone === 'brand' ? [c.primarySubtle, 'onPrimarySubtle'] : tone === 'danger' ? [c.dangerSubtle, 'dangerText'] : [c.surfaceSunken, 'text'];
  return (
    <Animated.View style={[{ flex: 1, minWidth: 64, maxWidth: 104 }, press.style]}>
      <Pressable
        testID={testID}
        role="button"
        aria-label={label}
        aria-disabled={Boolean(disabled)}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={(st) => {
          const { focused } = st as { focused?: boolean };
          return {
            alignItems: 'center',
            gap: spacing.xs + 2,
            paddingTop: spacing.xs,
            paddingBottom: spacing.xs,
            borderRadius: radius.md,
            opacity: disabled ? 0.45 : 1,
            ...(focusVisible(focused) ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: 'solid', outlineOffset: 2 } : null),
          } as ViewStyle;
        }}
      >
        {({ pressed }) => (
          <>
            <View style={{ width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: pressed ? 0.85 : 1, ...(theme.scheme === 'dark' && tone === 'neutral' ? { borderWidth: 1, borderColor: c.border } : null) }}>
              <Icon name={icon} size={22} weight="regular" color={fg} />
              {badge ? <View aria-hidden style={{ position: 'absolute', top: 6, end: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger, borderWidth: 2, borderColor: c.surface }} /> : null}
            </View>
            <Text variant="caption" weight="medium" color={tone === 'danger' ? 'dangerText' : 'textSecondary'} numberOfLines={1} align="center">
              {label}
            </Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}
