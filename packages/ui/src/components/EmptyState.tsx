import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { radius, spacing } from "../tokens";
import { Button } from "./Button";
import { Text } from "./Text";

export type EmptyStateTone = "empty" | "error" | "offline" | "restricted";

export interface EmptyStateProps {
  title: string;
  body?: string;
  tone?: EmptyStateTone;
  /** Custom illustration/icon; defaults to a tone glyph in a tinted disc. */
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  style?: StyleProp<ViewStyle>;
}

const glyphs: Record<EmptyStateTone, string> = { empty: "◎", error: "!", offline: "⌁", restricted: "⏸" };

/**
 * Empty / error / offline / restricted placeholder. Copy rule: say what happened,
 * then what the person can do next — always offer an action when one exists.
 */
export function EmptyState({
  title,
  body,
  tone = "empty",
  icon,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  style,
}: EmptyStateProps) {
  const { colors: c } = useTheme();
  const disc =
    tone === "error" ? c.dangerSubtle : tone === "offline" || tone === "restricted" ? c.warningSubtle : c.primarySubtle;
  const glyphColor =
    tone === "error" ? "dangerText" : tone === "offline" || tone === "restricted" ? "warningText" : "onPrimarySubtle";

  return (
    <View
      accessibilityLiveRegion={tone === "error" || tone === "offline" ? "polite" : "none"}
      style={[
        {
          alignItems: "center",
          paddingTop: spacing.xxl,
          paddingBottom: spacing.xxl,
          paddingStart: spacing.xl,
          paddingEnd: spacing.xl,
          gap: spacing.md,
        },
        style,
      ]}
    >
      {icon ?? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 72,
            height: 72,
            borderRadius: radius.pill,
            backgroundColor: disc,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text variant="title1" color={glyphColor} accessibilityRole="none">
            {glyphs[tone]}
          </Text>
        </View>
      )}
      <Text variant="title3" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" color="textSecondary" align="center" style={{ maxWidth: 420 }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant={tone === "error" ? "secondary" : "primary"} />
      ) : null}
      {secondaryLabel && onSecondary ? <Button label={secondaryLabel} onPress={onSecondary} variant="ghost" /> : null}
    </View>
  );
}
