/** My games list: one card per game with a status tag, plus calm empty states per segment. */
import type { GameDetail } from '@st/domain';
import { EmptyState, Stack } from '@st/ui';
import { router } from 'expo-router';

import { GameCard } from '@/components/GameCard';
import { Tag } from '@/components/Tag';
import { useT } from '@/i18n';

import { myGameState, type GamesSegment, type MyGameState } from './myGames';

const STATE_TAG: Record<Exclude<MyGameState, null>, { icon: Parameters<typeof Tag>[0]['icon']; tone?: 'warning' | 'info' }> = {
  hosting: { icon: 'whistle-outline', tone: 'info' },
  going: { icon: 'check-circle-outline', tone: 'info' },
  waitlisted: { icon: 'timer-sand', tone: 'warning' },
  requested: { icon: 'clock-outline' },
  cancelled: { icon: 'close-circle-outline', tone: 'warning' },
  checkedIn: { icon: 'check-decagram-outline' },
  noShow: { icon: 'alert-outline', tone: 'warning' },
};

export function GamesList({ segment, games, now }: { segment: GamesSegment; games: readonly GameDetail[]; now: number }) {
  const { t } = useT();
  if (games.length === 0) {
    const action =
      segment === 'past'
        ? undefined
        : segment === 'hosting'
          ? { label: t('games:my.hostGame'), go: () => router.push('/game/create') }
          : { label: t('games:my.findGame'), go: () => router.push('/map') };
    return (
      <EmptyState
        title={t(`games:my.empty.${segment}.title`)}
        body={t(`games:my.empty.${segment}.body`)}
        actionLabel={action?.label}
        onAction={action?.go}
      />
    );
  }
  return (
    <Stack gap="md" testID="games.list">
      {games.map((g) => {
        const state = myGameState(g, now);
        const tag = state ? STATE_TAG[state] : null;
        return (
          <Stack key={g.id} gap="xs">
            {tag && state ? <Tag testID={`games.state.${g.id}`} icon={tag.icon} tone={tag.tone} label={t(`games:my.state.${state}`)} /> : null}
            <GameCard game={g} host={g.host} now={now} testID={`games.card.${g.id}`} onPress={() => router.push(`/game/${g.id}`)} />
          </Stack>
        );
      })}
    </Stack>
  );
}
