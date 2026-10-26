import { type ComponentRef, type Ref } from "react";
import { Platform, Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";

import { typeStyleFor, type Script } from "../fonts";
import { useTheme } from "../theme";
import { fontWeights, type ColorToken, type TextVariant } from "../tokens";

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Semantic color token (default `text`). */
  color?: ColorToken;
  /** Override script (e.g. user content in another script; see `detectScript`). */
  script?: Script;
  /** Paragraph alignment. "start" follows the layout direction. Physical sides are not offered. */
  align?: "start" | "center";
}

/**
 * Typography primitive. Applies the locale's font, per-script line-height/tracking and
 * dynamic-type caps. Headings (display/title*) get accessibilityRole="header".
 */
export function Text({
  variant = "body",
  color = "text",
  script,
  align,
  style,
  accessibilityRole,
  maxFontSizeMultiplier,
  ref,
  ...rest
}: TextProps & { ref?: Ref<ComponentRef<typeof RNText>> }) {
  const theme = useTheme();
  const s = script ?? theme.script;
  const t = typeStyleFor(variant, s);
  const family = theme.fontFamily(t.weight, s);
  const isHeading = variant === "display" || variant.startsWith("title");

  const base: TextStyle = {
    color: theme.colors[color],
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    ...(family ? { fontFamily: family } : null),
    // Native Noto families embed the weight; setting fontWeight too makes Android synthesize bold.
    ...(theme.usesWeightedFamilies ? null : { fontWeight: fontWeights[t.weight] }),
    ...(t.uppercase ? { textTransform: "uppercase" } : null),
    ...(t.tabularNums ? { fontVariant: ["tabular-nums"] } : null),
    ...(Platform.OS === "android" ? { includeFontPadding: t.includeFontPadding } : null),
    ...(align ? { textAlign: alignToTextAlign(align) } : null),
  };

  return (
    <RNText
      ref={ref}
      accessibilityRole={accessibilityRole ?? (isHeading ? "header" : undefined)}
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
