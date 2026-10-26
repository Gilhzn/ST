/**
 * Floating map controls: glass search bar (with the list/map toggle), "Search this area",
 * round icon buttons (recenter) and the volt Create FAB. Every control keeps its e2e test id.
 */
import { Fab, fontWeights, Icon, IconButton, Text, useTheme, type FontWeightKey, type IconName } from '@st/ui';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, TextInput, View, type TextStyle } from 'react-native';

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
        <Icon name="MagnifyingGlass" size={20} weight="bold" color="text" style={{ flexShrink: 0 }} />
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
export function ViewToggle({ testID, icon, label, onPress }: { testID: string; icon: IconName; label: string; onPress: () => void }) {
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
      <Icon name={icon} size={18} weight="bold" color="onPrimary" />
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
        <Icon name="ArrowClockwise" size={16} weight="bold" color="textInverse" />
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
  icon: IconName;
  label: string;
  onPress: () => void;
  busy?: boolean;
  active?: boolean;
}) {
  return (
    <IconButton
      testID={testID}
      icon={icon}
      label={label}
      variant="glass"
      size="lg"
      weight={active ? 'fill' : 'regular'}
      color={active ? 'primary' : 'text'}
      accessibilityState={{ busy: !!busy }}
      style={busy ? { opacity: 0.7 } : undefined}
      onPress={onPress}
    />
  );
}

/** Volt Create FAB (`@st/ui` Fab). */
export function CreateFab({ label, onPress, extended }: { label: string; onPress: () => void; extended: boolean }) {
  return <Fab testID="map.fab.create" label={label} extended={extended} onPress={onPress} />;
}
