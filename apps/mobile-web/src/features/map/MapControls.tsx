/**
 * Floating map controls: glass search bar (with the list/map toggle), "Search this area",
 * round icon buttons (recenter) and the volt Create FAB. Every control keeps its e2e test id.
 */
import { fontWeights, Text, useTheme, type FontWeightKey } from '@st/ui';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, TextInput, View, type TextStyle } from 'react-native';

import type { GlyphName } from '@/platform/map/glyphs';
import { GlyphIcon } from '@/platform/map/markers';

import { Glass } from './Glass';

/** Weight style that respects per-script families (native Noto embeds the weight). */
export function useWeight(): (w: FontWeightKey) => TextStyle {
  const theme = useTheme();
  return (w) => {
    const family = theme.fontFamily(w);
    return { ...(family ? { fontFamily: family } : null), ...(theme.usesWeightedFamilies ? null : { fontWeight: fontWeights[w] }) };
  };
}

export function SearchBar({
  value,
  onChangeText,
  onSubmit,
  label,
  placeholder,
  trailing,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder: string;
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  const weight = useWeight();
  return (
    <Glass radius={26}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 52, paddingStart: 16, paddingEnd: 6, gap: 10 }}>
        <GlyphIcon name="search" size={20} color={theme.colors.text} />
        <TextInput
          testID="map.search.input"
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textTertiary}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
          autoCorrect={false}
          style={[
            {
              flex: 1,
              height: 48,
              fontSize: 16,
              color: theme.colors.text,
              textAlign: 'auto',
              writingDirection: 'auto',
            } as TextStyle,
            { outlineStyle: 'none' } as unknown as TextStyle,
            weight('medium'),
          ]}
        />
        {trailing}
      </View>
    </Glass>
  );
}

/** Pill inside the search bar that flips between map and list. */
export function ViewToggle({ testID, icon, label, onPress }: { testID: string; icon: GlyphName; label: string; onPress: () => void }) {
  const theme = useTheme();
  const weight = useWeight();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 40,
        paddingStart: 12,
        paddingEnd: 14,
        borderRadius: 20,
        backgroundColor: pressed ? theme.colors.primaryPressed : theme.colors.primary,
        transform: pressed && !theme.reducedMotion ? [{ scale: 0.97 }] : undefined,
      })}
    >
      <GlyphIcon name={icon} size={18} color={theme.colors.onPrimary} />
      <Text variant="label" style={[{ color: theme.colors.onPrimary }, weight('semibold')]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** "Search this area": appears after the user pans away from the searched centre. */
export function SearchAreaButton({ visible, label, onPress }: { visible: boolean; label: string; onPress: () => void }) {
  const theme = useTheme();
  const weight = useWeight();
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: visible ? 1 : 0, duration: theme.reducedMotion ? 0 : 200, useNativeDriver: true }).start();
  }, [visible, theme.reducedMotion]);
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={{
        alignSelf: 'center',
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }, { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
      }}
    >
      <Pressable
        testID="map.searchArea"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 40,
          paddingStart: 14,
          paddingEnd: 16,
          borderRadius: 20,
          backgroundColor: theme.colors.surfaceInverse,
          transform: pressed && !theme.reducedMotion ? [{ scale: 0.97 }] : undefined,
          boxShadow: '0px 6px 18px rgba(11,10,28,0.28)',
        })}
      >
        <GlyphIcon name="refresh" size={16} color={theme.colors.textInverse} />
        <Text variant="label" style={[{ color: theme.colors.textInverse }, weight('semibold')]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function RoundButton({
  testID,
  icon,
  label,
  onPress,
  busy,
  active,
}: {
  testID: string;
  icon: GlyphName;
  label: string;
  onPress: () => void;
  busy?: boolean;
  active?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy }}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
        opacity: busy ? 0.7 : 1,
        transform: pressed && !theme.reducedMotion ? [{ scale: 0.95 }] : undefined,
        boxShadow: theme.scheme === 'dark' ? '0px 6px 16px rgba(0,0,0,0.5)' : '0px 6px 16px rgba(18,17,41,0.16)',
      })}
    >
      <GlyphIcon name={icon} size={22} color={active ? theme.colors.primary : theme.colors.text} />
    </Pressable>
  );
}

export function CreateFab({ label, onPress, extended }: { label: string; onPress: () => void; extended: boolean }) {
  const theme = useTheme();
  const weight = useWeight();
  return (
    <Pressable
      testID="map.fab.create"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 56,
        minWidth: 56,
        borderRadius: 28,
        flexDirection: 'row',
        gap: 8,
        paddingStart: extended ? 18 : 0,
        paddingEnd: extended ? 22 : 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors.accentPressed : theme.colors.accent,
        transform: pressed && !theme.reducedMotion ? [{ scale: 0.96 }] : undefined,
        boxShadow: '0px 10px 24px rgba(120,160,0,0.35), 0px 2px 6px rgba(11,10,28,0.2)',
      })}
    >
      <GlyphIcon name="plus" size={24} color={theme.colors.onAccent} />
      {extended ? (
        <Text variant="bodyStrong" style={[{ color: theme.colors.onAccent }, weight('bold')]}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}
