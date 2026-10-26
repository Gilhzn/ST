import type { ReactNode } from "react";
import { LinearGradient } from "expo-linear-gradient";
import type { StyleProp, ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { gradients, type GradientName } from "../tokens";

export interface GradientProps {
  /** Token gradient (brand, brandNight, volt, live, scrimBottom, or a sport key). */
  name?: GradientName;
  /** Custom stops (overrides `name`). */
  colors?: readonly [string, string, ...string[]];
  /** "diagonal" (default for tokens), "vertical", "horizontal" (follows reading direction). */
  direction?: "diagonal" | "vertical" | "horizontal";
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * expo-linear-gradient with token stops. Horizontal/diagonal gradients start at the
 * reading-start edge, so they mirror in RTL. Decorative: hidden from assistive tech.
 */
export function Gradient({ name = "brand", colors, direction, style, children }: GradientProps) {
  const { isRTL } = useTheme();
  const token = gradients[name];
  const stops = colors ?? token.colors;
  let start = token.start;
  let end = token.end;
  if (direction === "vertical") {
    start = { x: 0.5, y: 0 };
    end = { x: 0.5, y: 1 };
  } else if (direction === "horizontal") {
    start = { x: 0, y: 0.5 };
    end = { x: 1, y: 0.5 };
  } else if (direction === "diagonal") {
    start = { x: 0, y: 0 };
    end = { x: 1, y: 1 };
  }
  if (isRTL) {
    start = { x: 1 - start.x, y: start.y };
    end = { x: 1 - end.x, y: end.y };
  }
  return (
    <LinearGradient colors={stops as [string, string, ...string[]]} start={start} end={end} style={style} pointerEvents={children ? "auto" : "none"}>
      {children}
    </LinearGradient>
  );
}
