import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Mirror, sportColors, useTheme, type ColorToken } from '@st/ui';
import type { SportId } from '@st/domain';
import type { ComponentProps } from 'react';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * MaterialCommunityIcons with semantic colors (design §8). Decorative by default;
 * pair with visible text or give the parent an accessibility label.
 * `directional` icons (chevrons, back arrow, send) mirror in RTL.
 */
export function Icon({
  name,
  size = 24,
  color = 'textSecondary',
  directional = false,
}: {
  name: IconName;
  size?: number;
  color?: ColorToken;
  directional?: boolean;
}) {
  const { colors } = useTheme();
  const glyph = (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={colors[color]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
  return directional ? <Mirror>{glyph}</Mirror> : glyph;
}

export function SportIcon({ sport, size = 20, color }: { sport: SportId; size?: number; color?: string }) {
  const { colors } = useTheme();
  return (
    <MaterialCommunityIcons
      name={sportColors[sport].icon as IconName}
      size={size}
      color={color ?? colors.text}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
