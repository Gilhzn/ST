/**
 * Profile → "Levels": one LevelCard per sport and format (most games first), with the weekly
 * history and the private peer summary. A calm empty card explains how a level is earned.
 */
import type { PeerSkillSummary, RatingUpdate, SportId } from '@st/domain';
import { Icon, spacing, Text, useTheme } from '@st/ui';
import { View } from 'react-native';

import { Skeleton } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { listMyRatingHistory } from '@/data/extensions';
import { useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';

import { LevelCard } from './LevelCard';

export function LevelsSection({ userId, reliability }: { userId: string; reliability: number | null }) {
  const { t } = useT();
  const theme = useTheme();
  const port = useData();
  const data = useAsync(async () => {
    const ratings = await port.listMySkillRatings();
    const sports = [...new Set(ratings.map((r) => r.sport))] as SportId[];
    const [history, peers] = await Promise.all([
      listMyRatingHistory(port).catch(() => [] as RatingUpdate[]),
      Promise.all(sports.map((s) => port.getMyPeerSummary(s).catch(() => null))),
    ]);
    return { ratings, history, peers: new Map(sports.map((s, i) => [s, peers[i] ?? null] as [SportId, PeerSkillSummary | null])) };
  }, [port, userId]);

  return (
    <View style={{ gap: spacing.sm }} testID="profile.levels">
      <Text variant="overline" color="textTertiary" role="heading" style={{ paddingStart: spacing.lg }}>
        {t('ratings:level.sectionTitle')}
      </Text>
      {data.loading && !data.data ? (
        <Skeleton height={220} rows={1} />
      ) : !data.data || data.data.ratings.length === 0 ? (
        <View testID="profile.levels.empty" style={{ flexDirection: 'row', gap: spacing.md, padding: spacing.lg, borderRadius: 20, backgroundColor: theme.colors.surface, ...theme.elevation(1) }}>
          <View aria-hidden style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primarySubtle }}>
            <Icon name="ChartLineUp" size={22} weight="duotone" color="onPrimarySubtle" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">{t('ratings:level.emptyTitle')}</Text>
            <Text variant="footnote" color="textSecondary">
              {t('ratings:level.emptyBody')}
            </Text>
          </View>
        </View>
      ) : (
        data.data.ratings.map((r) => (
          <LevelCard
            key={`${r.sport}.${r.formatFamily}`}
            rating={r}
            reliability={reliability}
            history={data.data?.history.filter((u) => u.sport === r.sport && u.formatFamily === r.formatFamily) ?? []}
            peers={data.data?.peers.get(r.sport) ?? null}
          />
        ))
      )}
    </View>
  );
}
