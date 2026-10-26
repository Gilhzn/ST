/** My games (design §12.1): upcoming hosting/joined/waitlisted/requested, then past. Full UI next wave. */
import { Stack, Text } from '@st/ui';
import { router } from 'expo-router';

import { GameCard } from '@/components/GameCard';
import { Screen } from '@/components/Screen';
import { ErrorView, Skeleton } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';

export default function GamesScreen() {
  const { t } = useT();
  const port = useData();
  const now = useNow();
  const games = useAsync(() => port.listMyGames(), [port]);
  return (
    <Screen title={t('common:nav.games')} back={false} testID="screen.games" edges={['top']}>
      {games.loading && !games.data ? (
        <Skeleton />
      ) : games.error ? (
        <ErrorView error={games.error} onRetry={() => void games.reload()} />
      ) : (
        <Stack gap="md">
          {(games.data ?? []).length === 0 ? (
            <Text variant="body" color="textSecondary">
              {t('profile:history.empty')}
            </Text>
          ) : null}
          {(games.data ?? []).map((g) => (
            <GameCard key={g.id} game={g} host={g.host} now={now} testID={`games.card.${g.id}`} onPress={() => router.push(`/game/${g.id}`)} />
          ))}
        </Stack>
      )}
    </Screen>
  );
}
