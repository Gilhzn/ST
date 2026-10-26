import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { sizing, spacing } from "../tokens";
import { IconButton } from "./IconButton";
import { Text } from "./Text";

export interface LargeHeaderProps {
  title: string;
  /** Small line above the title ("Good evening, Dana"). */
  eyebrow?: string;
  /** Line under the title ("8 games near Tel Aviv"). */
  subtitle?: string;
  /** Trailing actions (IconButtons, Avatar). End edge of the top row. */
  actions?: ReactNode;
  /** Shows a back button (ArrowLeft, mirrors in RTL). */
  onBack?: () => void;
  backLabel?: string;
  /** Content under the title (Segmented, search field). */
  children?: ReactNode;
  /** Safe-area top inset. */
  topInset?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Large-title header (tab roots and hub screens): a 52dp action row (back / actions),
 * then a 32/38 bold title with optional eyebrow + subtitle, then optional controls.
 * The title is the screen's heading (role="heading", level 1).
 */
export function LargeHeader({ title, eyebrow, subtitle, actions, onBack, backLabel = "Back", children, topInset = 0, testID, style }: LargeHeaderProps) {
  const theme = useTheme();
  const hasRow = Boolean(onBack || actions);
  return (
    <View testID={testID} style={[{ paddingTop: topInset + (hasRow ? 0 : spacing.lg), paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingBottom: spacing.md, gap: spacing.md, backgroundColor: theme.colors.background }, style]}>
      {hasRow ? (
        <View style={{ minHeight: sizing.headerCompact, flexDirection: "row", alignItems: "center", gap: spacing.sm, marginStart: onBack ? -spacing.sm : 0 }}>
          {onBack ? <IconButton icon="ArrowLeft" label={backLabel} onPress={onBack} testID="nav.back" /> : null}
          <View style={{ flex: 1 }} />
          {actions ? <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>{actions}</View> : null}
        </View>
      ) : null}
      <View style={{ gap: spacing.xs }}>
        {eyebrow ? (
          <Text variant="footnote" weight="medium" color="textSecondary" numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        <Text variant="largeTitle" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="callout" color="textSecondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
