/**
 * Peek-detent carousel of hero game cards, synced with the map selection both ways:
 * tapping a pin scrolls to its card; swiping to a card selects its pin. Tapping a card
 * opens the game. Cards: sport gradient tile + glyph, title, time · distance, players
 * meter, Live/Soon pill. Test id `map.card.<gameId>`, like the list rows (only one of the two is mounted).
 */
import type { NearbyGame } from '@st/domain';
import { BidiText, Icon, isolate, sportColors, Text, useTheme, type IconName } from '@st/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { FlatList, Platform, Pressable, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { gameTiming } from '@/components/GameCard';
import { useT } from '@/i18n';
import { formatDay, formatDistance, formatTime } from '@/lib/format';

import { useWeight } from './MapControls';

export const HERO_HEIGHT = 112;
const GAP = 12;

type SportTone = { color: string; gradient?: readonly [string, string]; phosphor: IconName };

export function GameCarousel({
  games,
  width,
  selectedId,
  onSelect,
  onOpen,
  now,
  miles,
  label,
}: {
  games: readonly NearbyGame[];
  width: number;
  selectedId: string | null;
  onSelect: (g: NearbyGame) => void;
  onOpen: (g: NearbyGame) => void;
  now: number;
  miles: boolean;
  label: string;
}) {
  const list = useRef<FlatList<NearbyGame>>(null);
  const cardW = Math.min(420, width - 56);
  const step = cardW + GAP;
  const fromScroll = useRef(false);

  // Pin → card.
  useEffect(() => {
    if (!selectedId || fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    const i = games.findIndex((g) => g.id === selectedId);
    if (i >= 0) list.current?.scrollToOffset({ offset: i * step, animated: true });
  }, [selectedId, games, step]);

  // Card → pin (when a swipe settles).
  const onSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / step);
    const g = games[Math.max(0, Math.min(games.length - 1, i))];
    if (g && g.id !== selectedId) {
      fromScroll.current = true;
      onSelect(g);
    }
  };

  return (
    <FlatList
      ref={list}
      testID="map.carousel"
      accessibilityLabel={label}
      horizontal
      data={games as NearbyGame[]}
      keyExtractor={(g) => g.id}
      showsHorizontalScrollIndicator={false}
      snapToInterval={step}
      decelerationRate="fast"
      disableIntervalMomentum
      onMomentumScrollEnd={onSettle}
      onScrollEndDrag={(e) => {
        if (!e.nativeEvent.velocity?.x) onSettle(e);
      }}
      contentContainerStyle={{ paddingStart: 16, paddingEnd: 16, gap: GAP, paddingBottom: 4 }}
      style={{ flexGrow: 0, direction: 'ltr' }}
      getItemLayout={(_d, index) => ({ length: step, offset: step * index, index })}
      renderItem={({ item }) => (
        <HeroCard game={item} width={cardW} selected={item.id === selectedId} now={now} miles={miles} onPress={() => onOpen(item)} />
      )}
    />
  );
}

