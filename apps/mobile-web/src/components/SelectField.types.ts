import type { IconName } from '@st/ui';
import type { ReactNode } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  placeholder: string;
  value: string | null;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  error?: string;
  helperText?: string;
  testID?: string;
  /** Leading Phosphor icon inside the field (CalendarBlank, Clock…). */
  icon?: IconName;
  /** Custom leading node (a flag). */
  start?: ReactNode;
  /** Text shown in the field instead of the option label (e.g. "Israel"). */
  display?: string;
  /** Trailing text shown before the caret (e.g. a dial code, as an LTR isolate). */
  trailingText?: string;
}
