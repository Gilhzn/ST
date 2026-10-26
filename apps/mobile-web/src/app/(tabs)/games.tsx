/**
 * My games (design §12.1): Upcoming (hosting, joined, waitlisted, requested),
 * Hosting and Past, in a segmented control. Pull to refresh on native; web has a
 * Refresh button (browsers have no pull gesture).
 */
import { Button, Stack } from '@st/ui';
import { useState } from 'react';
import { Platform, RefreshControl, ScrollView } from 'react-native';

import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { ErrorView, Skeleton } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { GamesList } from '@/features/profile/GamesList';
import { splitMyGames, type GamesSegment } from '@/features/profile/myGames';
import { SegmentedControl } from '@/features/profile/SegmentedControl';
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

  return (
    <Screen
      title={t('common:nav.games')}
      back={false}
      testID="screen.games"
      edges={['top']}
      scroll={false}
      contentStyle={{ flex: 1 }}
      headerEnd={
        Platform.OS === 'web' ? (
          <Button
            testID="games.refresh"
            variant="ghost"
            label={t('games:my.refresh')}
            loading={refreshing}
            startIcon={<Icon name="refresh" size={20} color="primaryText" />}
            onPress={() => void games.reload()}
          />
        ) : undefined
      }
    >
      <SegmentedControl
        testID="games.segments"
        accessibilityLabel={t('games:my.segmentsA11y')}
        value={segment}
        onChange={setSegment}
        segments={[
          { value: 'upcoming', label: t('games:my.segment.upcoming'), testID: 'games.segment.upcoming' },
          { value: 'hosting', label: t('games:my.segment.hosting'), testID: 'games.segment.hosting' },
          { value: 'past', label: t('games:my.segment.past'), testID: 'games.segment.past' },
        ]}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void games.reload()} />}
      >
        {games.loading && games.data === undefined ? (
          <Skeleton />
        ) : games.error && games.data === undefined ? (
          <ErrorView error={games.error} onRetry={() => void games.reload()} />
        ) : (
          <Stack gap="md">
            <GamesList segment={segment} games={groups[segment]} now={now} />
          </Stack>
        )}
      </ScrollView>
    </Screen>
  );
}
