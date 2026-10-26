import { Icon as UiIcon, SportIcon as UiSportIcon, type IconName as PhosphorName, type IconWeight } from '@st/ui';
import type { SportId } from '@st/domain';
import type { ColorToken } from '@st/ui';

/** Phosphor registry name (design v2 §9). v1 MaterialCommunityIcons names are no longer accepted. */
export type IconName = PhosphorName;

/**
 * App icon: Phosphor via @st/ui (design v2 §9). Decorative by default; pair with visible text
 * or pass `label`. Directional glyphs mirror in RTL automatically (registry list) or via `directional`.
 */
export function Icon({
  name,
  size = 24,
  color = 'textSecondary',
  weight = 'regular',
  directional,
  label,
}: {
  name: IconName;
  size?: number;
  color?: ColorToken | (string & {});
  weight?: IconWeight;
  directional?: boolean;
  label?: string;
}) {
  return <UiIcon name={name} size={size} color={color} weight={weight} directional={directional} label={label} />;
}

export function SportIcon({ sport, size = 20, color, weight }: { sport: SportId; size?: number; color?: string; weight?: IconWeight }) {
  return <UiSportIcon sport={sport} size={size} color={color} weight={weight} />;
}
