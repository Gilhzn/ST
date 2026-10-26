/**
 * Game card (design v2 §14 GameHeroCard): sport gradient band (glyph, sport, big tabular time,
 * day · relative, status pill), title, venue · distance, host reliability + deposit + tags, and a
 * footer with the avatar stack, `7/10` and a fill ring. One focus stop with a spoken summary.
 * The props are unchanged from v1 so the map, venue sheet, games tab and invite reuse it.
 */
import type { GameDetail, GameSummary, PublicProfile } from '@st/domain';
import { GameHeroCard, radius, useTheme, type IconName, type PillTone } from '@st/ui';
import { View } from 'react-native';

import { useT } from '@/i18n';
import { formatDay, formatDistance, formatList, formatMoney, formatRelative, formatTime } from '@/lib/format';

const SOON_MS = 2 * 60 * 60 * 1000;
const RELATIVE_MS = 3 * 60 * 60 * 1000;

export function gameTiming(game: Pick<GameSummary, 'startsAt' | 'endsAt'>, now: number) {
  const start = Date.parse(game.startsAt);
  const end = Date.parse(game.endsAt);
  return { live: now >= start && now < end, soon: start > now && start - now <= SOON_MS };
}

/** First letter upper-cased for scripts with case ("today" → "Today"); no-op elsewhere. */
export function capitalize(s: string, locale: string): string {
  return s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s;
}

export interface GameCardStatus {
  label: string;
  tone?: PillTone;
  icon?: IconName;
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
  venueName,
  status: statusOverride,
}: {
  game: GameSummary | GameDetail;
  host?: PublicProfile | null;
  distanceM?: number | null;
  now: number;
  onPress?: () => void;
  testID?: string;
  miles?: boolean;
  selected?: boolean;
  /** Venue label when the game object has none (map results). */
  venueName?: string | null;
  /** Overrides the band pill (e.g. "You're in", "Hosting" on the games tab). */
  status?: GameCardStatus | null;
}) {
  const { t, locale } = useT();
  const { colors } = useTheme();
  const { live, soon } = gameTiming(game, now);
  const full = game.approvedCount >= game.capacity;
  const sport = t(`common:sports.${game.sport}`);
  const day = capitalize(formatDay(game.startsAt, locale, now), locale);
  const time = formatTime(game.startsAt, locale);
  const startMs = Date.parse(game.startsAt);
  const relative = !live && startMs > now && startMs - now <= RELATIVE_MS ? formatRelative(game.startsAt, locale, now) : undefined;
  const distance = distanceM != null ? formatDistance(distanceM, locale, miles) : undefined;
  const detail = 'venue' in game ? game : null;
  const venue =
    venueName ?? detail?.venue?.name ?? (game.hideExactLocation ? t('games:card.areaOnly') : t('games:card.pinnedSpot'));
  const hostProfile = host ?? detail?.host ?? null;
  const spotsLeft = Math.max(0, game.capacity - game.approvedCount);
  const deposit = game.depositMinor > 0 ? formatMoney(game.depositMinor, game.currency, locale) : undefined;

  const status: GameCardStatus | undefined =
    statusOverride ??
    (live
      ? { label: t('map:card.live'), tone: 'live' }
      : full
        ? { label: game.waitlistCount ? t('map:card.badge.waitlist') : t('map:card.badge.full'), icon: 'LockSimple' }
        : soon
          ? { label: t('map:card.startsSoon'), icon: 'ClockCountdown' }
          : undefined);

  const tags: { label: string; icon?: IconName }[] = [];
  if (game.womenOnly) tags.push({ label: t('map:card.badge.womenOnly'), icon: 'GenderFemale' });
  if (game.visibility === 'private') tags.push({ label: t('map:card.badge.private'), icon: 'LockSimple' });

  const players = t('games:details.facts.players', { joined: game.approvedCount, capacity: game.capacity });
  const summary = formatList(
    [
      sport,
      game.title,
      t('common:datetime.dayTime', { day, time }),
      players,
      venue,
      distance ? t('map:card.distanceAway', { distance }) : null,
      deposit ? t('games:details.facts.deposit', { amount: deposit }) : null,
      ...tags.map((x) => x.label),
      status?.label ?? null,
    ].filter((x): x is string => !!x),
    locale,
  );

  return (
    <View
      testID={testID}
      style={selected ? { borderRadius: radius.lg + 4, borderWidth: 2, borderColor: colors.primary, padding: 2, margin: -4 } : undefined}
    >
      <GameHeroCard
        sport={game.sport}
        sportLabel={sport}
        title={game.title}
        venue={venue}
        timeLabel={time}
        dayLabel={day}
        relativeLabel={relative}
        distanceLabel={distance}
        filled={game.approvedCount}
        capacity={game.capacity}
        playersLabel={t('common:players.spotsLeft', { count: spotsLeft })}
        people={hostProfile ? [{ name: hostProfile.displayName, uri: hostProfile.avatarUrl }] : undefined}
        peopleLabel={players}
        depositLabel={deposit}
        status={status}
        tags={tags}
        hostReliability={
          hostProfile
            ? {
                status: hostProfile.reliabilityStatus,
                label: t(`common:reliability.status.${hostProfile.reliabilityStatus}`),
                percent: hostProfile.reliabilityScore !== null ? Math.round(hostProfile.reliabilityScore * 100) : undefined,
              }
            : undefined
        }
        accessibilityLabel={summary}
        onPress={onPress}
      />
    </View>
  );
}
