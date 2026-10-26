/**
 * Profile stats (design v2 §15.13): a 2 × 2 grid of StatTiles — games played, verified
 * check-ins, no-shows and the current check-in streak — plus late cancels as a grouped row.
 * Tabular numerals; one focus stop per tile.
 */
import type { GameDetail, ReliabilitySnapshot } from '@st/domain';
import { isolate, ListGroup, ListItem, spacing, StatTile, Text } from '@st/ui';
import { View } from 'react-native';

import { useT } from '@/i18n';
import { formatNumber } from '@/lib/format';

/** Consecutive verified check-ins, most recent finished game first. */
export function checkInStreak(games: readonly GameDetail[], now: number): number {
  const past = games
    .filter((g) => Date.parse(g.endsAt) < now && g.myParticipation?.status === 'approved' && g.status !== 'cancelled')
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  let n = 0;
  for (const g of past) {
    const a = g.myParticipation?.attendance;
    if (a === 'verified') n++;
    else if (a === 'excused') continue;
    else break;
  }
  return n;
}

export function StatsGrid({ reliability, streak }: { reliability: ReliabilitySnapshot; streak: number | null }) {
  const { t, locale } = useT();
  const n = (v: number) => isolate(formatNumber(Math.round(v), locale), 'ltr');
  return (
    <View testID="profile.stats" style={{ gap: spacing.sm }}>
      <Text variant="overline" color="textTertiary" role="heading" style={{ paddingStart: spacing.lg }}>
        {t('profile:stats.title')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        <StatTile testID="profile.stat.played" icon="CalendarCheck" value={n(reliability.commitmentCount)} label={t('profile:stats.gamesPlayed')} style={{ flexBasis: '45%' }} />
        <StatTile testID="profile.stat.verified" icon="CheckCircle" value={n(reliability.verifiedCount)} label={t('profile:stats.verifiedAttendance')} style={{ flexBasis: '45%' }} />
        <StatTile testID="profile.stat.noShows" icon="Prohibit" value={n(reliability.noShowCount)} label={t('profile:stats.noShows')} style={{ flexBasis: '45%' }} />
        <StatTile testID="profile.stat.streak" icon="Fire" value={streak === null ? '—' : n(streak)} label={t('profile:stats.streak')} style={{ flexBasis: '45%' }} />
      </View>
      <View testID="profile.stat.lateCancels">
        <ListGroup>
          <ListItem icon="ClockCountdown" iconTone="neutral" title={t('profile:stats.lateCancels')} value={n(reliability.lateCancelCount)} />
        </ListGroup>
      </View>
    </View>
  );
}
