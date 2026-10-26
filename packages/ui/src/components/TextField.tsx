import { type ComponentRef, type Ref, useId, useState, type ReactNode } from "react";
import { Platform, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";

import { typeStyleFor } from "../fonts";
import { useTheme } from "../theme";
import { borderWidth, fontWeights, radius, sizing, spacing } from "../tokens";
import { Text } from "./Text";

export interface TextFieldProps extends Omit<TextInputProps, "style" | "placeholderTextColor"> {
  /** Visible label (always shown; placeholders are not labels). */
  label: string;
  helperText?: string;
  /** Error message. Rendered with ⚠ glyph, announced politely, and sets the danger outline. */
  error?: string;
  /** Adornment at the start edge (e.g. country code, search icon). */
  start?: ReactNode;
  /** Adornment at the end edge (e.g. clear button, show-password). */
  end?: ReactNode;
  /**
   * Content direction. Phone numbers, OTP codes, emails and URLs are always "ltr"
   * even in Hebrew/Arabic UIs; free text uses "auto".
   */
  inputDirection?: "auto" | "ltr" | "rtl";
  required?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

export function TextField({
  label,
  helperText,
  error,
  start,
  end,
  inputDirection = "auto",
  required,
  containerStyle,
  editable = true,
  onFocus,
  onBlur,
  ref,
  ...rest
}: TextFieldProps & { ref?: Ref<ComponentRef<typeof TextInput>> }) {
  const theme = useTheme();
  const c = theme.colors;
  const [focused, setFocused] = useState(false);
  const id = useId();
  const t = typeStyleFor("body", theme.script);
  const family = theme.fontFamily("regular");
  const describedBy = error ?? helperText;
  const webDir = Platform.OS === "web" ? ({ dir: inputDirection } as object) : null;

  return (
    <View style={[{ gap: spacing.xs }, containerStyle]}>
      <Text variant="label" color="text" nativeID={`${id}-label`}>
        {label}
        {required ? (
          <Text variant="label" color="dangerText" accessibilityElementsHidden importantForAccessibility="no">
            {" *"}
          </Text>
        ) : null}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          minHeight: sizing.touchTarget,
          paddingStart: spacing.md,
          paddingEnd: spacing.md,
          borderRadius: radius.md,
          backgroundColor: editable ? c.surface : c.disabledBg,
          borderWidth: focused || error ? borderWidth.thick : borderWidth.regular,
          borderColor: error ? c.danger : focused ? c.focusRing : c.borderStrong,
        }}
      >
        {start}
        <TextInput
          ref={ref}
          accessibilityLabel={required ? `${label}, required` : label}
          accessibilityHint={describedBy}
          aria-labelledby={`${id}-label`}
          aria-invalid={Boolean(error)}
          editable={editable}
          placeholderTextColor={c.textTertiary}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={
            {
              flex: 1,
              minHeight: sizing.touchTarget - 4,
              color: editable ? c.text : c.disabledText,
              fontSize: t.fontSize,
              ...(family ? { fontFamily: family } : null),
              ...(theme.usesWeightedFamilies ? null : { fontWeight: fontWeights.regular }),
              ...(inputDirection === "auto" ? null : { writingDirection: inputDirection }),
              paddingTop: spacing.sm,
              paddingBottom: spacing.sm,
              ...(Platform.OS === "web" ? { outlineStyle: "none" } : null),
            } as object
          }
          {...webDir}
          {...rest}
        />
        {end}
      </View>
      {error ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={{ flexDirection: "row", gap: spacing.xs, alignItems: "flex-start" }}
        >
          <Text variant="caption" color="dangerText" importantForAccessibility="no">
            ⚠
          </Text>
          <Text variant="caption" color="dangerText" style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : helperText ? (
        <Text variant="caption" color="textTertiary">
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}
