import type { ReactNode } from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";

import { initialsFor } from "../bidi";
import { contrastRatio } from "../color";
import { detectScript } from "../fonts";
import { useTheme } from "../theme";
import { avatarFills, sizing } from "../tokens";
import { Text } from "./Text";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

export interface AvatarProps {
  name: string;
  uri?: string | null;
  size?: AvatarSize;
  /** Optional overlay (e.g. StatusDot) placed at the bottom-end corner. */
  badge?: ReactNode;
  /** Decorative when the name is printed next to it (default false = announces name). */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
}

const px: Record<AvatarSize, number> = {
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

export function Avatar({ name, uri, size = "md", badge, decorative, style }: AvatarProps) {
  const theme = useTheme();
  const d = px[size];
  const fill = avatarFills[hash(name) % avatarFills.length] ?? avatarFills[0];
  const fg = contrastRatio(fill, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#0A0B12";
  const script = detectScript(name, theme.locale) ?? "latin";

  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={decorative ? undefined : name}
      importantForAccessibility={decorative ? "no-hide-descendants" : "yes"}
      style={[{ width: d, height: d }, style]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: theme.colors.skeleton }}
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
          }}
        >
          <Text
            script={script}
            allowFontScaling={false}
            style={{ color: fg, fontSize: d * 0.4, lineHeight: d * 0.5, fontWeight: "600" }}
          >
            {initialsFor(name)}
          </Text>
        </View>
      )}
      {badge ? <View style={{ position: "absolute", bottom: -2, end: -2 }}>{badge}</View> : null}
    </View>
  );
}
