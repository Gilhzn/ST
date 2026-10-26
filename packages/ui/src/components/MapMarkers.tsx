import { useEffect, useRef } from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";

import { isolate } from "../bidi";
import { Icon } from "../icons/Icon";
import { useTheme } from "../theme";
import { sizing, sportColors, type SportKey } from "../tokens";
import { Text } from "./Text";

export type MapPinState = "default" | "selected" | "full" | "live";

/** Teardrop markers anchor at the tip: pass this to MapLibre `anchor` / web `Marker({ anchor: "bottom" })`. */
export const MAP_PIN_ANCHOR = { x: 0.5, y: 1 } as const;

/** Visual size of a marker (width × height). Height = width × 1.25. */
export function mapPinSize(state: MapPinState = "default"): { width: number; height: number } {
  const w = state === "selected" ? sizing.pinMarkerSelected : sizing.pinMarker;
  return { width: Math.max(w, sizing.touchTarget), height: Math.round(w * 1.25) };
}

// Teardrop in a 40×50 box: round head (center 20,19.5) and a soft tip at (20,48.5).
const TEARDROP =
  "M20 48.5 C14.2 41.6 3 31.6 3 19.6 C3 10.2 10.6 2.5 20 2.5 C29.4 2.5 37 10.2 37 19.6 C37 31.6 25.8 41.6 20 48.5 Z";

export interface MapPinMarkerProps {
  sport: SportKey;
  state?: MapPinState;
  /** Spoken label, e.g. "Football game, 6 of 10 players, today 18:00". Required. */
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * v2 map marker: sport-colored teardrop with a white Phosphor glyph, white ring, ink hairline
 * and a contact shadow. States: selected (bigger + brand halo), full (hollow: white fill,
 * sport ring, sport glyph — not color alone), live (volt beacon, pulses unless reduced motion).
 * Maps never mirror in RTL. Anchor at the tip (`MAP_PIN_ANCHOR`).
 */
export function MapPinMarker({ sport, state = "default", accessibilityLabel, testID, style }: MapPinMarkerProps) {
  const theme = useTheme();
  const c = theme.colors;
  const t = sportColors[sport];
  const w = state === "selected" ? sizing.pinMarkerSelected : sizing.pinMarker;
  const h = Math.round(w * 1.25);
  const k = w / 40;
  const full = state === "full";
  const glyph = Math.round(w * 0.46);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state !== "live" || theme.reducedMotion) return;
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [state, theme.reducedMotion, pulse]);

  return (
    <View
      testID={testID}
      accessible
      role="button"
      aria-label={accessibilityLabel}
      aria-expanded={state === "selected"}
      style={[{ width: Math.max(w, sizing.touchTarget), height: h, alignItems: "center" }, style]}
    >
      <Svg width={w} height={h} viewBox="0 0 40 50">
        <Ellipse cx={20} cy={48.6} rx={6} ry={1.8} fill="rgba(11, 10, 28, 0.28)" />
        {state === "selected" ? <Path d={TEARDROP} fill="none" stroke={c.primary} strokeWidth={7} strokeOpacity={0.35} /> : null}
        <Path d={TEARDROP} fill="none" stroke={c.pinOutline} strokeOpacity={0.55} strokeWidth={4.4} />
        <Path d={TEARDROP} fill={full ? "#FFFFFF" : t.color} stroke={full ? t.color : c.pinRing} strokeWidth={full ? 3.2 : 2.6} />
        {!full ? <Circle cx={20} cy={19.6} r={12.5} fill="#FFFFFF" fillOpacity={0.12} /> : null}
      </Svg>
      <View aria-hidden style={{ position: "absolute", top: Math.round(19.6 * k - glyph / 2), width: glyph, height: glyph }}>
        <Icon name={t.phosphor} size={glyph} weight="fill" color={full ? t.text : "#FFFFFF"} directional={false} />
      </View>
      {state === "live" ? (
        <View aria-hidden style={{ position: "absolute", top: -2, end: Math.max(0, (Math.max(w, sizing.touchTarget) - w) / 2) - 2, width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
          {!theme.reducedMotion ? (
            <Animated.View
              style={{
                position: "absolute",
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: c.accent,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
              }}
            />
          ) : null}
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.accent, borderWidth: 2, borderColor: "#0B0A1C" }} />
        </View>
      ) : null}
    </View>
  );
}

export interface ClusterMarkerProps {
  count: number;
  /** Games per sport inside the cluster → colored ring segments (largest first). */
  sports?: ReadonlyArray<{ sport: SportKey; count: number }>;
  /** "12 games: football, tennis. Double-tap to zoom in." Required. */
  accessibilityLabel: string;
  testID?: string;
}

/**
 * Cluster bubble: inverse (ink/white) disc with a tabular count and an outer ring split into
 * sport-colored segments proportional to each sport's share. Size tiers 40/48/56 (<10, <100, ≥100).
 * Anchor at the center.
 */
export function ClusterMarker({ count, sports = [], accessibilityLabel, testID }: ClusterMarkerProps) {
  const theme = useTheme();
  const c = theme.colors;
  const d = count < 10 ? 40 : count < 100 ? 48 : 56;
  const ringW = 4;
  const r = (d - ringW) / 2;
  const circ = 2 * Math.PI * r;
  const total = sports.reduce((a, s) => a + s.count, 0);
  const sorted = [...sports].sort((a, b) => b.count - a.count);
  const gap = sorted.length > 1 ? 2.5 : 0;
  let offset = 0;
  const label = count > 999 ? "999+" : String(count);

  return (
    <View
      testID={testID}
      accessible
      role="button"
      aria-label={accessibilityLabel}
      style={{ width: Math.max(d, sizing.touchTarget), height: Math.max(d, sizing.touchTarget), alignItems: "center", justifyContent: "center" }}
    >
      <View style={{ width: d, height: d, borderRadius: d / 2, boxShadow: "0px 2px 4px rgba(11, 10, 28, 0.20), 0px 6px 14px rgba(11, 10, 28, 0.22)" }}>
        <Svg width={d} height={d} style={{ position: "absolute", top: 0, start: 0, transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={d / 2} cy={d / 2} r={d / 2} fill={c.pinRing} />
          <Circle cx={d / 2} cy={d / 2} r={r - ringW / 2 - 1} fill={c.surfaceInverse} />
          {total > 0
            ? sorted.map((s) => {
                const len = (s.count / total) * circ;
                const seg = (
                  <Circle
                    key={s.sport}
                    cx={d / 2}
                    cy={d / 2}
                    r={r}
                    fill="none"
                    stroke={sportColors[s.sport].color}
                    strokeWidth={ringW}
                    strokeDasharray={`${Math.max(0.5, len - gap)} ${circ}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += len;
                return seg;
              })
            : null}
        </Svg>
        <View aria-hidden style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text variant={d >= 48 ? "headline" : "label"} weight="bold" color="textInverse" allowFontScaling={false} style={{ fontVariant: ["tabular-nums"] }}>
            {isolate(label, "ltr")}
          </Text>
        </View>
      </View>
    </View>
  );
}
