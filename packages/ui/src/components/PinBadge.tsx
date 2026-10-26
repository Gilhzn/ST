import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { sizing, sportColors, type PinShape, type SportKey } from "../tokens";
import { Text } from "./Text";

export type PinState = "default" | "selected" | "full" | "live";

export interface PinBadgeProps {
  sport: SportKey;
  state?: PinState;
  /** Vector icon to replace the fallback glyph (recommended: sportColors[sport].icon). */
  icon?: ReactNode;
  /** Spoken label, e.g. "Football game, 6 of 10 players, today 18:00". Required. */
  accessibilityLabel: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

function shapeStyle(shape: PinShape, size: number): ViewStyle {
  switch (shape) {
    case "circle":
      return { width: size, height: size, borderRadius: size / 2 };
    case "square":
      return { width: size * 0.92, height: size * 0.92, borderRadius: size * 0.18 };
    case "diamond":
      return { width: size * 0.8, height: size * 0.8, borderRadius: size * 0.14, transform: [{ rotate: "45deg" }] };
    case "shield":
      return {
        width: size * 0.9,
        height: size,
        borderTopStartRadius: size * 0.16,
        borderTopEndRadius: size * 0.16,
        borderBottomStartRadius: size * 0.5,
        borderBottomEndRadius: size * 0.5,
      };
    case "pill":
      return { width: size * 1.4, height: size * 0.78, borderRadius: size };
    case "capsule":
      return { width: size * 0.74, height: size * 1.12, borderRadius: size };
  }
}

/**
 * Sport map marker: color (Okabe–Ito) + unique silhouette + glyph/icon.
 * Rendered as a MapLibre marker view (native) or HTML marker (web). Maps never mirror in RTL.
 */
export function PinBadge({ sport, state = "default", icon, accessibilityLabel, size, style }: PinBadgeProps) {
  const theme = useTheme();
  const t = sportColors[sport];
  const s = size ?? (state === "selected" ? sizing.pinSelected : sizing.pin);
  const full = state === "full";
  const shape = shapeStyle(t.shape, s);
  const counterRotate = t.shape === "diamond" ? { transform: [{ rotate: "-45deg" }] } : null;

  return (
    <View
      accessible
      role="button"
      aria-label={accessibilityLabel}
      aria-expanded={state === "selected"}
      style={[
        { alignItems: "center", justifyContent: "center", minWidth: sizing.touchTarget, minHeight: sizing.touchTarget },
        style,
      ]}
    >
      {state === "selected" || state === "live" ? (
        <View
          style={[
            shapeStyle(t.shape, s + 8),
            {
              position: "absolute",
              borderWidth: 3,
              borderColor: state === "live" ? theme.colors.accent : theme.colors.primary,
            },
          ]}
        />
      ) : null}
      <View
        style={[
          shape,
          {
            alignItems: "center",
            justifyContent: "center",
            // Full games: hollow marker (same shape/icon), so state isn't conveyed by color.
            backgroundColor: full ? theme.colors.surface : t.color,
            borderWidth: full ? 3 : 2,
            borderColor: full ? t.color : theme.colors.pinRing,
            boxShadow: `0px 0px 0px 1px ${theme.colors.pinOutline}, 0px 2px 4px rgba(0, 0, 0, 0.25)`,
          },
        ]}
      >
        <View style={counterRotate}>
          {icon ?? (
            <Text
              allowFontScaling={false}
              style={{ fontSize: s * 0.45, lineHeight: s * 0.6, color: full ? theme.colors.text : t.on }}
            >
              {t.glyph}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

export interface ClusterBadgeProps {
  count: number;
  /** Up to 3 sports present in the cluster, shown as mini markers. */
  sports?: SportKey[];
  accessibilityLabel: string;
}

/** Cluster marker: neutral ink circle with count; size steps by count tier. */
export function ClusterBadge({ count, sports = [], accessibilityLabel }: ClusterBadgeProps) {
  const theme = useTheme();
  const s = count < 10 ? 36 : count < 100 ? 44 : 52;
  const label = count > 999 ? "999+" : String(count);
  return (
    <View
      accessible
      role="button"
      aria-label={accessibilityLabel}
      style={{
        alignItems: "center",
        justifyContent: "center",
        minWidth: sizing.touchTarget,
        minHeight: sizing.touchTarget,
      }}
    >
      <View
        style={{
          width: s,
          height: s,
          borderRadius: s / 2,
          backgroundColor: theme.colors.surfaceInverse,
          borderWidth: 2,
          borderColor: theme.colors.pinRing,
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0px 2px 6px rgba(0, 0, 0, 0.3)",
        }}
      >
        <Text variant="label" color="textInverse" allowFontScaling={false} style={{ fontVariant: ["tabular-nums"] }}>
          {label}
        </Text>
      </View>
      {sports.length ? (
        <View style={{ flexDirection: "row", gap: 2, marginTop: -6 }}>
          {sports.slice(0, 3).map((k) => (
            <View
              key={k}
              style={[
                shapeStyle(sportColors[k].shape, 10),
                { backgroundColor: sportColors[k].color, borderWidth: 1, borderColor: theme.colors.pinRing },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
