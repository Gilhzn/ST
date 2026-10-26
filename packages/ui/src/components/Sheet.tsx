import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme } from "../theme";
import { motion, motionDuration, radius, spacing, zIndex } from "../tokens";

export interface SheetProps {
  children: ReactNode;
  /** Heights (dp) of each detent, ascending, e.g. [120, 360, 640]. */
  snapPoints: number[];
  /** Controlled detent index. */
  index: number;
  onIndexChange: (index: number) => void;
  /** Accessible name of the sheet region, e.g. "Games nearby". */
  accessibilityLabel: string;
  /** Localized labels for the handle actions. */
  expandLabel?: string;
  collapseLabel?: string;
  /** Optional header pinned under the handle (title, count, list/map toggle). */
  header?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Lightweight bottom sheet (Animated + PanResponder only, no extra deps).
 * - Drag the handle or header to move between detents; tap the handle to cycle.
 * - Screen readers: the handle is a button ("Expand sheet" / "Collapse sheet", aria-expanded)
 *   with extra expand/collapse custom actions on native. No slider role: axe requires aria-valuenow.
 * - Reduced motion: detent changes are short timing animations, no spring overshoot.
 * On wide web layouts prefer the split-view list pane instead of a sheet.
 */
export function Sheet({
  children,
  snapPoints,
  index,
  onIndexChange,
  accessibilityLabel,
  expandLabel = "Expand sheet",
  collapseLabel = "Collapse sheet",
  header,
  style,
}: SheetProps) {
  const theme = useTheme();
  const c = theme.colors;
  const points = snapPoints.length ? snapPoints : [200];
  const maxH = points[points.length - 1] ?? 200;
  const clampIndex = (i: number) => Math.max(0, Math.min(points.length - 1, i));
  const current = clampIndex(index);
  const height = useRef(new Animated.Value(points[current] ?? maxH)).current;
  const startHeight = useRef(points[current] ?? maxH);

  useEffect(() => {
    const to = points[current] ?? maxH;
    startHeight.current = to;
    const anim = theme.reducedMotion
      ? Animated.timing(height, {
          toValue: to,
          duration: motionDuration("sheet", true),
          easing: Easing.linear,
          useNativeDriver: false,
        })
      : Animated.spring(height, { toValue: to, ...motion.spring, useNativeDriver: false });
    anim.start();
  }, [current, points.join(","), theme.reducedMotion]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
        onPanResponderMove: (_e, g) => {
          const next = Math.max(points[0] ?? 0, Math.min(maxH, startHeight.current - g.dy));
          height.setValue(next);
        },
        onPanResponderRelease: (_e, g) => {
          const projected = startHeight.current - g.dy - g.vy * 120;
          let best = 0;
          points.forEach((p, i) => {
            if (Math.abs(p - projected) < Math.abs((points[best] ?? 0) - projected)) best = i;
          });
          if (best === current) {
            const to = points[best] ?? maxH;
            Animated.timing(height, {
              toValue: to,
              duration: motionDuration("fast", theme.reducedMotion),
              useNativeDriver: false,
            }).start();
          }
          onIndexChange(best);
        },
      }),
    [points.join(","), current, theme.reducedMotion, onIndexChange],
  );

  const go = (i: number) => {
    const n = clampIndex(i);
    if (n !== current) {
      onIndexChange(n);
      AccessibilityInfo.announceForAccessibility?.(n > current ? expandLabel : collapseLabel);
    }
  };
  const atTop = current === points.length - 1;

  return (
    <Animated.View
      role="region"
      aria-label={accessibilityLabel}
      style={[
        {
          position: "absolute",
          start: 0,
          end: 0,
          bottom: 0,
          height,
          zIndex: zIndex.sheet,
          backgroundColor: c.surfaceRaised,
          borderTopStartRadius: radius.xl,
          borderTopEndRadius: radius.xl,
          ...theme.elevation(3),
        },
        style,
      ]}
    >
      <View {...responder.panHandlers}>
        <Pressable
          role="button"
          aria-label={atTop ? collapseLabel : expandLabel}
          aria-expanded={atTop}
          accessibilityActions={[
            { name: "expand", label: expandLabel },
            { name: "collapse", label: collapseLabel },
          ]}
          onAccessibilityAction={(e) => go(e.nativeEvent.actionName === "expand" ? current + 1 : current - 1)}
          onPress={() => go(atTop ? 0 : current + 1)}
          style={{ alignItems: "center", justifyContent: "center", minHeight: 32, paddingTop: spacing.sm }}
          hitSlop={{ top: 8, bottom: 8 }}
        >
          <View style={{ width: 40, height: 5, borderRadius: radius.pill, backgroundColor: c.borderStrong }} />
        </Pressable>
        {header ? (
          <View style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingBottom: spacing.sm }}>{header}</View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Animated.View>
  );
}
