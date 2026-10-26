import { type ComponentRef, type Ref, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { borderWidth, motion, radius, sizing, spacing, type SemanticColors } from "../tokens";
import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Icon before the label (start edge). Wrap directional icons in <Mirror>. */
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Announced instead of the label when loading (e.g. "Joining game…"). */
  loadingLabel?: string;
}

const heights: Record<ButtonSize, number> = { sm: 36, md: sizing.touchTarget, lg: 56 };
const padX: Record<ButtonSize, number> = { sm: spacing.md, md: spacing.lg, lg: spacing.xl };

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
      return { bg: c.accent, bgPressed: c.accent, fg: "onAccent" };
    case "secondary":
      return { bg: c.surface, bgPressed: c.surfaceSunken, fg: "text", border: c.borderStrong };
    case "ghost":
      return { bg: "transparent", bgPressed: c.primarySubtle, fg: "primaryText" };
  }
}

/**
 * Button. Min touch target 48 (sm is 36 visually + hitSlop to 48).
 * Loading keeps width stable, sets accessibilityState.busy and blocks presses.
 */
export function Button({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  startIcon,
  endIcon,
  fullWidth,
  style,
  loadingLabel,
  accessibilityLabel,
  accessibilityHint,
  hitSlop,
  ref,
  ...rest
}: ButtonProps & { ref?: Ref<ComponentRef<typeof View>> }) {
  const theme = useTheme();
  const c = theme.colors;
  const p = paletteFor(variant, c);
  const isDisabled = Boolean(disabled) || loading;
  const h = heights[size];
  const slop = Math.max(0, (sizing.touchTarget - h) / 2);

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={loading && loadingLabel ? loadingLabel : (accessibilityLabel ?? label)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={hitSlop ?? (slop ? { top: slop, bottom: slop } : undefined)}
      style={(state) => {
        const { pressed, focused, hovered } = state as { pressed: boolean; focused?: boolean; hovered?: boolean };
        const s: ViewStyle = {
          minHeight: h,
          paddingStart: padX[size],
          paddingEnd: padX[size],
          borderRadius: radius.pill,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          backgroundColor: isDisabled && !loading ? c.disabledBg : pressed ? p.bgPressed : p.bg,
          borderWidth: p.border ? borderWidth.regular : 0,
          borderColor: p.border ?? "transparent",
          opacity: hovered && !pressed ? motion.pressedOpacity + 0.08 : 1,
          transform: pressed && !theme.reducedMotion ? [{ scale: motion.pressedScale }] : undefined,
          ...(focused
            ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: 2 }
            : null),
        };
        return [s, style];
      }}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={c[p.fg]} accessibilityElementsHidden importantForAccessibility="no" />
      ) : (
        startIcon
      )}
      <Text
        variant={size === "sm" ? "label" : "bodyStrong"}
        color={isDisabled && !loading ? "disabledText" : p.fg}
        numberOfLines={1}
        style={loading ? { opacity: 0.9 } : undefined}
      >
        {label}
      </Text>
      {loading ? null : endIcon}
    </Pressable>
  );
}
