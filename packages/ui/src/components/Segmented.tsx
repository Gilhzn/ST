import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";

import { Haptics } from "../haptics";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { borderWidth, motion, radius, spacing } from "../tokens";
import { Text } from "./Text";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** Small count after the label ("Hosting 2"). */
  count?: number;
  testID?: string;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Show games". */
  label: string;
  size?: "sm" | "md";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Segmented control: sunken track + raised sliding thumb (spring). Equal-width segments.
 * Semantics: role="radiogroup" + role="radio" items with aria-checked (filters a list in place).
 * The thumb moves with the logical `start` offset, so it follows RTL automatically.
 */
export function Segmented<T extends string>({ options, value, onChange, label, size = "md", testID, style }: SegmentedProps<T>) {
  const theme = useTheme();
  const c = theme.colors;
  const n = Math.max(1, options.length);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const [width, setWidth] = useState(0);
  const pos = useRef(new Animated.Value(index)).current;
  const h = size === "sm" ? 36 : 44;
  const pad = 3;

  useEffect(() => {
    if (theme.reducedMotion) pos.setValue(index);
    else Animated.spring(pos, { toValue: index, ...motion.springs.snappy, useNativeDriver: false }).start();
  }, [index, theme.reducedMotion, pos]);

  const segW = width > 0 ? (width - pad * 2) / n : 0;
  const start = pos.interpolate({ inputRange: [0, Math.max(1, n - 1)], outputRange: [pad, pad + segW * Math.max(1, n - 1)] });

  return (
    <View
      role="radiogroup"
      aria-label={label}
      testID={testID}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[
        {
          flexDirection: "row",
          minHeight: h,
          padding: pad,
          borderRadius: radius.md,
          backgroundColor: c.surfaceSunken,
          ...(theme.scheme === "dark" ? { borderWidth: 1, borderColor: c.border } : null),
        },
        style,
      ]}
    >
      {segW > 0 ? (
        <Animated.View
          aria-hidden
          style={{
            position: "absolute",
            top: pad - (theme.scheme === "dark" ? 1 : 0),
            bottom: pad - (theme.scheme === "dark" ? 1 : 0),
            start,
            width: segW,
            borderRadius: radius.md - pad,
            backgroundColor: theme.scheme === "dark" ? c.surfaceRaised : c.surface,
            boxShadow: theme.scheme === "dark" ? "none" : "0px 1px 2px rgba(18, 17, 41, 0.08), 0px 3px 8px rgba(18, 17, 41, 0.08)",
            ...(theme.scheme === "dark" ? { borderWidth: 1, borderColor: c.borderStrong } : null),
          }}
        />
      ) : null}
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={o.testID}
            role="radio"
            aria-checked={sel}
            aria-label={o.count !== undefined ? `${o.label}, ${o.count}` : o.label}
            onPress={() => {
              if (!sel) {
                Haptics.trigger("segmentChange");
                onChange(o.value);
              }
            }}
            style={(st) => {
              const { focused } = st as { focused?: boolean };
              return {
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.xs + 2,
                paddingStart: spacing.sm,
                paddingEnd: spacing.sm,
                borderRadius: radius.md - pad,
                ...(focused
                  ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: 0 }
                  : null),
              } as ViewStyle;
            }}
          >
            {o.icon ? <Icon name={o.icon} size={16} weight={sel ? "fill" : "regular"} color={sel ? "text" : "textSecondary"} /> : null}
            <Text variant={size === "sm" ? "footnote" : "label"} weight={sel ? "semibold" : "medium"} color={sel ? "text" : "textSecondary"} numberOfLines={1}>
              {o.label}
            </Text>
            {o.count !== undefined ? (
              <View
                aria-hidden
                style={{
                  minWidth: 20,
                  height: 20,
                  paddingStart: 5,
                  paddingEnd: 5,
                  borderRadius: radius.pill,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: sel ? c.primary : c.border,
                }}
              >
                <Text variant="caption" weight="semibold" color={sel ? "onPrimary" : "textSecondary"} allowFontScaling={false} style={{ fontSize: 11, lineHeight: 14, fontVariant: ["tabular-nums"] }}>
                  {String(o.count)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
