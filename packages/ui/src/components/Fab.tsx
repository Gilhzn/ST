import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { Haptics } from "../haptics";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { borderWidth, radius, sizing, spacing, zIndex } from "../tokens";
import { Gradient } from "./Gradient";
import { Text } from "./Text";
import { usePressScale } from "./usePressScale";
import { showFocusRing } from "../focusVisible";

export interface FabProps extends Omit<PressableProps, "children" | "style"> {
  /** Default "Plus". */
  icon?: IconName;
  /** Always the accessible name; shown visually when `extended`. */
  label: string;
  /** Icon + label pill (wide screens, or the first visit). Default: 56dp round. */
  extended?: boolean;
  /** "accent" (volt, the screen's one volt moment) or "primary". */
  tone?: "accent" | "primary";
  style?: StyleProp<ViewStyle>;
}

/**
 * Floating action button (Create game). Volt sheen gradient, ink glyph, layered glow,
 * spring press and a medium haptic. Position it yourself (end side, above the tab bar).
 */
export function Fab({ icon = "Plus", label, extended, tone = "accent", style, onPress, onPressIn, onPressOut, ...rest }: FabProps) {
  const theme = useTheme();
  const c = theme.colors;
  const press = usePressScale(0.94);
  const fg = tone === "accent" ? "onAccent" : "onPrimary";
  return (
    <Animated.View style={[{ zIndex: zIndex.fab, alignSelf: "flex-start" }, press.style, style]}>
      <Pressable
        role="button"
        aria-label={label}
        onPressIn={(e) => {
          press.onPressIn();
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          press.onPressOut();
          onPressOut?.(e);
        }}
        onPress={(e) => {
          Haptics.trigger("fab");
          onPress?.(e);
        }}
        style={(st) => {
          const { focused: rawFocused } = st as { focused?: boolean };
          const focused = showFocusRing(rawFocused);
          return {
            height: sizing.fab,
            minWidth: sizing.fab,
            borderRadius: extended ? radius.pill : sizing.fab / 2,
            overflow: "hidden",
            boxShadow:
              tone === "accent"
                ? "0px 4px 10px rgba(18, 17, 41, 0.18), 0px 12px 28px rgba(140, 190, 0, 0.35)"
                : "0px 4px 10px rgba(18, 17, 41, 0.18), 0px 12px 28px rgba(91, 61, 245, 0.35)",
            ...(focused
              ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: 3 }
              : null),
          } as ViewStyle;
        }}
        {...rest}
      >
        <Gradient
          name={tone === "accent" ? "volt" : "brand"}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.sm,
            paddingStart: extended ? spacing.lg + 2 : 0,
            paddingEnd: extended ? spacing.xl - 2 : 0,
          }}
        >
          <Icon name={icon} size={24} weight="bold" color={fg} />
          {extended ? (
            <Text variant="headline" weight="semibold" color={fg} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
        </Gradient>
      </Pressable>
    </Animated.View>
  );
}
