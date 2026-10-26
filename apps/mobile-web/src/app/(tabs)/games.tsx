/**
 * My games (design v2 §15.11): LargeHeader ("Games", "3 upcoming") with a Segmented control
 * Upcoming | Hosting | Past (counts), then day-sectioned GameHeroCards. Pull to refresh on native
 * (light haptic); web has a Refresh icon button (browsers have no pull gesture).
 */
import { Haptics, IconButton, Segmented, spacing, Text } from '@st/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { ErrorView, Skeleton } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { GamesFeed } from '@/features/games/GamesFeed';
import { FriendsPlaying, groupFriendGames } from '@/features/network/FriendsPlaying';
import { dayLabel, timeIn } from '@/features/series/format';
import { SeriesCard } from '@/features/series/SeriesParts';
import { splitMyGames, type GamesSegment } from '@/features/profile/myGames';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';

export default function GamesScreen() {
  const { t, locale } = useT();
  const port = useData();
  const now = useNow();
  const [segment, setSegment] = useState<GamesSegment>('upcoming');
  const games = useAsync(() => port.listMyGames(), [port]);
  const series = useAsync(async () => {
    const list = await port.listMySeries();
    const details = await Promise.all(list.filter((x) => x.status !== 'ended').map((x) => port.getSeries(x.id).catch(() => null)));
    return details.filter((d): d is NonNullable<typeof d> => !!d);
  }, [port]);
  const friends = useAsync(() => port.listFriendsUpcomingGames(), [port]);
  const refreshing = games.loading && games.data !== undefined;
  const groups = splitMyGames(games.data ?? [], now);
  const loaded = games.data !== undefined;

  return (
    <Screen
      testID="screen.games"
      large
      title={t('common:nav.games')}
      subtitle={loaded ? t('games:my.subtitle', { count: groups.upcoming.length }) : undefined}
      back={false}
      edges={['top']}
      headerEnd={
        <>
          {Platform.OS === 'web' ? (
            <IconButton
              testID="games.refresh"
              icon="ArrowClockwise"
              variant="tonal"
              label={t('games:my.refresh')}
              onPress={() => void Promise.all([games.reload(), series.reload(), friends.reload()])}
            />
          ) : null}
          <IconButton testID="games.create" icon="Plus" variant="filled" label={t('map:createGame.fab')} onPress={() => router.push('/game/create')} />
        </>
      }
      headerChildren={
        <Segmented
          testID="games.segments"
          label={t('games:my.segmentsA11y')}
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'upcoming', label: t('games:my.segment.upcoming'), count: loaded ? groups.upcoming.length : undefined, testID: 'games.segment.upcoming' },
            { value: 'hosting', label: t('games:my.segment.hosting'), count: loaded ? groups.hosting.length : undefined, testID: 'games.segment.hosting' },
            { value: 'past', label: t('games:my.segment.past'), testID: 'games.segment.past' },
          ]}
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            Haptics.trigger('pullToRefresh');
            void Promise.all([games.reload(), series.reload(), friends.reload()]);
          }}
        />
      }
      contentStyle={{ paddingTop: spacing.sm }}
    >
      {games.loading && games.data === undefined ? (
        <Skeleton kind="game" rows={2} />
      ) : games.error && games.data === undefined ? (
        <ErrorView error={games.error} onRetry={() => void games.reload()} />
      ) : (
        <>
          {segment !== 'past' && series.data?.length ? (
            <View style={{ gap: spacing.sm }} testID="games.series">
              <Text variant="overline" color="textSecondary" role="heading" aria-level={2}>
                {t('series:card.yourSeries')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingEnd: spacing.lg, paddingBottom: spacing.sm, paddingTop: 2 }} style={{ marginEnd: -spacing.lg }}>
                {series.data.map((d) => {
                  const next = d.upcoming.find((o) => o.status === 'scheduled' && Date.parse(o.startsAt) > now);
                  return (
                    <SeriesCard
                      key={d.series.id}
                      testID={`games.series.${d.series.id}`}
                      width={280}
                      series={d.series}
                      regulars={d.rosterCount}
                      nextLabel={next ? t('series:card.next', { date: `${dayLabel(next.startsAt, locale, d.series.timeZone)} · ${timeIn(next.startsAt, locale, d.series.timeZone)}` }) : null}
                      status={
                        d.isHost
                          ? { label: t('games:my.state.hosting'), tone: 'brand', icon: 'Strategy' }
                          : d.myRoster?.status === 'invited'
                            ? { label: t('series:card.invited'), tone: 'warning', icon: 'UserPlus' }
                            : { label: t('series:card.regular'), tone: 'success', icon: 'CheckCircle' }
                      }
                      onPress={() => router.push(`/series/${d.series.id}`)}
                    />
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          {segment === 'upcoming' ? (
            <FriendsPlaying items={groupFriendGames(friends.data ?? [], new Set((games.data ?? []).filter((g) => g.isHost || (g.myParticipation && g.myParticipation.status !== 'cancelled')).map((g) => g.id)))} now={now} />
          ) : null}
          <GamesFeed segment={segment} games={groups[segment]} now={now} />
        </>
      )}
    </Screen>
  );
}
