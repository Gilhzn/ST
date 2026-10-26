import { type ComponentRef, type Ref, useId, useState, type ReactNode } from "react";
import { Platform, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";

import { typeStyleFor } from "../fonts";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { borderWidth, fontWeights, radius, sizing, spacing } from "../tokens";
import { Text } from "./Text";

export interface TextFieldProps extends Omit<TextInputProps, "style" | "placeholderTextColor"> {
  /** Visible label (always shown; placeholders are not labels). */
  label: string;
  helperText?: string;
  /** Error message. Rendered with ⚠ glyph, announced politely, and sets the danger outline. */
  error?: string;
  /** v2: Phosphor icon at the start edge (e.g. "MagnifyingGlass", "Phone"). */
  icon?: IconName;
  /** Adornment at the start edge (e.g. country code). */
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
  icon,
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
  const weighted = Boolean(family) && theme.usesWeightedFamilies;
  const describedBy = error ?? helperText;
  const webDir = Platform.OS === "web" ? ({ dir: inputDirection } as object) : null;

  return (
    <View style={[{ gap: spacing.xs + 2 }, containerStyle]}>
      <Text variant="label" color="textSecondary" nativeID={`${id}-label`}>
        {label}
        {required ? (
          <Text variant="label" color="dangerText" aria-hidden>
            {" *"}
          </Text>
        ) : null}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          minHeight: sizing.inputHeight,
          paddingStart: spacing.lg,
          paddingEnd: spacing.md,
          borderRadius: radius.md,
          backgroundColor: !editable ? c.disabledBg : focused ? c.surface : c.surfaceSunken,
          borderWidth: borderWidth.thick,
          borderColor: error ? c.danger : focused ? c.focusRing : theme.scheme === "dark" ? c.border : "transparent",
          ...(focused && !error ? { boxShadow: `0px 0px 0px 4px ${theme.scheme === "dark" ? "rgba(143, 125, 255, 0.22)" : "rgba(91, 61, 245, 0.14)"}` } : null),
        }}
      >
        {icon ? <Icon name={icon} size={20} color={focused ? "primary" : "textTertiary"} /> : null}
        {start}
        <TextInput
          ref={ref}
          aria-label={required ? `${label}, required` : label}
          accessibilityHint={describedBy}
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
              ...(weighted ? null : { fontWeight: fontWeights.regular }),
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
        <View aria-live="polite" style={{ flexDirection: "row", gap: spacing.xs, alignItems: "flex-start" }}>
          <Icon name="WarningCircle" size={16} weight="bold" color="dangerText" style={{ marginTop: 1 }} />
          <Text variant="footnote" color="dangerText" style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : helperText ? (
        <Text variant="footnote" color="textTertiary">
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}
