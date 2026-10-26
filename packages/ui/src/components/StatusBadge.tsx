import { View, type StyleProp, type ViewStyle } from "react-native";

import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
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
 * Reliability status pill: Phosphor icon (ShieldCheck / Warning / Prohibit / Sparkle) + label (+ %).
 * Shape also differs (pill for green/new, squared for yellow/red; dashed for new) so status
 * survives grayscale and CVD.
 */
export function StatusBadge({ status, label, percent, size = "md", accessibilityLabel, style }: StatusBadgeProps) {
  const theme = useTheme();
  const t = theme.reliability[status];
  const showPct = percent !== undefined && status !== "new";
  const pct = showPct ? `${Math.round(percent)}%` : "";
  const a11y = accessibilityLabel ?? (showPct ? `${label}, ${pct}` : label);
  const squared = status === "yellow" || status === "red";
  const sm = size === "sm";

  return (
    <View
      accessible
      role="img"
      aria-label={a11y}
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
          paddingStart: sm ? spacing.sm - 2 : spacing.sm + 2,
          paddingEnd: sm ? spacing.sm : spacing.md,
          minHeight: sm ? 24 : 30,
        },
        style,
      ]}
    >
      <Icon name={t.phosphor} size={sm ? 14 : 16} weight="fill" color={t.fg} />
      <Text variant={sm ? "caption" : "footnote"} weight="semibold" style={{ color: t.fg }} numberOfLines={1}>
        {label}
      </Text>
      {showPct ? (
        <Text variant={sm ? "caption" : "footnote"} weight="semibold" style={{ color: t.fg, fontVariant: ["tabular-nums"], opacity: 0.85 }}>
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
  size = 16,
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
      role="img"
      aria-label={accessibilityLabel}
      style={{
        width: size,
        height: size,
        borderRadius: status === "yellow" || status === "red" ? 4 : size / 2,
        backgroundColor: t.solid,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1.5,
        borderColor: theme.colors.surface,
      }}
    >
      <Icon name={status === "green" ? "Check" : status === "new" ? "Sparkle" : status === "yellow" ? "Warning" : "X"} size={Math.round(size * 0.62)} weight="bold" color={theme.colors.surface} />
    </View>
  );
}

export type PillTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "live" | "glass";

export interface StatusPillProps {
  label: string;
  tone?: PillTone;
  icon?: IconName;
  size?: "sm" | "md";
  /** Defaults to the label. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Generic status pill (game state: Open, Filling fast, Full, Live, Joined, Waitlist #2).
 * `live` = volt fill with a pulsing-dot glyph; `glass` = translucent white for gradients.
 */
export function StatusPill({ label, tone = "neutral", icon, size = "sm", accessibilityLabel, style }: StatusPillProps) {
  const { colors: c } = useTheme();
  const map: Record<PillTone, { bg: string; fg: string; border?: string }> = {
    neutral: { bg: c.surfaceSunken, fg: c.textSecondary },
    brand: { bg: c.primarySubtle, fg: c.onPrimarySubtle },
    success: { bg: c.successSubtle, fg: c.successText },
    warning: { bg: c.warningSubtle, fg: c.warningText },
    danger: { bg: c.dangerSubtle, fg: c.dangerText },
    info: { bg: c.infoSubtle, fg: c.infoText },
    live: { bg: c.accent, fg: c.onAccent },
    glass: { bg: "rgba(255, 255, 255, 0.2)", fg: "#FFFFFF", border: "rgba(255, 255, 255, 0.32)" },
  };
  const t = map[tone];
  const sm = size === "sm";
  return (
    <View
      accessible
      aria-label={accessibilityLabel ?? label}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: spacing.xs,
          minHeight: sm ? 24 : 30,
          paddingStart: icon || tone === "live" ? spacing.sm - 1 : spacing.sm + 2,
          paddingEnd: spacing.sm + 2,
          borderRadius: radius.pill,
          backgroundColor: t.bg,
          ...(t.border ? { borderWidth: 1, borderColor: t.border } : null),
        },
        style,
      ]}
    >
      {tone === "live" && !icon ? (
        <View aria-hidden style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.onAccent, marginStart: 2 }} />
      ) : icon ? (
        <Icon name={icon} size={sm ? 14 : 16} weight="bold" color={t.fg} />
      ) : null}
      <Text variant={sm ? "caption" : "footnote"} weight="semibold" style={{ color: t.fg }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
