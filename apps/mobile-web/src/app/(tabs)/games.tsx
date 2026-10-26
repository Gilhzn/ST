/**
 * My games (design v2 §15.11): LargeHeader ("Games", "3 upcoming") with a Segmented control
 * Upcoming | Hosting | Past (counts), then day-sectioned GameHeroCards. Pull to refresh on native
 * (light haptic); web has a Refresh icon button (browsers have no pull gesture).
 */
import { Haptics, IconButton, Segmented, spacing } from '@st/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, RefreshControl } from 'react-native';

import { Screen } from '@/components/Screen';
import { ErrorView, Skeleton } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { GamesFeed } from '@/features/games/GamesFeed';
import { splitMyGames, type GamesSegment } from '@/features/profile/myGames';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';

export default function GamesScreen() {
  const { t } = useT();
  const port = useData();
  const now = useNow();
  const [segment, setSegment] = useState<GamesSegment>('upcoming');
  const games = useAsync(() => port.listMyGames(), [port]);
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
              onPress={() => void games.reload()}
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
            void games.reload();
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
        <GamesFeed segment={segment} games={groups[segment]} now={now} />
      )}
    </Screen>
  );
}
