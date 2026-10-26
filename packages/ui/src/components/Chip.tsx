import { type ComponentRef, type Ref, type ReactNode } from "react";
import { Animated, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { Haptics } from "../haptics";
import { Icon, SportIcon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { borderWidth, radius, sizing, spacing, sportColors, type SportKey } from "../tokens";
import { Text } from "./Text";
import { usePressScale } from "./usePressScale";
import { showFocusRing } from "../focusVisible";

export interface ChipProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  selected?: boolean;
  onToggle?: (next: boolean) => void;
  /** Shows the sport's Phosphor glyph (sport-colored) before the label. */
  sport?: SportKey;
  /** v2: Phosphor icon before the label. */
  icon?: IconName;
  /** Custom node before the label (v1 API). */
  startIcon?: ReactNode;
  /**
   * "checkbox" for multi-select filters (sports), "radio" for single-select (radius; wrap the
   * group in role="radiogroup"), "tab" for segmented controls (wrap in role="tablist").
   */
  selectionRole?: "checkbox" | "radio" | "tab";
  /** "soft" (default, on canvas/cards) or "elevated" (floating over the map: surface + shadow). */
  tone?: "soft" | "elevated";
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
}

/**
 * Selectable filter chip (pill). Unselected: soft sunken fill. Selected: ink/brand fill +
 * check glyph (never color alone), exposed via aria-checked / aria-selected (works on web).
 * When the 3-sport limit is reached, unselected chips stay focusable but disabled with an
 * accessibilityHint explaining why.
 */
export function Chip({
  label,
  selected = false,
  onToggle,
  onPress,
  sport,
  icon,
  startIcon,
  selectionRole = "checkbox",
  tone = "soft",
  size = "md",
  disabled,
  style,
  accessibilityHint,
  onPressIn,
  onPressOut,
  ref,
  ...rest
}: ChipProps & { ref?: Ref<ComponentRef<typeof View>> }) {
  const theme = useTheme();
  const c = theme.colors;
  const h = size === "sm" ? 32 : 40;
  const slop = (sizing.touchTarget - h) / 2;
  const press = usePressScale(0.95);
  const sel = selected && !disabled;
  const bg = disabled ? c.disabledBg : sel ? c.surfaceInverse : tone === "elevated" ? c.surface : c.surfaceSunken;
  const fg = disabled ? "disabledText" : sel ? "textInverse" : "text";

  const lead = sel ? (
    <Icon name="Check" size={16} weight="bold" color="textInverse" />
  ) : sport ? (
    <SportIcon sport={sport} size={18} weight="duotone" color={disabled ? c.disabledText : theme.sport(sport).text} />
  ) : icon ? (
    <Icon name={icon} size={16} weight="bold" color={fg} />
  ) : (
    startIcon
  );

  return (
    <Animated.View style={[press.style, style]}>
      <Pressable
        ref={ref}
        role={selectionRole}
        aria-label={label}
        accessibilityHint={accessibilityHint}
        aria-checked={selectionRole === "tab" ? undefined : selected}
        aria-selected={selectionRole === "tab" ? selected : undefined}
        aria-disabled={Boolean(disabled)}
        disabled={disabled}
        hitSlop={{ top: slop, bottom: slop }}
        onPressIn={(e) => {
          press.onPressIn();
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          press.onPressOut();
          onPressOut?.(e);
        }}
        onPress={(e) => {
          Haptics.trigger("chipToggle");
          onToggle?.(!selected);
          onPress?.(e);
        }}
        style={(st) => {
          const { pressed, focused: rawFocused } = st as { pressed: boolean; focused?: boolean };
          const focused = showFocusRing(rawFocused);
          const s: ViewStyle = {
            minHeight: h,
            paddingStart: lead ? spacing.md - 2 : spacing.md + 2,
            paddingEnd: spacing.md + 2,
            borderRadius: radius.pill,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs + 2,
            backgroundColor: bg,
            opacity: pressed && !sel ? 0.85 : 1,
            ...(tone === "elevated" && !sel ? theme.elevation(2) : null),
            ...(tone === "soft" && !sel && theme.scheme === "dark" ? { borderWidth: 1, borderColor: c.border } : null),
            ...(focused
              ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: 2 }
              : null),
          };
          return s;
        }}
        {...rest}
      >
        {lead}
        <Text variant={size === "sm" ? "footnote" : "label"} weight={sel ? "semibold" : "medium"} color={fg} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * @deprecated v1 shape marker. Use `SportIcon` / `SportGlyphBadge` (the glyph is the v2 cue).
 * Kept so existing screens compile; renders the v2 sport glyph in a tiny solid well.
 */
export function SportDot({ sport, size = 12 }: { sport: SportKey; size?: number }) {
  const d = Math.max(size + 6, 16);
  return (
    <View
      aria-hidden
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: sportColors[sport].color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={sportColors[sport].phosphor} size={Math.round(d * 0.66)} weight="fill" color="#FFFFFF" />
    </View>
  );
}
