import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

import { useMirrorStyle } from "../theme";

export interface MirrorProps extends ViewProps {
  children: ReactNode;
  /** Set false for glyphs that must never flip (logos, play/pause, clocks, checkmarks). */
  enabled?: boolean;
}

/**
 * Flips directional glyphs (back arrow, chevrons, "next", progress) horizontally in RTL.
 * See design-system.md § RTL for the mirror / do-not-mirror list.
 */
export function Mirror({ children, enabled = true, style, ...rest }: MirrorProps) {
  const mirror = useMirrorStyle();
  return (
    <View style={[enabled ? mirror : undefined, style]} {...rest}>
      {children}
    </View>
  );
}
