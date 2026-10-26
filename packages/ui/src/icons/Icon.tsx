import { View, type StyleProp, type ViewStyle } from "react-native";
import type { IconProps as PhosphorProps } from "phosphor-react-native";

import { useTheme } from "../theme";
import { iconSizes, sportColors, type ColorToken, type IconSizeToken, type SportKey } from "../tokens";
import { isDirectionalIcon, resolveIcon, type IconName } from "./registry";

export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export interface IconProps {
  /** Phosphor component name from the curated registry (`IconName`). */
  name: IconName;
  /** 16 | 20 | 24 | 28 (or "xs" | "sm" | "md" | "lg"). Default 24. */
  size?: number | IconSizeToken;
  /** regular = UI default · fill = active tab / selected · duotone = sport & feature illustration · bold = on media. */
  weight?: IconWeight;
  /** Semantic color token (default `textSecondary`) or a raw color (sport/gradient contexts). */
  color?: ColorToken | (string & {});
  /** Duotone second-layer color (defaults to `color`). */
  duotoneColor?: ColorToken | (string & {});
  /** Mirror in RTL. Defaults to the registry's directional list (arrows, chevrons, send…). */
  directional?: boolean;
  /** Spoken label. Omit for decorative icons next to text (the default: hidden from AT). */
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Phosphor icon with semantic color, size tokens and RTL mirroring.
 * `<Icon name="MapPin" size={24} weight="regular" color="textPrimary" />`
 */
export function Icon({ name, size = "md", weight = "regular", color = "textSecondary", duotoneColor, directional, label, style, testID }: IconProps) {
  const theme = useTheme();
  const px = typeof size === "number" ? size : iconSizes[size];
  const resolve = (c: string) => (c in theme.colors ? theme.colors[c as ColorToken] : c);
  const fg = resolve(color);
  const mirror = theme.isRTL && (directional ?? isDirectionalIcon(name));
  const Glyph = resolveIcon(name);
  const props: PhosphorProps & { "aria-hidden"?: boolean; focusable?: boolean } = {
    size: px,
    color: fg,
    weight,
    mirrored: mirror,
    duotoneColor: duotoneColor ? resolve(duotoneColor) : fg,
    duotoneOpacity: 0.24,
    ...(testID ? { testID } : null),
    ...(label ? null : { "aria-hidden": true, focusable: false }),
  };
  const glyph = <Glyph {...props} />;
  if (!label && !style) return glyph;
  return (
    <View
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={[{ width: px, height: px, alignItems: "center", justifyContent: "center" }, style]}
    >
      {glyph}
    </View>
  );
}

export interface SportIconProps {
  sport: SportKey;
  size?: number | IconSizeToken;
  weight?: IconWeight;
  /** Defaults to the sport's text color for the current scheme. */
  color?: ColorToken | (string & {});
  label?: string;
}

/** The sport's Phosphor glyph (football → SoccerBall, padel → Racquet, …). Never mirrors. */
export function SportIcon({ sport, size = "sm", weight = "regular", color, label }: SportIconProps) {
  const theme = useTheme();
  return (
    <Icon
      name={sportColors[sport].phosphor}
      size={size}
      weight={weight}
      color={color ?? theme.sport(sport).text}
      directional={false}
      label={label}
    />
  );
}

export type SportGlyphBadgeVariant = "solid" | "tint" | "glass";

export interface SportGlyphBadgeProps {
  sport: SportKey;
  /** Outer diameter. Default 40. Glyph is 55% of it. */
  size?: number;
  /**
   * solid: sport color + white fill glyph (map, lists) ·
   * tint: soft sport tint + duotone sport glyph (cards, chips) ·
   * glass: translucent white + white glyph (on sport gradients / media).
   */
  variant?: SportGlyphBadgeVariant;
  /** Squircle (radius 32%) instead of a circle. */
  squircle?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/** Sport glyph in a colored well: the v2 replacement for color dots (`SportDot`). */
export function SportGlyphBadge({ sport, size = 40, variant = "tint", squircle, label, style }: SportGlyphBadgeProps) {
  const theme = useTheme();
  const s = theme.sport(sport);
  const bg = variant === "solid" ? s.color : variant === "glass" ? "rgba(255, 255, 255, 0.18)" : s.tint;
  const fg = variant === "tint" ? s.text : "#FFFFFF";
  return (
    <View
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={[
        {
          width: size,
          height: size,
          borderRadius: squircle ? size * 0.32 : size / 2,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
          ...(variant === "glass" ? { borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.28)" } : null),
        },
        style,
      ]}
    >
      <Icon
        name={sportColors[sport].phosphor}
        size={Math.round(size * 0.55)}
        weight={variant === "tint" ? "duotone" : "fill"}
        color={fg}
        directional={false}
      />
    </View>
  );
}
