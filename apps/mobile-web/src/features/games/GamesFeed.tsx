/**
 * Games tab feed (design v2 §15.11): GameHeroCards grouped into day sections ("Today",
 * "Tomorrow", "This week", "Later"; past: "This week", "Earlier") under overline headers, each
 * card carrying the viewer's state on the band (You're in · Hosting · Waitlist · Request sent).
 * Delightful, actionable empty states per segment.
 */
import type { GameDetail } from '@st/domain';
import { EmptyState, isolate, spacing, Text, useTheme, type IconName } from '@st/ui';
import { router } from 'expo-router';
import { View } from 'react-native';

import { GameCard, gameTiming, type GameCardStatus } from '@/components/GameCard';
import { myGameState, type GamesSegment, type MyGameState } from '@/features/profile/myGames';
import { useT } from '@/i18n';

const DAY = 24 * 60 * 60 * 1000;

const STATE_PILL: Record<Exclude<MyGameState, null>, IconName> = {
  hosting: 'Strategy',
  going: 'CheckCircle',
  waitlisted: 'Hourglass',
  requested: 'Clock',
  cancelled: 'XCircle',
  checkedIn: 'SealCheck',
  noShow: 'Warning',
};

export type FeedSection = 'today' | 'tomorrow' | 'thisWeek' | 'later' | 'pastWeek' | 'earlier';

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Pure grouping by calendar day relative to `now` (keeps the input order inside a section). */
export function sectionFor(startsAt: string, now: number, past: boolean): FeedSection {
  const diff = Math.round((startOfDay(Date.parse(startsAt)) - startOfDay(now)) / DAY);
  if (past) return diff >= -6 ? 'pastWeek' : 'earlier';
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return 'thisWeek';
  return 'later';
}

export function groupGames(games: readonly GameDetail[], now: number, past: boolean): { key: FeedSection; games: GameDetail[] }[] {
  const order: FeedSection[] = past ? ['pastWeek', 'earlier'] : ['today', 'tomorrow', 'thisWeek', 'later'];
  const map = new Map<FeedSection, GameDetail[]>();
  for (const g of games) {
    const k = sectionFor(g.startsAt, now, past);
    map.set(k, [...(map.get(k) ?? []), g]);
  }
  return order.filter((k) => map.has(k)).map((k) => ({ key: k, games: map.get(k) ?? [] }));
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm }}>
      <Text variant="overline" color="textSecondary" role="heading" aria-level={2}>
        {label}
      </Text>
      <Text variant="overline" color="textTertiary" aria-hidden style={{ fontVariant: ['tabular-nums'] }}>
        {isolate(String(count), 'ltr')}
      </Text>
      <View aria-hidden style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

export function GamesFeed({ segment, games, now }: { segment: GamesSegment; games: readonly GameDetail[]; now: number }) {
  const { t } = useT();
  if (games.length === 0) {
    const action =
      segment === 'past'
        ? { label: t('games:my.findGame'), icon: 'MapTrifold' as const, go: () => router.push('/map') }
        : segment === 'hosting'
          ? { label: t('games:my.hostGame'), icon: 'Plus' as const, go: () => router.push('/game/create') }
          : { label: t('games:my.findGame'), icon: 'MapTrifold' as const, go: () => router.push('/map') };
    return (
      <EmptyState
        testID={`games.empty.${segment}`}
        illustration={segment === 'past' ? 'success' : 'emptyGames'}
        title={t(`games:my.empty.${segment}.title`)}
        body={t(`games:my.empty.${segment}.body`)}
        actionLabel={action.label}
        actionIcon={action.icon}
        onAction={action.go}
        secondaryLabel={segment === 'upcoming' ? t('games:my.hostGame') : undefined}
        onSecondary={segment === 'upcoming' ? () => router.push('/game/create') : undefined}
      />
    );
  }
  const sections = groupGames(games, now, segment === 'past');
  return (
    <View style={{ gap: spacing.xl }} testID="games.list">
      {sections.map((s) => (
        <View key={s.key} style={{ gap: spacing.md }} testID={`games.section.${s.key}`}>
          <SectionHeader label={t(`games:my.section.${s.key}`)} count={s.games.length} />
          {s.games.map((g) => {
            const state = myGameState(g, now);
            const status: GameCardStatus | null = state && !gameTiming(g, now).live ? { label: t(`games:my.state.${state}`), icon: STATE_PILL[state] } : null;
            return (
              <GameCard
                key={g.id}
                game={g}
                host={g.host}
                now={now}
                status={status ?? undefined}
                testID={`games.card.${g.id}`}
                onPress={() => router.push(`/game/${g.id}`)}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}
