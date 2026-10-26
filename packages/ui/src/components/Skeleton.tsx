import { useEffect, useRef } from "react";
import { Animated, Easing, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { motion, radius, spacing } from "../tokens";
import { Gradient } from "./Gradient";

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  /** Corner radius (default 8; use radius.pill for avatars/chips). */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Placeholder block with a soft shimmer sweeping from the reading-start edge (mirrors in RTL;
 * moves via the logical `start` offset). Reduced motion: static block. Hidden from AT — put
 * aria-busy on the container you are loading.
 */
export function Skeleton({ width = "100%", height = 16, radius: r = radius.xs + 2, style }: SkeletonProps) {
  const theme = useTheme();
  const c = theme.colors;
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (theme.reducedMotion) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: motion.duration.shimmer, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [theme.reducedMotion, x]);

  return (
    <View aria-hidden style={[{ width, height, borderRadius: r, backgroundColor: c.skeleton, overflow: "hidden" }, style]}>
      {!theme.reducedMotion ? (
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: "60%",
            start: x.interpolate({ inputRange: [0, 1], outputRange: ["-60%", "110%"] }),
          }}
        >
          <Gradient
            direction="horizontal"
            colors={[withAlphaHex(c.skeletonHighlight, 0), c.skeletonHighlight, withAlphaHex(c.skeletonHighlight, 0)]}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function withAlphaHex(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Paragraph placeholder: `lines` bars, the last one 60% wide. */
export function SkeletonText({ lines = 3, lineHeight = 14, gap = spacing.sm }: { lines?: number; lineHeight?: number; gap?: number }) {
  return (
    <View aria-hidden style={{ gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={lineHeight} width={i === lines - 1 && lines > 1 ? "60%" : "100%"} />
      ))}
    </View>
  );
}

/** Loading state shaped like `GameHeroCard` (band + title + footer). */
export function SkeletonGameCard() {
  const theme = useTheme();
  return (
    <View aria-hidden style={{ borderRadius: radius.lg, overflow: "hidden", ...theme.elevation(1) }}>
      <Skeleton height={104} radius={0} />
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Skeleton height={20} width="70%" />
        <Skeleton height={14} width="45%" />
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Skeleton height={32} width={88} radius={radius.pill} />
          <View style={{ flex: 1 }} />
          <Skeleton height={40} width={40} radius={radius.pill} />
        </View>
      </View>
    </View>
  );
}
