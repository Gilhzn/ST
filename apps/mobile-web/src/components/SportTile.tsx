/**
 * Large selectable sport tile (design v2 §15.1 / §15.5): filled card, sport glyph badge, name.
 * Selected = sport-tinted surface, 2dp sport-colored border and a check disc at the top-end
 * (never color alone). Spring press + chip haptic. role checkbox (multi) or radio (single).
 */
import type { SportId } from '@st/domain';
import { borderWidth, Haptics, Icon, radius, spacing, SportGlyphBadge, sportColors, Text, usePressScale, useTheme } from '@st/ui';
import { Animated, Pressable, View, type ViewStyle } from 'react-native';

export function SportTile({
  sport,
  label,
  caption,
  selected,
  onPress,
  testID,
  role = 'checkbox',
  disabled,
}: {
  sport: SportId;
  label: string;
  caption?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  role?: 'checkbox' | 'radio';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.sport(sport);
  const press = usePressScale(0.96);
  const accent = theme.scheme === 'dark' ? s.text : sportColors[sport].color;
  return (
    <Animated.View style={[{ flexGrow: 1, flexBasis: '45%' }, press.style]}>
      <Pressable
        testID={testID}
        role={role}
        aria-checked={selected}
        aria-disabled={Boolean(disabled)}
        aria-label={caption ? `${label}, ${caption}` : label}
        disabled={disabled}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => {
          Haptics.trigger('chipToggle');
          onPress();
        }}
        style={(st) => {
          const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
          return {
            minHeight: 104,
            padding: spacing.lg,
            gap: spacing.md,
            borderRadius: radius.lg,
            borderWidth: borderWidth.thick,
            borderColor: selected ? accent : theme.scheme === 'dark' ? c.border : 'transparent',
            backgroundColor: selected ? s.tint : pressed ? c.surfaceSunken : c.surface,
            opacity: disabled ? 0.5 : 1,
            ...(selected ? null : theme.elevation(1)),
            ...(focused ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: 'solid', outlineOffset: 2 } : null),
          } as ViewStyle;
        }}
      >
        <SportGlyphBadge sport={sport} size={44} variant={selected ? 'solid' : 'tint'} squircle />
        <View style={{ gap: 2 }}>
          <Text variant="headline" color={selected ? s.text : 'text'} numberOfLines={1}>
            {label}
          </Text>
          {caption ? (
            <Text variant="footnote" color={selected ? s.text : 'textSecondary'} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
        </View>
        <View
          aria-hidden
          style={{
            position: 'absolute',
            top: spacing.md,
            end: spacing.md,
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected ? accent : 'transparent',
            borderWidth: selected ? 0 : 1.5,
            borderColor: c.borderStrong,
          }}
        >
          {selected ? <Icon name="Check" size={14} weight="bold" color={theme.scheme === 'dark' ? '#08071A' : '#FFFFFF'} /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}
