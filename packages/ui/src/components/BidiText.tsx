import { type ComponentRef, type Ref } from "react";
import { Platform, Text as RNText } from "react-native";

import { detectDirection, isolate, stripBidiControls, type IsolateDirection } from "../bidi";
import { detectScript } from "../fonts";
import { useTheme } from "../theme";
import { Text, type TextProps } from "./Text";

export interface BidiTextProps extends Omit<TextProps, "children"> {
  /** Untrusted / mixed-direction content (chat message, user name, venue name). */
  children: string;
  /**
   * "auto" = first strong character (FSI). Force "ltr" for phone numbers, scores, URLs.
   */
  direction?: IsolateDirection;
  /**
   * inline: wrap in FSI…PDI so the string cannot reorder the surrounding sentence (nest inside <Text>).
   * block: a paragraph whose own base direction is detected (chat bubble body).
   */
  mode?: "inline" | "block";
  /** Pick the font from the content's script (e.g. Arabic message in a Hebrew UI). Default true. */
  detectFont?: boolean;
}

/**
 * Renders user-generated text safely in bidi contexts:
 * strips explicit override controls, isolates with FSI/LRI/RLI…PDI and sets
 * writingDirection so punctuation and numbers land on the correct side.
 */
export function BidiText({
  children,
  direction = "auto",
  mode = "inline",
  detectFont = true,
  style,
  script,
  ref,
  ...rest
}: BidiTextProps & { ref?: Ref<ComponentRef<typeof RNText>> }) {
  const theme = useTheme();
  const clean = stripBidiControls(children);
  const resolved = direction === "auto" ? detectDirection(clean, theme.direction) : direction;
  const contentScript = script ?? (detectFont ? (detectScript(clean, theme.locale) ?? undefined) : undefined);
  const content = mode === "inline" ? isolate(clean, direction) : clean;
  const webDir =
    Platform.OS === "web" ? ({ dir: mode === "inline" && direction === "auto" ? "auto" : resolved } as object) : null;

  return (
    <Text ref={ref} script={contentScript} style={[{ writingDirection: resolved }, style]} {...webDir} {...rest}>
      {content}
    </Text>
  );
}
