import { View, type StyleProp, type ViewStyle } from "react-native";

import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { radius, spacing, type SportKey } from "../tokens";
import { Text } from "./Text";

export interface StatTileProps {
  /** Pre-formatted value (Intl.NumberFormat): "13", "92%", "4.8". Rendered with tabular numerals. */
  value: string;
  label: string;
  icon?: IconName;
  /** Tints the icon well with a sport color instead of brand. */
  sport?: SportKey;
  /** Optional trend/caption under the label: "+3 this month". */
  caption?: string;
  /** Tone for the caption. */
  captionTone?: "neutral" | "positive" | "negative";
  /** "lg" for the 2×2 profile grid, "sm" for inline rows. */
  size?: "sm" | "lg";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Stat tile: icon well, big tabular value, label. One focus stop ("13, Games played"). */
export function StatTile({ value, label, icon, sport, caption, captionTone = "neutral", size = "lg", testID, style }: StatTileProps) {
  const theme = useTheme();
  const c = theme.colors;
  const s = sport ? theme.sport(sport) : null;
  return (
    <View
      testID={testID}
      accessible
      aria-label={`${value}, ${label}${caption ? `, ${caption}` : ""}`}
      style={[
        {
          flex: 1,
          minWidth: 140,
          padding: size === "lg" ? spacing.lg : spacing.md,
          gap: spacing.sm + 2,
          borderRadius: radius.lg,
          ...theme.elevation(1),
        },
        style,
      ]}
    >
      {icon ? (
        <View
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            backgroundColor: s ? s.tint : c.primarySubtle,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={20} weight="duotone" color={s ? s.text : c.onPrimarySubtle} />
        </View>
      ) : null}
      <View style={{ gap: 0 }}>
        <Text variant={size === "lg" ? "numeric" : "statSmall"}>
          {value}
        </Text>
        <Text variant="footnote" color="textSecondary" numberOfLines={2}>
          {label}
        </Text>
        {caption ? (
          <Text variant="caption" weight="semibold" color={captionTone === "positive" ? "successText" : captionTone === "negative" ? "dangerText" : "textTertiary"}>
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
