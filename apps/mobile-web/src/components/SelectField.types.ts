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
}
