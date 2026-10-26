import { type ComponentRef, type Ref, type ReactNode } from "react";
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { borderWidth, radius, sizing, spacing, sportColors, type SportKey } from "../tokens";
import { Text } from "./Text";

export interface ChipProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  selected?: boolean;
  onToggle?: (next: boolean) => void;
  /** Shows the sport marker (shape + color) before the label. */
  sport?: SportKey;
  startIcon?: ReactNode;
  /** "checkbox" for multi-select filters (sports), "radio" for single-select (radius). */
  selectionRole?: "checkbox" | "radio" | "button";
  style?: StyleProp<ViewStyle>;
}

const CHIP_HEIGHT = 40;

/**
 * Selectable filter chip. Selection is shown by fill + border + a ✓ glyph
 * (never color alone) and exposed via accessibilityState.
 * When the 3-sport limit is reached, unselected chips stay focusable but disabled
 * with an accessibilityHint explaining why.
 */
export function Chip({
  label,
  selected = false,
  onToggle,
  onPress,
  sport,
  startIcon,
  selectionRole = "checkbox",
  disabled,
  style,
  accessibilityHint,
  ref,
  ...rest
}: ChipProps & { ref?: Ref<ComponentRef<typeof View>> }) {
  const { colors: c, reducedMotion } = useTheme();
  const slop = (sizing.touchTarget - CHIP_HEIGHT) / 2;
  const state =
    selectionRole === "button"
      ? { selected, disabled: Boolean(disabled) }
      : { checked: selected, disabled: Boolean(disabled) };

  return (
    <Pressable
      ref={ref}
      accessibilityRole={selectionRole}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={state}
      disabled={disabled}
      hitSlop={{ top: slop, bottom: slop }}
      onPress={(e) => {
        onToggle?.(!selected);
        onPress?.(e);
      }}
      style={(st) => {
        const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
        const s: ViewStyle = {
          minHeight: CHIP_HEIGHT,
          paddingStart: spacing.md,
          paddingEnd: spacing.md,
          borderRadius: radius.pill,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          borderWidth: borderWidth.regular,
          borderColor: selected ? c.primary : c.borderStrong,
          backgroundColor: disabled ? c.disabledBg : selected ? c.primarySubtle : pressed ? c.surfaceSunken : c.surface,
          opacity: disabled ? 0.7 : 1,
          transform: pressed && !reducedMotion ? [{ scale: 0.97 }] : undefined,
          ...(focused
            ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: 2 }
            : null),
        };
        return [s, style];
      }}
      {...rest}
    >
      {selected ? (
        <Text variant="label" color="onPrimarySubtle" accessibilityElementsHidden importantForAccessibility="no">
          ✓
        </Text>
      ) : null}
      {sport ? <SportDot sport={sport} /> : startIcon}
      <Text variant="label" color={disabled ? "disabledText" : selected ? "onPrimarySubtle" : "text"} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Small sport marker used inside chips and legends (shape + color). */
export function SportDot({ sport, size = 12 }: { sport: SportKey; size?: number }) {
  const t = sportColors[sport];
  const { colors } = useTheme();
  const common: ViewStyle = {
    width: size,
    height: size,
    backgroundColor: t.color,
    borderWidth: 1,
    borderColor: colors.pinOutline,
  };
  const shape: ViewStyle =
    t.shape === "circle"
      ? { borderRadius: size / 2 }
      : t.shape === "square"
        ? { borderRadius: 2 }
        : t.shape === "diamond"
          ? { borderRadius: 2, transform: [{ rotate: "45deg" }], width: size * 0.8, height: size * 0.8 }
          : t.shape === "shield"
            ? {
                borderTopStartRadius: 2,
                borderTopEndRadius: 2,
                borderBottomStartRadius: size / 2,
                borderBottomEndRadius: size / 2,
              }
            : t.shape === "pill"
              ? { width: size * 1.5, height: size * 0.75, borderRadius: size }
              : { width: size * 0.7, height: size * 1.2, borderRadius: size };
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[common, shape]} />;
}
