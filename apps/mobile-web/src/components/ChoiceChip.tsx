import { Chip, type ChipProps } from '@st/ui';

/**
 * `@st/ui` Chip plus explicit ARIA state. react-native-web 0.21 ignores
 * `accessibilityState`, so checked/disabled would not reach the DOM on web
 * (reported to the UI owner; this wrapper becomes a no-op once Chip passes aria-*).
 */
export function ChoiceChip({ selected = false, disabled, ...props }: ChipProps & { 'aria-disabled'?: boolean }) {
  const ariaDisabled = props['aria-disabled'] ?? !!disabled;
  return <Chip {...props} selected={selected} disabled={disabled} aria-checked={selected} aria-disabled={ariaDisabled} />;
}