export function HeroCard({
  game,
  width,
  selected,
  now,
  miles,
  onPress,
}: {
  game: NearbyGame;
  width: number;
  selected: boolean;
  now: number;
  miles: boolean;
  onPress: () => void;
}) {
  const { t, locale } = useT();
  const theme = useTheme();
  const weight = useWeight();
  const tone = sportColors[game.sport] as SportTone;
  const grad = tone.gradient ?? [tone.color, tone.color];
  const { live, soon } = gameTiming(game, now);
  const full = game.approvedCount >= game.capacity;
  const fill = Math.min(1, game.approvedCount / Math.max(1, game.capacity));
  const when = t('common:datetime.dayTime', { day: formatDay(game.startsAt, locale, now), time: isolate(formatTime(game.startsAt, locale), 'ltr') });
  const distance = formatDistance(game.distanceM, locale, miles);
  const players = t('map:card.players', { joined: game.approvedCount, capacity: game.capacity });
  const dark = theme.scheme === 'dark';
  return (
    <Pressable
      testID={`map.card.${game.id}`}
      role="button"
      // Web: name from the visible text (WCAG 2.5.3); native: the summary sentence.
      aria-label={Platform.OS === 'web' ? undefined : [t(`common:sports.${game.sport}`), game.title, when, players, t('map:card.distanceAway', { distance }), live ? t('map:card.live') : null]
        .filter(Boolean)
        .join(', ')}
      aria-current={selected ? true : undefined}
      onPress={onPress}
      style={({ pressed }) => ({
        width,
        height: HERO_HEIGHT,
        flexDirection: 'row',
        gap: 12,
        padding: 12,
        borderRadius: 22,
        backgroundColor: theme.colors.surfaceRaised,
        borderWidth: 2,
        borderColor: selected ? theme.colors.primary : dark ? 'rgba(255,255,255,0.06)' : 'rgba(18,17,41,0.06)',
        transform: pressed && !theme.reducedMotion ? [{ scale: 0.98 }] : undefined,
        boxShadow: selected
          ? dark
            ? '0px 10px 24px rgba(0,0,0,0.5)'
            : '0px 10px 24px rgba(75,47,224,0.18)'
          : dark
            ? '0px 4px 14px rgba(0,0,0,0.4)'
            : '0px 4px 14px rgba(18,17,41,0.08)',
        direction: theme.isRTL ? 'rtl' : 'ltr',
      })}
    >
      <View style={{ flex: 1, flexDirection: 'row', gap: 12 }}>
      <LinearGradient colors={[grad[0], grad[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 84, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {/* court-line motif */}
        <View style={{ position: 'absolute', width: 64, height: 64, borderRadius: 32, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)' }} />
        <View style={{ position: 'absolute', top: 0, bottom: 0, width: 1.5, backgroundColor: 'rgba(255,255,255,0.14)' }} />
        <Icon name={tone.phosphor} size={38} weight="fill" color="#FFFFFF" />
      </LinearGradient>
      <View style={{ flex: 1, justifyContent: 'space-between', paddingTop: 2 }}>
        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="caption" color="textSecondary" numberOfLines={1} style={[{ flexShrink: 1 }, weight('semibold')]}>
              {t(`common:sports.${game.sport}`)}
            </Text>
            {live ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingStart: 6, paddingEnd: 7, height: 18, borderRadius: 9, backgroundColor: theme.colors.accent }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.onAccent }} />
                <Text numberOfLines={1} style={[{ fontSize: 10.5, lineHeight: 14, color: theme.colors.onAccent }, weight('bold')]}>
                  {t('map:card.live')}
                </Text>
              </View>
            ) : soon ? (
              <View style={{ paddingStart: 6, paddingEnd: 6, height: 18, borderRadius: 9, justifyContent: 'center', backgroundColor: theme.colors.primarySubtle }}>
                <Text numberOfLines={1} style={[{ fontSize: 10.5, lineHeight: 14, color: theme.colors.onPrimarySubtle }, weight('bold')]}>{t('map:card.startsSoon')}</Text>
              </View>
            ) : null}
          </View>
          <BidiText variant="bodyStrong" numberOfLines={1}>
            {game.title}
          </BidiText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="Clock" size={14} color="textSecondary" />
            <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {when} · {distance}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden', flexDirection: 'row' }}
          >
            <View style={{ width: `${fill * 100}%`, borderRadius: 3, backgroundColor: full ? theme.colors.warning : tone.color }} />
          </View>
          <Text variant="caption" style={[{ fontVariant: ['tabular-nums'], color: full ? theme.colors.warningText : theme.colors.text }, weight('bold')]}>
            {isolate(`${game.approvedCount}/${game.capacity}`, 'ltr')}
          </Text>
        </View>
      </View>
      </View>
    </Pressable>
  );
}

/** Peek-detent empty state: "No games within 5 km — expand to 10 km?" with two clear actions. */
export function MapEmptyCard({
  title,
  hint,
  widenLabel,
  onWiden,
  createLabel,
  onCreate,
}: {
  title: string;
  hint: string;
  widenLabel?: string;
  onWiden?: () => void;
  createLabel: string;
  onCreate: () => void;
}) {
  const theme = useTheme();
  const weight = useWeight();
  const dark = theme.scheme === 'dark';
  return (
    <View
      testID="map.empty"
      style={{
        flexDirection: 'row',
        gap: 14,
        padding: 14,
        borderRadius: 22,
        backgroundColor: theme.colors.surfaceRaised,
        borderWidth: 1,
        borderColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(18,17,41,0.06)',
      }}
    >
      <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primarySubtle }}>
        <Icon name="MapPin" size={26} weight="duotone" color="primary" />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="bodyStrong" accessibilityRole="header">
          {title}
        </Text>
        <Text variant="caption" color="textSecondary">
          {hint}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {widenLabel && onWiden ? (
            <Pressable
              testID="map.empty.widen"
              accessibilityRole="button"
              onPress={onWiden}
              style={({ pressed }) => ({
                height: 40,
                paddingStart: 16,
                paddingEnd: 16,
                borderRadius: 20,
                justifyContent: 'center',
                backgroundColor: pressed ? theme.colors.primaryPressed : theme.colors.primary,
              })}
            >
              <Text variant="label" style={[{ color: theme.colors.onPrimary }, weight('semibold')]}>
                {widenLabel}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            testID="map.empty.create"
            accessibilityRole="button"
            onPress={onCreate}
            style={({ pressed }) => ({
              height: 40,
              paddingStart: 16,
              paddingEnd: 16,
              borderRadius: 20,
              justifyContent: 'center',
              backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
              borderWidth: 1.5,
              borderColor: theme.colors.border,
            })}
          >
            <Text variant="label" style={[{ color: theme.colors.text }, weight('semibold')]}>
              {createLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
