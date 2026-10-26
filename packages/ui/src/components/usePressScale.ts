import { useRef } from "react";
import { Animated } from "react-native";

import { useTheme } from "../theme";
import { motion } from "../tokens";

/**
 * Spring press feedback (scale down on press-in, spring back on release).
 * Returns handlers to spread on a Pressable and an animated `transform` style.
 * Reduced motion: no scale (pressed color still changes).
 */
export function usePressScale(scale: number = motion.pressedScale) {
  const { reducedMotion } = useTheme();
  const v = useRef(new Animated.Value(1)).current;
  const to = (value: number) =>
    Animated.spring(v, { toValue: value, ...motion.springs.press, useNativeDriver: false }).start();
  return {
    style: reducedMotion ? null : { transform: [{ scale: v }] },
    onPressIn: () => {
      if (!reducedMotion) to(scale);
    },
    onPressOut: () => {
      if (!reducedMotion) to(1);
    },
  };
}
