import { View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { radius, spacing, type ReliabilityStatus } from "../tokens";
import { Text } from "./Text";

export interface StatusBadgeProps {
  status: ReliabilityStatus;
  /** Localized label, e.g. "Reliable", "Caution", "Restricted", "New player". Required: never color alone. */
  label: string;
  /** Optional reliability percentage shown after the label ("92%"). Hidden for "new". */
  percent?: number;
  size?: "sm" | "md";
  /** Full spoken description, e.g. "Reliability: reliable, 92 percent". Defaults to label + percent. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Reliability status pill: glyph (✓ ! ✕ ✦) + label (+ %). Shape also differs
 * (pill for green/new, squared for yellow/red) so status survives grayscale and CVD.
 */
export function StatusBadge({ status, label, percent, size = "md", accessibilityLabel, style }: StatusBadgeProps) {
  const theme = useTheme();
  const t = theme.reliability[status];
  const showPct = percent !== undefined && status !== "new";
  const pct = showPct ? `${Math.round(percent)}%` : "";
  const a11y = accessibilityLabel ?? (showPct ? `${label}, ${pct}` : label);
  const squared = status === "yellow" || status === "red";

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11y}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: spacing.xs,
          backgroundColor: t.bg,
          borderRadius: squared ? radius.xs : radius.pill,
          borderWidth: status === "new" ? 1 : 0,
          borderStyle: status === "new" ? "dashed" : "solid",
          borderColor: t.fg,
          paddingStart: size === "sm" ? spacing.sm : spacing.md,
          paddingEnd: size === "sm" ? spacing.sm : spacing.md,
          minHeight: size === "sm" ? 24 : 32,
        },
        style,
      ]}
    >
      <Text
        variant={size === "sm" ? "caption" : "label"}
        style={{ color: t.fg, fontWeight: "700" }}
        importantForAccessibility="no"
      >
        {t.glyph}
      </Text>
      <Text variant={size === "sm" ? "caption" : "label"} style={{ color: t.fg }} numberOfLines={1}>
        {label}
      </Text>
      {showPct ? (
        <Text variant={size === "sm" ? "caption" : "label"} style={{ color: t.fg, fontVariant: ["tabular-nums"] }}>
          {"⁦" + pct + "⁩"}
        </Text>
      ) : null}
    </View>
  );
}

/** Small solid dot + glyph for dense lists (participants). Must be paired with text or a11y label. */
export function StatusDot({
  status,
  accessibilityLabel,
  size = 14,
}: {
  status: ReliabilityStatus;
  accessibilityLabel: string;
  size?: number;
}) {
  const theme = useTheme();
  const t = theme.reliability[status];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{
        width: size,
        height: size,
        borderRadius: status === "yellow" || status === "red" ? 3 : size / 2,
        backgroundColor: t.solid,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: theme.colors.surface,
      }}
    >
      <Text
        style={{ color: theme.colors.surface, fontSize: size * 0.7, lineHeight: size, fontWeight: "700" }}
        allowFontScaling={false}
      >
        {t.glyph}
      </Text>
    </View>
  );
}
