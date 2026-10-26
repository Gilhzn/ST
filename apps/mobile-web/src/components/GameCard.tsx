/**
 * Game card (design §13.3): sport marker, title, time (LTR isolate), players with
 * a progress bar that mirrors, distance, host reliability, badges and the volt
 * "lane line" when starting within 2 h or live. One focus stop with a summary label.
 */
import type { GameSummary, PublicProfile } from '@st/domain';
import { BidiText, Card, isolate, radius, Row, SportDot, Stack, Text, useTheme } from '@st/ui';
import { View } from 'react-native';

import { useT } from '@/i18n';
import { formatDay, formatDistance, formatList, formatMoney, formatTime } from '@/lib/format';

import { ReliabilityBadge } from './ReliabilityBadge';
import { Tag } from './Tag';

const SOON_MS = 2 * 60 * 60 * 1000;

export function gameTiming(game: Pick<GameSummary, 'startsAt' | 'endsAt'>, now: number) {
  const start = Date.parse(game.startsAt);
  const end = Date.parse(game.endsAt);
  return { live: now >= start && now < end, soon: start > now && start - now <= SOON_MS };
}

export function GameCard({
  game,
  host,
  distanceM,
  now,
  onPress,
  testID,
  miles = false,
  selected = false,
}: {
  game: GameSummary;
  host?: PublicProfile | null;
  distanceM?: number | null;
  now: number;
  onPress?: () => void;
  testID?: string;
  miles?: boolean;
  selected?: boolean;
}) {
  const { t, locale } = useT();
  const { colors } = useTheme();
  const { live, soon } = gameTiming(game, now);
  const full = game.approvedCount >= game.capacity;
  const sport = t(`common:sports.${game.sport}`);
  const day = formatDay(game.startsAt, locale, now);
  const time = formatTime(game.startsAt, locale);
  const when = t('common:datetime.dayTime', { day, time: isolate(time, 'ltr') });
  const players = t('map:card.players', { joined: game.approvedCount, capacity: game.capacity });
  const distance = distanceM != null ? formatDistance(distanceM, locale, miles) : null;
  const fill = Math.min(1, game.approvedCount / Math.max(1, game.capacity));
  const summary = formatList([
    sport,
    game.title,
    players,
    when,
    distance ? t('map:card.distanceAway', { distance }) : null,
    game.depositMinor > 0 ? t('map:card.badge.deposit') : null,
    game.womenOnly ? t('map:card.badge.womenOnly') : null,
    game.visibility === 'private' ? t('map:card.badge.private') : null,
    full ? t('map:card.badge.full') : null,
  ].filter((x): x is string => !!x), locale);

  return (
    <View testID={testID}>
    <Card
      onPress={onPress}
      accentEdge={live || soon}
      accessibilityLabel={summary}
      accessibilityState={{ selected }}
      style={selected ? { borderWidth: 2, borderColor: colors.primary } : undefined}
    >
      <Stack gap="sm">
        <Row gap="sm" align="center">
          <SportDot sport={game.sport} size={16} />
          <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
            {sport}
          </Text>
          {live ? <Tag label={t('map:card.live')} tone="info" icon="broadcast" /> : soon ? <Tag label={t('map:card.startsSoon')} icon="clock-fast" /> : null}
        </Row>
        <BidiText variant="title3" numberOfLines={2}>
          {game.title}
        </BidiText>
        <Row gap="md" wrap>
          <Text variant="callout" color="textSecondary">
            {when}
          </Text>
          {distance ? (
            <Text variant="callout" color="textSecondary">
              {t('map:card.distanceAway', { distance })}
            </Text>
          ) : null}
        </Row>
        <Row gap="sm" align="center">
          <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
            {isolate(`${game.approvedCount}/${game.capacity}`, 'ltr')}
          </Text>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden', flexDirection: 'row' }}
          >
            <View style={{ width: `${fill * 100}%`, backgroundColor: full ? colors.warning : colors.primary }} />
          </View>
        </Row>
        <Row gap="xs" wrap>
          {host ? <ReliabilityBadge status={host.reliabilityStatus} score={host.reliabilityScore} /> : null}
          {game.depositMinor > 0 ? (
            <Tag icon="shield-lock-outline" label={formatMoney(game.depositMinor, game.currency, locale)} />
          ) : null}
          {game.womenOnly ? <Tag icon="gender-female" label={t('map:card.badge.womenOnly')} /> : null}
          {game.visibility === 'private' ? <Tag icon="lock-outline" label={t('map:card.badge.private')} /> : null}
          {full ? <Tag icon="timer-sand" label={game.waitlistCount ? t('map:card.badge.waitlist') : t('map:card.badge.full')} tone="warning" /> : null}
        </Row>
      </Stack>
    </Card>
    </View>
  );
}
