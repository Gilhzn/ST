/**
 * Games tab → "Friends are playing": upcoming public games that friends joined and share with
 * friends (their privacy setting), excluding games the viewer is already in. One card per game,
 * with every friend in it.
 */
import type { FriendUpcomingGame, GameSummary, PublicProfile } from '@st/domain';
import { AvatarStack, BidiText, Haptics, isolate, radius, spacing, SportGlyphBadge, Text, usePressScale, useTheme } from '@st/ui';
import { router } from 'expo-router';
import { Animated, Pressable, ScrollView, View } from 'react-native';

import { capitalize } from '@/components/GameCard';
import { focusVisible } from '@/components/focusVisible';
import { useT } from '@/i18n';
import { formatDay, formatList, formatTime } from '@/lib/format';

export function groupFriendGames(list: readonly FriendUpcomingGame[], exclude: ReadonlySet<string>): { game: GameSummary; friends: PublicProfile[] }[] {
  const map = new Map<string, { game: GameSummary; friends: PublicProfile[] }>();
  for (const x of list) {
    if (exclude.has(x.game.id)) continue;
    const g = map.get(x.game.id) ?? { game: x.game, friends: [] };
    if (!g.friends.some((f) => f.id === x.friend.id)) g.friends.push(x.friend);
    map.set(x.game.id, g);
  }
  return [...map.values()].sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt));
}

export function FriendsPlaying({ items, now }: { items: { game: GameSummary; friends: PublicProfile[] }[]; now: number }) {
  const { t } = useT();
  if (!items.length) return null;
  return (
    <View style={{ gap: spacing.sm }} testID="games.friends">
      <Text variant="overline" color="textSecondary" role="heading" aria-level={2}>
        {t('network:playing.title')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingEnd: spacing.lg, paddingBottom: spacing.sm, paddingTop: 2 }} style={{ marginEnd: -spacing.lg }}>
        {items.map((x) => (
          <FriendGameCard key={x.game.id} game={x.game} friends={x.friends} now={now} />
        ))}
      </ScrollView>
    </View>
  );
}

function FriendGameCard({ game, friends, now }: { game: GameSummary; friends: PublicProfile[]; now: number }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const press = usePressScale(0.985);
  const names = formatList(friends.map((f) => f.displayName), locale, 'conjunction');
  const who = t('network:playing.who', { names, count: friends.length });
  const when = t('common:datetime.dayTime', { day: capitalize(formatDay(game.startsAt, locale, now), locale), time: isolate(formatTime(game.startsAt, locale), 'ltr') });
  const spots = Math.max(0, game.capacity - game.approvedCount);
  const s = theme.sport(game.sport);
  return (
    <Animated.View style={press.style}>
      <Pressable
        testID={`games.friends.${game.id}`}
        role="button"
        aria-label={[who, game.title, when].join('. ')}
        onPress={() => {
          Haptics.selection();
          router.push(`/game/${game.id}`);
        }}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={(st) => {
          const { focused } = st as { focused?: boolean };
          return {
            width: 268,
            padding: spacing.lg,
            gap: spacing.md,
            borderRadius: radius.lg,
            backgroundColor: theme.colors.surface,
            borderTopWidth: 4,
            borderTopColor: s.color,
            ...theme.elevation(theme.scheme === 'dark' ? 1 : 2),
            ...(focusVisible(focused) ? ({ outlineColor: theme.colors.focusRing, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 2 } as object) : null),
          };
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AvatarStack people={friends.map((f) => ({ name: f.displayName, uri: f.avatarUrl }))} max={3} size="sm" label={names} ringColor={theme.colors.surface} />
          <Text variant="footnote" weight="semibold" color="primaryText" numberOfLines={2} style={{ flex: 1 }}>
            {who}
          </Text>
        </View>
        <BidiText variant="headline" numberOfLines={2} style={{ minHeight: 44 }}>
          {game.title}
        </BidiText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <SportGlyphBadge sport={game.sport} size={28} squircle />
          <Text variant="footnote" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
            {when}
          </Text>
          <Text variant="caption" weight="semibold" color={spots ? 'successText' : 'textTertiary'} numberOfLines={1}>
            {t('common:players.spotsLeft', { count: spots })}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
