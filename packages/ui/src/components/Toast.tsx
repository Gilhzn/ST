import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { radius, spacing } from "../tokens";
import { Text } from "./Text";

export type ToastTone = "neutral" | "success" | "error" | "warning" | "info";

export interface ToastProps {
  title: string;
  message?: string;
  tone?: ToastTone;
  /** Overrides the tone icon. */
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /** Shows a close button (X) with this label. */
  dismissLabel?: string;
  onDismiss?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const toneIcon: Record<ToastTone, IconName> = {
  neutral: "Info",
  success: "CheckCircle",
  error: "WarningCircle",
  warning: "Warning",
  info: "Info",
};

/**
 * Toast visual (inverse surface card, radius 20, tone icon disc, optional action).
 * Presentation only: the app's toast queue positions it (top, under the status bar) and
 * handles timing (`motion.duration.toast`). Announced politely (errors assertively).
 */
export function Toast({ title, message, tone = "neutral", icon, actionLabel, onAction, dismissLabel, onDismiss, testID, style }: ToastProps) {
  const theme = useTheme();
  const c = theme.colors;
  const disc: Record<ToastTone, string> = {
    neutral: c.primary,
    success: theme.scheme === "dark" ? "#11803F" : "#3FD98A",
    error: theme.scheme === "dark" ? "#D11F2D" : "#FF6B76",
    warning: "#FFB21E",
    info: theme.scheme === "dark" ? "#0A5FC2" : "#6CB6FF",
  };
  const discFg = tone === "warning" || (theme.scheme === "light" && tone !== "neutral") ? "#0B0A1C" : "#FFFFFF";
  return (
    <View
      testID={testID}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          paddingStart: spacing.md,
          paddingEnd: spacing.sm,
          paddingTop: spacing.md,
          paddingBottom: spacing.md,
          minHeight: 56,
          borderRadius: radius.lg,
          backgroundColor: c.surfaceInverse,
          boxShadow: "0px 6px 16px rgba(11, 10, 28, 0.18), 0px 18px 40px rgba(11, 10, 28, 0.22)",
        },
        style,
      ]}
    >
      <View aria-hidden style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: disc[tone], alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon ?? toneIcon[tone]} size={18} weight="bold" color={discFg} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="label" weight="semibold" color="textInverse" numberOfLines={2}>
          {title}
        </Text>
        {message ? (
          <Text variant="footnote" color="textInverse" numberOfLines={3} style={{ opacity: 0.78 }}>
            {message}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable role="button" aria-label={actionLabel} onPress={onAction} hitSlop={8} style={{ minHeight: 40, justifyContent: "center", paddingStart: spacing.sm, paddingEnd: spacing.sm }}>
          <Text variant="label" weight="semibold" style={{ color: theme.scheme === "dark" ? "#4A2BE6" : "#AA9DFF" }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
      {onDismiss && dismissLabel ? (
        <Pressable role="button" aria-label={dismissLabel} onPress={onDismiss} hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
          <Icon name="X" size={18} color="textInverse" />
        </Pressable>
      ) : null}
    </View>
  );
}
