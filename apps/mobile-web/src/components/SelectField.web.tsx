/**
 * Web select: a real <select> (native keyboard, screen-reader and autofill
 * behaviour) styled like TextField. No option is pre-selected unless `value` is set.
 */
import { borderWidth, radius, sizing, spacing, Text, useTheme } from '@st/ui';
import { createElement, useId } from 'react';
import { View } from 'react-native';

import type { SelectFieldProps } from './SelectField.types';

export type { SelectFieldProps, SelectOption } from './SelectField.types';

export function SelectField({ label, placeholder, value, options, onChange, error, helperText, testID }: SelectFieldProps) {
  const theme = useTheme();
  const c = theme.colors;
  const id = useId();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="label" nativeID={`${id}-label`}>
        {label}
      </Text>
      {createElement(
        'select',
        {
          'data-testid': testID,
          'aria-labelledby': `${id}-label`,
          'aria-invalid': Boolean(error),
          value: value ?? '',
          onChange: (e: { target: { value: string } }) => onChange(e.target.value),
          style: {
            minHeight: sizing.touchTarget,
            paddingInlineStart: spacing.md,
            paddingInlineEnd: spacing.md,
            borderRadius: radius.md,
            borderStyle: 'solid',
            borderWidth: error ? borderWidth.thick : borderWidth.regular,
            borderColor: error ? c.danger : c.borderStrong,
            backgroundColor: c.surface,
            color: value ? c.text : c.textTertiary,
            fontSize: 16,
            fontFamily: 'inherit',
          },
        },
        createElement('option', { value: '', disabled: true }, placeholder),
        ...options.map((o) => createElement('option', { key: o.value, value: o.value }, o.label)),
      )}
      {error ? (
        <Text variant="caption" color="dangerText" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : helperText ? (
        <Text variant="caption" color="textTertiary">
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}
