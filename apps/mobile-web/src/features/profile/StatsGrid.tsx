/** Profile counts (design §13.12): played, verified attendance, no-shows, late cancels. Tabular numerals; one focus stop per tile. */
import type { ReliabilitySnapshot } from '@st/domain';
import { isolate, Row, Stack, Text, useTheme, radius, spacing } from '@st/ui';
import { View } from 'react-native';

import { useT } from '@/i18n';
import { formatNumber } from '@/lib/format';

function Tile({ label, value, testID }: { label: string; value: string; testID: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
      style={{ flexBasis: '47%', flexGrow: 1, minHeight: 80, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }}
    >
      <Stack gap="xxs">
        <Text variant="title2" style={{ fontVariant: ['tabular-nums'] }}>
          {isolate(value, 'ltr')}
        </Text>
        <Text variant="caption" color="textSecondary">
          {label}
        </Text>
      </Stack>
    </View>
  );
}

export function StatsGrid({ reliability }: { reliability: ReliabilitySnapshot }) {
  const { t, locale } = useT();
  const n = (v: number) => formatNumber(Math.round(v), locale);
  return (
    <Stack gap="sm" testID="profile.stats">
      <Text variant="title3">{t('profile:stats.title')}</Text>
      <Row gap="sm" wrap align="stretch">
        <Tile testID="profile.stat.played" label={t('profile:stats.gamesPlayed')} value={n(reliability.commitmentCount)} />
        <Tile testID="profile.stat.verified" label={t('profile:stats.verifiedAttendance')} value={n(reliability.verifiedCount)} />
        <Tile testID="profile.stat.noShows" label={t('profile:stats.noShows')} value={n(reliability.noShowCount)} />
        <Tile testID="profile.stat.lateCancels" label={t('profile:stats.lateCancels')} value={n(reliability.lateCancelCount)} />
      </Row>
    </Stack>
  );
}
