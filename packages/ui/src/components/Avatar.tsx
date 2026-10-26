import type { ReactNode } from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";

import { initialsFor, isolate } from "../bidi";
import { contrastRatio } from "../color";
import { detectScript } from "../fonts";
import { useTheme } from "../theme";
import { avatarFills, radius, sizing, spacing } from "../tokens";
import { Text } from "./Text";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface AvatarProps {
  name: string;
  uri?: string | null;
  size?: AvatarSize;
  /** Optional overlay (e.g. StatusDot) placed at the bottom-end corner. */
  badge?: ReactNode;
  /** 2dp ring in the canvas color (stacks, avatars on media). */
  ring?: boolean | string;
  /** Decorative when the name is printed next to it (default false = announces name). */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const avatarPx: Record<AvatarSize, number> = {
  xs: sizing.avatarXs,
  sm: sizing.avatarSm,
  md: sizing.avatarMd,
  lg: sizing.avatarLg,
  xl: sizing.avatarXl,
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Photo or initials on a jewel-tone fill (deterministic per name). */
export function Avatar({ name, uri, size = "md", badge, ring, decorative, style }: AvatarProps) {
  const theme = useTheme();
  const d = avatarPx[size];
  const fill = avatarFills[hash(name) % avatarFills.length] ?? avatarFills[0];
  const fg = contrastRatio(fill, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#0A0B12";
  const script = detectScript(name, theme.locale) ?? "latin";
  const ringColor = typeof ring === "string" ? ring : theme.colors.surface;
  const rw = ring ? (d >= 56 ? 3 : 2) : 0;

  return (
    <View
      accessible={!decorative}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
      style={[{ width: d, height: d }, style]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{
            width: d,
            height: d,
            borderRadius: d / 2,
            backgroundColor: theme.colors.skeleton,
            borderWidth: rw,
            borderColor: ringColor,
          }}
        />
      ) : (
        <View
          style={{
            width: d,
            height: d,
            borderRadius: d / 2,
            backgroundColor: fill,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: rw,
            borderColor: ringColor,
          }}
        >
          <Text
            script={script}
            weight="semibold"
            allowFontScaling={false}
            style={{ color: fg, fontSize: Math.round(d * 0.38), lineHeight: Math.round(d * 0.5), letterSpacing: 0 }}
          >
            {initialsFor(name)}
          </Text>
        </View>
      )}
      {badge ? <View style={{ position: "absolute", bottom: -2, end: -2 }}>{badge}</View> : null}
    </View>
  );
}

export interface AvatarStackProps {
  people: ReadonlyArray<{ name: string; uri?: string | null }>;
  /** Max avatars before the "+N" bubble. Default 4. */
  max?: number;
  size?: Extract<AvatarSize, "xs" | "sm" | "md">;
  /** Total count when `people` is a preview of a longer list. */
  total?: number;
  /** Spoken summary, e.g. "Dana, Yossi and 5 others". Required: the stack is one image. */
  label: string;
  /** Ring color = the surface the stack sits on (default `surface`). */
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
}

/** Overlapping avatars (start→end, so they mirror in RTL) with a "+N" overflow bubble. */
export function AvatarStack({ people, max = 4, size = "sm", total, label, ringColor, style }: AvatarStackProps) {
  const theme = useTheme();
  const d = avatarPx[size];
  const shown = people.slice(0, max);
  const rest = Math.max(0, (total ?? people.length) - shown.length);
  const overlap = Math.round(d * 0.3);
  const ring = ringColor ?? theme.colors.surface;
  return (
    <View role="img" aria-label={label} style={[{ flexDirection: "row", alignItems: "center" }, style]}>
      {shown.map((p, i) => (
        <Avatar key={`${p.name}-${i}`} name={p.name} uri={p.uri} size={size} ring={ring} decorative style={{ marginStart: i === 0 ? 0 : -overlap, zIndex: max - i }} />
      ))}
      {rest > 0 ? (
        <View
          aria-hidden
          style={{
            marginStart: shown.length ? -overlap : 0,
            minWidth: d,
            height: d,
            paddingStart: spacing.xs,
            paddingEnd: spacing.xs,
            borderRadius: radius.pill,
            backgroundColor: theme.colors.surfaceSunken,
            borderWidth: 2,
            borderColor: ring,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text variant="caption" weight="semibold" color="textSecondary" allowFontScaling={false} style={{ fontVariant: ["tabular-nums"] }}>
            {isolate(`+${rest}`, "ltr")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
