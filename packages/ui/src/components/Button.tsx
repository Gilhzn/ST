import { type ComponentRef, type Ref, type ReactNode } from "react";
import { ActivityIndicator, Animated, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { Haptics } from "../haptics";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { borderWidth, radius, sizing, spacing, type HapticEvent, type SemanticColors } from "../tokens";
import { Text } from "./Text";
import { usePressScale } from "./usePressScale";

/**
 * primary: brand fill · secondary: tonal (brand tint) · outline: hairline border ·
 * ghost: text only · danger: destructive fill · accent: volt fill (one per screen).
 */
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** v2: Phosphor icon before the label (start edge). Directional icons mirror automatically. */
  icon?: IconName;
  /** v2: Phosphor icon after the label (e.g. "CaretRight", "ArrowRight"). */
  iconEnd?: IconName;
  /** Custom node before the label (v1 API; prefer `icon`). */
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Announced instead of the label when loading (e.g. "Joining game…"). */
  loadingLabel?: string;
  /** Haptic on press (native only). Defaults: primary/accent → light; others → none. */
  haptic?: HapticEvent | "none";
}

const heights: Record<ButtonSize, number> = { sm: sizing.buttonSm, md: sizing.buttonMd, lg: sizing.buttonLg };
const padX: Record<ButtonSize, number> = { sm: spacing.md, md: spacing.lg + spacing.xs, lg: spacing.xl };
const iconPx: Record<ButtonSize, number> = { sm: 16, md: 20, lg: 20 };

interface Palette {
  bg: string;
  bgPressed: string;
  fg: keyof SemanticColors;
  border?: string;
}

function paletteFor(variant: ButtonVariant, c: SemanticColors): Palette {
  switch (variant) {
    case "primary":
      return { bg: c.primary, bgPressed: c.primaryPressed, fg: "onPrimary" };
    case "danger":
      return { bg: c.danger, bgPressed: c.dangerPressed, fg: "onDanger" };
    case "accent":
      return { bg: c.accent, bgPressed: c.accentPressed, fg: "onAccent" };
    case "secondary":
      return { bg: c.primarySubtle, bgPressed: c.surfaceSunken, fg: "onPrimarySubtle" };
    case "outline":
      return { bg: "transparent", bgPressed: c.surfaceSunken, fg: "text", border: c.borderStrong };
    case "ghost":
      return { bg: "transparent", bgPressed: c.primarySubtle, fg: "primaryText" };
  }
}

/**
 * Button. Heights 36/48/56 (sm gets hitSlop to 48). Radius 14 (not a pill: v2 controls are
 * squircle-ish; chips stay pill). Spring press scale, haptic on native.
 * Loading keeps width stable, sets aria-busy and blocks presses. Uses role/aria-* props
 * (accessibilityState is ignored by react-native-web).
 */
export function Button({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  icon,
  iconEnd,
  startIcon,
  endIcon,
  fullWidth,
  style,
  loadingLabel,
  haptic,
  accessibilityLabel,
  "aria-label": ariaLabel,
  accessibilityHint,
  hitSlop,
  onPress,
  onPressIn,
  onPressOut,
  ref,
  ...rest
}: ButtonProps & { ref?: Ref<ComponentRef<typeof View>> }) {
  const theme = useTheme();
  const c = theme.colors;
  const p = paletteFor(variant, c);
  const isDisabled = Boolean(disabled) || loading;
  const h = heights[size];
  const slop = Math.max(0, (sizing.touchTarget - h) / 2);
  const press = usePressScale();
  const fg = isDisabled && !loading ? "disabledText" : p.fg;
  const hapticEvent = haptic ?? (variant === "primary" || variant === "accent" ? "buttonPrimary" : "none");

  const lead = loading ? (
    <ActivityIndicator size="small" color={c[p.fg]} aria-hidden />
  ) : icon ? (
    <Icon name={icon} size={iconPx[size]} weight={variant === "ghost" ? "regular" : "bold"} color={fg} />
  ) : (
    startIcon
  );
  const trail = loading ? null : iconEnd ? <Icon name={iconEnd} size={iconPx[size]} weight="bold" color={fg} /> : endIcon;

  return (
    <Animated.View style={[{ alignSelf: fullWidth ? "stretch" : "flex-start" }, press.style, style]}>
      <Pressable
        ref={ref}
        role="button"
        aria-label={loading && loadingLabel ? loadingLabel : (ariaLabel ?? accessibilityLabel ?? label)}
        accessibilityHint={accessibilityHint}
        aria-disabled={isDisabled}
        aria-busy={loading}
        disabled={isDisabled}
        hitSlop={hitSlop ?? (slop ? { top: slop, bottom: slop } : undefined)}
        onPressIn={(e) => {
          press.onPressIn();
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          press.onPressOut();
          onPressOut?.(e);
        }}
        onPress={(e) => {
          if (hapticEvent !== "none") Haptics.trigger(hapticEvent);
          onPress?.(e);
        }}
        style={(state) => {
          const { pressed, focused, hovered } = state as { pressed: boolean; focused?: boolean; hovered?: boolean };
          const s: ViewStyle = {
            minHeight: h,
            paddingStart: padX[size],
            paddingEnd: padX[size],
            borderRadius: size === "sm" ? radius.sm : radius.md,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: size === "sm" ? spacing.xs + 2 : spacing.sm,
            backgroundColor: isDisabled && !loading ? c.disabledBg : pressed ? p.bgPressed : p.bg,
            borderWidth: p.border && !(isDisabled && !loading) ? borderWidth.hairline : 0,
            borderColor: p.border ?? "transparent",
            opacity: hovered && !pressed ? 0.94 : 1,
            ...(variant === "primary" && !isDisabled && theme.scheme === "light"
              ? { boxShadow: "0px 1px 2px rgba(60, 31, 199, 0.20), 0px 6px 16px rgba(91, 61, 245, 0.24)" }
              : variant === "accent" && !isDisabled
                ? { boxShadow: "0px 6px 18px rgba(130, 170, 0, 0.30)" }
                : null),
            ...(focused
              ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: 2 }
              : null),
          };
          return s;
        }}
        {...rest}
      >
        {lead}
        <Text
          variant={size === "sm" ? "label" : "headline"}
          color={fg}
          numberOfLines={1}
          style={loading ? { opacity: 0.9 } : undefined}
        >
          {label}
        </Text>
        {trail}
      </Pressable>
    </Animated.View>
  );
}
