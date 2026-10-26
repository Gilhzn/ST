/**
 * Visual shell shared by the native and web SelectField: label above, a 52dp filled field
 * (radius 14, sunken; focus → surface + 2dp focus ring + 4dp brand halo; error → danger border),
 * optional leading icon/node, value or placeholder, trailing text and a CaretDown. The platform
 * file overlays the actual control (a Pressable on native, a transparent <select> on web).
 */
import { borderWidth, Icon, radius, sizing, spacing, Text, useTheme } from '@st/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { SelectFieldProps } from './SelectField.types';

export function SelectShell({
  label,
  placeholder,
  value,
  options,
  error,
  helperText,
  icon,
  start,
  display,
  trailingText,
  focused,
  labelId,
  children,
}: SelectFieldProps & { focused: boolean; labelId?: string; children: ReactNode }) {
  const theme = useTheme();
  const c = theme.colors;
  const selected = options.find((o) => o.value === value);
  const shown = display ?? selected?.label;
  return (
    <View style={{ gap: spacing.xs + 2 }}>
      <Text variant="label" color="textSecondary" nativeID={labelId}>
        {label}
      </Text>
      <View
        style={{
          minHeight: sizing.inputHeight,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingStart: spacing.lg,
          paddingEnd: spacing.md,
          borderRadius: radius.md,
          backgroundColor: focused ? c.surface : c.surfaceSunken,
          borderWidth: borderWidth.thick,
          borderColor: error ? c.danger : focused ? c.focusRing : theme.scheme === 'dark' ? c.border : 'transparent',
          ...(focused && !error ? { boxShadow: `0px 0px 0px 4px ${theme.scheme === 'dark' ? 'rgba(143, 125, 255, 0.22)' : 'rgba(91, 61, 245, 0.14)'}` } : null),
        }}
      >
        {icon ? <Icon name={icon} size={20} color={focused ? 'primary' : 'textTertiary'} /> : null}
        {start}
        <Text variant="body" color={shown ? 'text' : 'textTertiary'} numberOfLines={1} style={{ flex: 1 }}>
          {shown ?? placeholder}
        </Text>
        {trailingText ? (
          <Text variant="body" weight="medium" color="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
            {trailingText}
          </Text>
        ) : null}
        <Icon name="CaretDown" size={18} weight="bold" color="textTertiary" />
        {children}
      </View>
      {error ? (
        <View aria-live="polite" style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start' }}>
          <Icon name="WarningCircle" size={16} weight="bold" color="dangerText" />
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
