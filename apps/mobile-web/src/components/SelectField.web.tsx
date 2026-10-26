/**
 * Web select: the v2 filled field look, with a real, transparent <select> laid over it so the
 * keyboard, screen-reader, autofill and test behaviour stay native. No option is pre-selected
 * unless `value` is set.
 */
import { useTheme } from '@st/ui';
import { createElement, useId, useState } from 'react';

import type { SelectFieldProps } from './SelectField.types';
import { SelectShell } from './SelectShell';

export type { SelectFieldProps, SelectOption } from './SelectField.types';

export function SelectField(props: SelectFieldProps) {
  const { label, placeholder, value, options, onChange, error, testID } = props;
  const theme = useTheme();
  const id = useId();
  const [focused, setFocused] = useState(false);
  return (
    <SelectShell {...props} focused={focused} labelId={`${id}-label`}>
      {createElement(
        'select',
        {
          'data-testid': testID,
          'aria-labelledby': `${id}-label`,
          'aria-invalid': Boolean(error),
          value: value ?? '',
          onChange: (e: { target: { value: string } }) => onChange(e.target.value),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
          style: {
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            cursor: 'pointer',
            fontSize: 16,
            colorScheme: theme.scheme,
          },
        },
        createElement('option', { value: '', disabled: true }, placeholder),
        ...options.map((o) => createElement('option', { key: o.value, value: o.value }, o.label)),
      )}
    </SelectShell>
  );
}
