import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import type { IconName } from "../icons/registry";
import { spacing } from "../tokens";
import { Button } from "./Button";
import { Illustration, type IllustrationName } from "./Illustration";
import { Text } from "./Text";

export type EmptyStateTone = "empty" | "error" | "offline" | "restricted";

export interface EmptyStateProps {
  title: string;
  body?: string;
  tone?: EmptyStateTone;
  /** v2: spot illustration (defaults per tone: empty → emptyGames, error → error, offline → offline). */
  illustration?: IllustrationName;
  /** Illustration size (default 160; use 120 inside sheets/cards). */
  illustrationSize?: number;
  /** Custom illustration/icon node (overrides `illustration`). */
  icon?: ReactNode;
  actionLabel?: string;
  /** Phosphor icon on the primary action. */
  actionIcon?: IconName;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const toneArt: Record<EmptyStateTone, IllustrationName> = {
  empty: "emptyGames",
  error: "error",
  offline: "offline",
  restricted: "ageGate",
};

/**
 * Empty / error / offline / restricted placeholder: SVG spot illustration, title, body and
 * actions. Copy rule: say what happened, then what the person can do next — always offer an
 * action when one exists.
 */
export function EmptyState({
  title,
  body,
  tone = "empty",
  illustration,
  illustrationSize = 160,
  icon,
  actionLabel,
  actionIcon,
  onAction,
  secondaryLabel,
  onSecondary,
  style,
  testID,
}: EmptyStateProps) {
  return (
    <View
      testID={testID}
      aria-live={tone === "error" || tone === "offline" ? "polite" : undefined}
      style={[
        {
          alignItems: "center",
          paddingTop: spacing.xl,
          paddingBottom: spacing.xxl,
          paddingStart: spacing.xl,
          paddingEnd: spacing.xl,
          gap: spacing.sm,
        },
        style,
      ]}
    >
      {icon ?? <Illustration name={illustration ?? toneArt[tone]} size={illustrationSize} />}
      <Text variant="title2" align="center" style={{ marginTop: spacing.sm }}>
        {title}
      </Text>
      {body ? (
        <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 340 }}>
          {body}
        </Text>
      ) : null}
      {(actionLabel && onAction) || (secondaryLabel && onSecondary) ? (
        <View style={{ alignItems: "center", gap: spacing.xs, marginTop: spacing.md }}>
          {actionLabel && onAction ? (
            <Button label={actionLabel} icon={actionIcon} onPress={onAction} variant={tone === "error" ? "outline" : "primary"} />
          ) : null}
          {secondaryLabel && onSecondary ? <Button label={secondaryLabel} onPress={onSecondary} variant="ghost" /> : null}
        </View>
      ) : null}
    </View>
  );
}
