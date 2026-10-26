import type { ReactNode } from "react";
import { Animated, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { borderWidth, motion, radius, spacing, type ElevationLevel, type SpaceToken } from "../tokens";
import { usePressScale } from "./usePressScale";

export type CardVariant = "elevated" | "outlined" | "filled";

export interface CardProps extends Omit<PressableProps, "children" | "style"> {
  children: ReactNode;
  /** elevated (default): shadow on light, surface + hairline on dark · outlined · filled (sunken, no border). */
  variant?: CardVariant;
  elevation?: ElevationLevel;
  padding?: SpaceToken;
  /** Volt "lane line" on the start edge: marks live / starting-soon items (v1; v2 prefers a status pill). */
  accentEdge?: boolean;
  /** @deprecated use `variant="outlined"`. */
  outlined?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Surface container, radius 20. With `onPress` it becomes one large pressable (role=button)
 * with a subtle spring scale; pass `aria-label` summarizing the card
 * ("Football, 6/10, Today 18:00, 1.2 km").
 */
export function Card({
  children,
  variant,
  elevation = 1,
  padding = "lg",
  accentEdge,
  outlined,
  onPress,
  onPressIn,
  onPressOut,
  style,
  ...rest
}: CardProps) {
  const theme = useTheme();
  const c = theme.colors;
  const v: CardVariant = variant ?? (outlined ? "outlined" : "elevated");
  const press = usePressScale(motion.pressedScaleCard);
  const base: ViewStyle = {
    backgroundColor: v === "filled" ? c.surfaceSunken : c.surface,
    borderRadius: radius.lg,
    padding: spacing[padding],
    ...(v === "outlined" ? { borderWidth: borderWidth.hairline, borderColor: c.border } : v === "elevated" ? theme.elevation(elevation) : null),
    ...(accentEdge ? { borderStartWidth: 4, borderStartColor: c.accent } : null),
  };

  if (!onPress) {
    const { testID, nativeID, role, "aria-label": ariaLabel } = rest;
    return (
      <View style={[base, style]} testID={testID ?? undefined} nativeID={nativeID} role={role} aria-label={ariaLabel}>
        {children}
      </View>
    );
  }

  return (
    <Animated.View style={press.style}>
      <Pressable
        role="button"
        onPress={onPress}
        onPressIn={(e) => {
          press.onPressIn();
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          press.onPressOut();
          onPressOut?.(e);
        }}
        style={(st) => {
          const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
          return [
            base,
            pressed ? { opacity: 0.92 } : null,
            focused
              ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: 2 }
              : null,
            style,
          ];
        }}
        {...rest}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
