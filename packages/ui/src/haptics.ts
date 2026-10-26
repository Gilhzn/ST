/**
 * Haptics helper (docs §8 haptics map). expo-haptics on iOS/Android; silent on web.
 * Never throws (devices without a Taptic engine, disabled system haptics).
 *
 *   Haptics.selection();               // chips, segments, tabs, pins
 *   Haptics.trigger("checkInSuccess"); // semantic event → kind via `hapticMap`
 */
import * as ExpoHaptics from "expo-haptics";
import { Platform } from "react-native";

import { hapticMap, type HapticEvent, type HapticKind } from "./tokens";

const enabled = Platform.OS === "ios" || Platform.OS === "android";

function run(kind: HapticKind): void {
  if (!enabled || kind === "none") return;
  let p: Promise<void> | undefined;
  switch (kind) {
    case "selection":
      p = ExpoHaptics.selectionAsync();
      break;
    case "light":
      p = ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light);
      break;
    case "medium":
      p = ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium);
      break;
    case "heavy":
      p = ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Heavy);
      break;
    case "success":
      p = ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success);
      break;
    case "warning":
      p = ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning);
      break;
    case "error":
      p = ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error);
      break;
  }
  p?.catch(() => undefined);
}

export const Haptics = {
  /** Whether haptics can fire on this platform (false on web). */
  enabled,
  selection: () => run("selection"),
  light: () => run("light"),
  medium: () => run("medium"),
  heavy: () => run("heavy"),
  success: () => run("success"),
  warning: () => run("warning"),
  error: () => run("error"),
  kind: run,
  /** Semantic event → haptic kind (see `hapticMap`). */
  trigger: (event: HapticEvent) => run(hapticMap[event]),
};
