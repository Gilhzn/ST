import { type ComponentRef, type Ref } from "react";
import { Platform, Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";

import { typeStyleFor, type Script } from "../fonts";
import { useTheme } from "../theme";
import { fontWeights, type ColorToken, type FontWeightKey, type TextVariant } from "../tokens";

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Semantic color token (default `text`) or a raw color (sport text, text on media). */
  color?: ColorToken | (string & {});
  /** Override script (e.g. user content in another script; see `detectScript`). */
  script?: Script;
  /** Paragraph alignment. "start" follows the layout direction. Physical sides are not offered. */
  align?: "start" | "center";
  /** Override the variant's weight (e.g. a bold caption). Uses the matching registered face. */
  weight?: FontWeightKey;
}

/**
 * Typography primitive. Applies the locale's font, per-script line-height/tracking and
 * dynamic-type caps. Headings (display/title*) get role="heading".
 */
export function Text({
  variant = "body",
  color = "text",
  script,
  align,
  weight,
  style,
  role,
  maxFontSizeMultiplier,
  ref,
  ...rest
}: TextProps & { ref?: Ref<ComponentRef<typeof RNText>> }) {
  const theme = useTheme();
  const s = script ?? theme.script;
  const t = typeStyleFor(variant, s);
  const w = weight ?? t.weight;
  const family = theme.fontFamily(w, s);
  const isHeading = variant === "display" || variant === "largeTitle" || variant.startsWith("title");

  const base: TextStyle = {
    color: color in theme.colors ? theme.colors[color as ColorToken] : color,
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    ...(family ? { fontFamily: family } : null),
    // Registered per-weight faces (Rubik_700Bold) embed the weight; setting fontWeight too
    // makes Android / browsers synthesize a fake bold on top.
    ...(family && theme.usesWeightedFamilies ? null : { fontWeight: fontWeights[w] }),
    ...(t.uppercase ? { textTransform: "uppercase" } : null),
    ...(t.tabularNums ? { fontVariant: ["tabular-nums"] } : null),
    ...(Platform.OS === "android" ? { includeFontPadding: t.includeFontPadding } : null),
    ...(align ? { textAlign: alignToTextAlign(align) } : null),
  };

  return (
    <RNText
      ref={ref}
      // Web: react-native-web defaults Text to dir="auto", which left-aligns Latin/numeric UI
      // strings ("19:05", "7/10") inside an RTL layout. UI strings follow the UI direction;
      // user content uses BidiText, which passes its own `dir` (spread below wins).
      {...(Platform.OS === "web" ? ({ dir: theme.direction } as object) : null)}
      role={role ?? (isHeading ? "heading" : undefined)}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? t.maxFontSizeMultiplier}
      style={[base, style]}
      {...rest}
    />
  );
}

/**
 * RN has no "start" value: omitting textAlign (web: CSS default `start` under the
 * provider's `direction`) or "auto" (native) both align to the start edge of the layout.
 */
function alignToTextAlign(align: "start" | "center"): TextStyle["textAlign"] {
  if (align === "center") return "center";
  return Platform.OS === "web" ? undefined : "auto";
}
