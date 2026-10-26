import type { ReactNode } from "react";
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { borderWidth, radius, spacing, type ElevationLevel, type SpaceToken } from "../tokens";

export interface CardProps extends Omit<PressableProps, "children" | "style"> {
  children: ReactNode;
  elevation?: ElevationLevel;
  padding?: SpaceToken;
  /** Volt "lane line" on the start edge: marks live / starting-soon items. */
  accentEdge?: boolean;
  /** Outline instead of shadow (lists, dense layouts). */
  outlined?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Surface container. With `onPress` it becomes one large pressable (role=button);
 * pass `aria-label` summarizing the card ("Football, 6/10, Today 18:00, 1.2 km").
 */
export function Card({
  children,
  elevation = 1,
  padding = "lg",
  accentEdge,
  outlined,
  onPress,
  style,
  ...rest
}: CardProps) {
  const theme = useTheme();
  const c = theme.colors;
  const base: ViewStyle = {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    padding: spacing[padding],
    overflow: "hidden",
    ...(outlined ? { borderWidth: borderWidth.hairline, borderColor: c.border } : theme.elevation(elevation)),
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
    <Pressable
      role="button"
      onPress={onPress}
      style={(st) => {
        const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
        return [
          base,
          pressed ? { backgroundColor: c.surfaceSunken } : null,
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
  );
}
