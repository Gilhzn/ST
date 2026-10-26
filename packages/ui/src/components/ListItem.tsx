import type { ReactNode } from "react";
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { borderWidth, radius, sizing, spacing, type SportKey } from "../tokens";
import { Text } from "./Text";

export type ListItemLeadTone = "brand" | "neutral" | "success" | "warning" | "danger" | "info";

export interface ListItemProps extends Omit<PressableProps, "children" | "style"> {
  title: string;
  subtitle?: string;
  /** Phosphor icon in a 36dp tinted squircle at the start edge. */
  icon?: IconName;
  iconTone?: ListItemLeadTone;
  /** Sport-tinted icon well (overrides iconTone colors). */
  sport?: SportKey;
  /** Custom leading node (Avatar, SportGlyphBadge). */
  leading?: ReactNode;
  /** Trailing value text ("English", "On"). */
  value?: string;
  /** Custom trailing node (Switch, StatusPill, Button). */
  trailing?: ReactNode;
  /** Show a disclosure caret (mirrors in RTL). Default: true when pressable and no trailing. */
  chevron?: boolean;
  destructive?: boolean;
  /** Draw the inset hairline under the row (ListGroup sets this). */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Settings / menu / participant row. 56dp min height, icon well, title + subtitle, value,
 * chevron. Pressable rows are role="button" (pass role="link" for navigation if preferred).
 */
export function ListItem({
  title,
  subtitle,
  icon,
  iconTone = "brand",
  sport,
  leading,
  value,
  trailing,
  chevron,
  destructive,
  divider,
  onPress,
  disabled,
  style,
  role,
  ...rest
}: ListItemProps) {
  const theme = useTheme();
  const c = theme.colors;
  const wells: Record<ListItemLeadTone, [string, string]> = {
    brand: [c.primarySubtle, c.onPrimarySubtle],
    neutral: [c.surfaceSunken, c.textSecondary],
    success: [c.successSubtle, c.successText],
    warning: [c.warningSubtle, c.warningText],
    danger: [c.dangerSubtle, c.dangerText],
    info: [c.infoSubtle, c.infoText],
  };
  const s = sport ? theme.sport(sport) : null;
  const [wellBg, wellFg] = s ? [s.tint, s.text] : wells[destructive ? "danger" : iconTone];
  const showChevron = chevron ?? (Boolean(onPress) && !trailing);
  const lead =
    leading ??
    (icon ? (
      <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: wellBg, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} weight="duotone" color={wellFg} />
      </View>
    ) : null);

  const content = (pressed: boolean, focused: boolean): ReactNode => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        minHeight: sizing.listRow,
        paddingStart: spacing.lg,
        paddingEnd: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
        backgroundColor: pressed ? c.surfaceSunken : "transparent",
        opacity: disabled ? 0.5 : 1,
        ...(focused ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: -3 } : null),
      }}
    >
      {lead}
      <View style={{ flex: 1, gap: 2, alignSelf: "stretch", justifyContent: "center" }}>
        <Text variant="body" weight={destructive ? "medium" : "regular"} color={destructive ? "dangerText" : "text"} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textSecondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" color="textTertiary" numberOfLines={1} style={{ maxWidth: "45%" }}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {showChevron ? <Icon name="CaretRight" size={18} weight="bold" color="textTertiary" /> : null}
      {divider ? (
        <View aria-hidden style={{ position: "absolute", bottom: 0, end: 0, start: lead ? spacing.lg + 36 + spacing.md : spacing.lg, height: 1, backgroundColor: c.border }} />
      ) : null}
    </View>
  );

  if (!onPress) {
    return (
      <View style={style} testID={rest.testID ?? undefined} aria-label={rest["aria-label"]}>
        {content(false, false)}
      </View>
    );
  }
  return (
    <Pressable role={role ?? "button"} aria-label={rest["aria-label"] ?? (value ? `${title}, ${value}` : title)} aria-disabled={Boolean(disabled)} disabled={disabled} onPress={onPress} style={style} {...rest}>
      {(st) => content(st.pressed, Boolean((st as { focused?: boolean }).focused))}
    </Pressable>
  );
}

export interface ListGroupProps {
  /** Section header (overline style), e.g. "Account". */
  title?: string;
  /** Footnote under the group. */
  footer?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Inset grouped list (iOS-settings style): radius-20 card, hairlines between rows. */
export function ListGroup({ title, footer, children, style, testID }: ListGroupProps) {
  const theme = useTheme();
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={[{ gap: spacing.sm }, style]} testID={testID}>
      {title ? (
        <Text variant="overline" color="textTertiary" role="heading" style={{ paddingStart: spacing.lg }}>
          {title}
        </Text>
      ) : null}
      <View style={{ borderRadius: radius.lg, overflow: "hidden", ...theme.elevation(1) }}>
        {items.map((child, i) => (
          <View key={i}>
            {child}
            {i < items.length - 1 ? <View aria-hidden style={{ height: 1, marginStart: spacing.lg, backgroundColor: theme.colors.border }} /> : null}
          </View>
        ))}
      </View>
      {footer ? (
        <Text variant="footnote" color="textTertiary" style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}
