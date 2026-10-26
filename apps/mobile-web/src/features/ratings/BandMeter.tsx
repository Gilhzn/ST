/**
 * Host-only skill band (RATE-004): five rising bars with the band digit, for balancing teams.
 * Never shown to players; spoken as "Level band 3 of 5".
 */
import type { Stars } from '@st/domain';
import { isolate, radius, spacing, Text, useTheme } from '@st/ui';
import { View } from 'react-native';

import { useT } from '@/i18n';

export function BandMeter({ band, testID }: { band: Stars; testID?: string }) {
  const { t } = useT();
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      role="img"
      aria-label={t('ratings:band.a11y', { band })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: 28, paddingStart: spacing.sm, paddingEnd: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken }}
    >
      <View aria-hidden style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <View key={n} style={{ width: 3, height: 4 + n * 2, borderRadius: 1.5, backgroundColor: n <= band ? colors.primary : colors.borderStrong, opacity: n <= band ? 1 : 0.45 }} />
        ))}
      </View>
      <Text variant="caption" weight="bold" color="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
        {isolate(String(band), 'ltr')}
      </Text>
    </View>
  );
}
