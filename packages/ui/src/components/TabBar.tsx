import type { ReactNode } from "react";
import { Animated, Platform, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";

import { isolate } from "../bidi";
import { Haptics } from "../haptics";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { borderWidth, radius, sizing, spacing, zIndex } from "../tokens";
import { Text } from "./Text";
import { usePressScale } from "./usePressScale";

export interface TabBarProps {
  children: ReactNode;
  /** Safe-area bottom inset (from react-native-safe-area-context). */
  bottomInset?: number;
  /** Translucent blur (iOS + web). Android always uses a solid surface. Default true. */
  blur?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Bottom tab bar container: blur material on iOS/web (solid on Android), hairline top edge,
 * 64dp + safe area. role="tablist". Put `TabBarItem`s inside (or expo-router TabTriggers asChild).
 */
export function TabBar({ children, bottomInset = 0, blur = true, testID, style }: TabBarProps) {
  const theme = useTheme();
  const c = theme.colors;
  const useBlur = blur && Platform.OS !== "android";
  const row = (
    <View style={{ flexDirection: "row", alignItems: "stretch", minHeight: sizing.tabBar, paddingStart: spacing.sm, paddingEnd: spacing.sm }}>
      {children}
    </View>
  );
  return (
    <View
      testID={testID}
      role="tablist"
      style={[
        {
          paddingBottom: bottomInset,
          borderTopWidth: borderWidth.hairline,
          borderTopColor: c.border,
          backgroundColor: useBlur ? c.surfaceGlass : c.surface,
          zIndex: zIndex.sticky,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {useBlur ? (
        <BlurView
          intensity={60}
          tint={theme.scheme === "dark" ? "dark" : "light"}
          style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0 }}
        />
      ) : null}
      {row}
    </View>
  );
}

export interface TabBarItemProps extends Omit<PressableProps, "children" | "style"> {
  icon: IconName;
  label: string;
  active?: boolean;
  /** Unread count (number) or dot (true). */
  badge?: number | boolean;
  /** Rail layout (vertical, 80dp) for ≥ 768 web. */
  vertical?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Tab: Phosphor icon (fill when active) inside a 56×32 active pill, label below
 * (semibold when active). Active is never color-only: fill glyph + pill + weight.
 * role="tab" + aria-selected. Selection haptic on native.
 */
export function TabBarItem({ icon, label, active = false, badge, vertical, style, onPress, onPressIn, onPressOut, ...rest }: TabBarItemProps) {
  const theme = useTheme();
  const c = theme.colors;
  const press = usePressScale(0.92);
  const count = typeof badge === "number" ? (badge > 99 ? "99+" : String(badge)) : null;
  return (
    <Pressable
      role="tab"
      aria-selected={active}
      aria-label={count ? `${label}, ${count}` : label}
      onPressIn={(e) => {
        press.onPressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press.onPressOut();
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (!active) Haptics.trigger("tabChange");
        onPress?.(e);
      }}
      style={(st) => {
        const { focused } = st as { focused?: boolean };
        return [
          {
            flex: vertical ? undefined : 1,
            width: vertical ? sizing.railWidth : undefined,
            minHeight: vertical ? 68 : sizing.tabBar,
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            ...(focused ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: -4 } : null),
          } as ViewStyle,
          style,
        ];
      }}
      {...rest}
    >
      <Animated.View
        style={[
          {
            width: 56,
            height: 32,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: active ? c.primarySubtle : "transparent",
          },
          press.style,
        ]}
      >
        <Icon name={icon} size={24} weight={active ? "fill" : "regular"} color={active ? "primary" : "textSecondary"} />
        {badge ? (
          <View
            aria-hidden
            style={{
              position: "absolute",
              top: count ? -3 : 2,
              end: count ? 6 : 14,
              minWidth: count ? 18 : 9,
              height: count ? 18 : 9,
              paddingStart: count ? 4 : 0,
              paddingEnd: count ? 4 : 0,
              borderRadius: radius.pill,
              backgroundColor: c.danger,
              borderWidth: 2,
              borderColor: c.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {count ? (
              <Text variant="caption" weight="bold" color="onDanger" allowFontScaling={false} style={{ fontSize: 10, lineHeight: 12 }}>
                {isolate(count, "ltr")}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Animated.View>
      <Text variant="caption" weight={active ? "semibold" : "medium"} color={active ? "primaryText" : "textSecondary"} numberOfLines={1} style={{ fontSize: 11.5, letterSpacing: 0.1 }}>
        {label}
      </Text>
    </Pressable>
  );
}
