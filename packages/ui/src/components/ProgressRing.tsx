import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

import { useTheme } from "../theme";
import { motionDuration, type ColorToken, type ReliabilityStatus } from "../tokens";
import { Text } from "./Text";

export interface ProgressRingProps {
  /** 0..1 */
  progress: number;
  size?: number;
  /** Stroke width; default size/10 (min 3). */
  thickness?: number;
  /** Arc color token or raw color. Default `primary`. */
  color?: ColorToken | (string & {});
  /** Optional two-stop gradient for the arc (overrides `color`). */
  gradient?: readonly [string, string];
  /** Track color; default `surfaceSunken`. */
  trackColor?: string;
  /** Center content (value, icon). */
  children?: ReactNode;
  /** Spoken name, e.g. "Players". Value is exposed via aria-valuenow (0–100). */
  label?: string;
  /** aria-valuetext override, e.g. "7 of 10 players". */
  valueText?: string;
  /** Animate from 0 on mount / on change (skipped with reduced motion). Default true. */
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
let gradId = 0;

/**
 * Circular progress (react-native-svg). Starts at 12 o'clock and fills clockwise in LTR,
 * counter-clockwise in RTL (progress mirrors with reading direction).
 * role="progressbar" with aria-valuenow/min/max (decorative when `label` is omitted).
 */
export function ProgressRing({
  progress,
  size = 48,
  thickness,
  color = "primary",
  gradient,
  trackColor,
  children,
  label,
  valueText,
  animated = true,
  style,
}: ProgressRingProps) {
  const theme = useTheme();
  const p = Math.max(0, Math.min(1, progress));
  const sw = thickness ?? Math.max(3, Math.round(size / 10));
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const stroke = color in theme.colors ? theme.colors[color as ColorToken] : color;
  const [id] = useState(() => `st-ring-${++gradId}`);
  const anim = useRef(new Animated.Value(animated && !theme.reducedMotion ? 0 : p)).current;

  useEffect(() => {
    if (!animated || theme.reducedMotion) {
      anim.setValue(p);
      return;
    }
    Animated.timing(anim, {
      toValue: p,
      duration: motionDuration("slow", theme.reducedMotion) * 2,
      easing: Easing.bezier(0.2, 0, 0, 1),
      useNativeDriver: false,
    }).start();
  }, [p, animated, theme.reducedMotion, anim]);

  const dash = anim.interpolate({ inputRange: [0, 1], outputRange: [circ, 0] });
  const pct = Math.round(p * 100);

  return (
    <View
      role={label ? "progressbar" : undefined}
      aria-label={label}
      aria-valuenow={label ? pct : undefined}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuetext={label ? valueText : undefined}
      aria-hidden={label ? undefined : true}
      style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}
    >
      <Svg
        width={size}
        height={size}
        style={{ position: "absolute", top: 0, start: 0, transform: [{ rotate: "-90deg" }, ...(theme.isRTL ? [{ scaleY: -1 }] : [])] }}
      >
        {gradient ? (
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={gradient[0]} />
              <Stop offset="1" stopColor={gradient[1]} />
            </LinearGradient>
          </Defs>
        ) : null}
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor ?? theme.colors.surfaceSunken} strokeWidth={sw} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={gradient ? `url(#${id})` : stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={dash}
        />
      </Svg>
      {children}
    </View>
  );
}

export interface ReliabilityRingProps {
  status: ReliabilityStatus;
  /** 0–100; ignored for "new". */
  percent?: number;
  /** Localized status label ("Reliable"), shown under the number. */
  label: string;
  size?: number;
  /** Full spoken text, e.g. "Reliability 92 percent, reliable". */
  accessibilityLabel: string;
  testID?: string;
}

/** The profile hero ring: status-colored arc, big tabular % and the status label (never color alone). */
export function ReliabilityRing({ status, percent, label, size = 132, accessibilityLabel, testID }: ReliabilityRingProps) {
  const theme = useTheme();
  const t = theme.reliability[status];
  const isNew = status === "new" || percent === undefined;
  const v = isNew ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <ProgressRing
      progress={v / 100}
      size={size}
      thickness={Math.round(size / 11)}
      color={t.solid}
      label={accessibilityLabel}
      valueText={isNew ? label : `${v}%, ${label}`}
    >
      <View testID={testID} style={{ alignItems: "center" }} aria-hidden>
        <Text variant={size >= 120 ? "numeric" : "statSmall"} style={{ fontSize: Math.round(size * 0.24), lineHeight: Math.round(size * 0.3) }}>
          {isNew ? "—" : `⁦${v}%⁩`}
        </Text>
        <Text variant="caption" weight="semibold" style={{ color: t.fg }} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </ProgressRing>
  );
}
