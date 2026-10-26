import { Chip, type ChipProps } from '@st/ui';

/**
 * `@st/ui` Chip (v2: inverse fill + bold check when selected, sport glyph, chip-toggle haptic).
 * Kept as the app's import point; `Chip` already exposes aria-checked / aria-disabled.
 */
export function ChoiceChip({ selected = false, ...props }: ChipProps & { 'aria-disabled'?: boolean }) {
  return <Chip {...props} selected={selected} />;
}
