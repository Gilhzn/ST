/**
 * Building blocks of the game details screen (design v2 §15.4): the sport-gradient hero, the
 * overlapping facts strip, venue / host cards and the participant sections.
 */
import type { GameDetail, ParticipantView, Stars } from '@st/domain';
import {
  AvatarStack,
  BidiText,
  Card,
  Gradient,
  Haptics,
  Icon,
  IconButton,
  isolate,
  ListGroup,
  ProgressRing,
  radius,
  spacing,
  SportGlyphBadge,
  sportColors,
  StatusBadge,
  StatusPill,
  Text,
  useTheme,
  type IconName,
  type PillTone,
} from '@st/ui';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { capitalize } from '@/components/GameCard';
import { MiniMap } from '@/components/MiniMap';
import { ParticipantRow } from '@/components/ParticipantRow';
import { ReliabilityAvatar } from '@/components/ReliabilityBadge';
import { BackButton, MediaIconButton } from '@/components/Screen';
import { BandMeter } from '@/features/ratings/BandMeter';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useT } from '@/i18n';
import { formatDay, formatRelative, formatTime } from '@/lib/format';

/* ------------------------------------------------------------------ hero */

export function GameHero({
  game,
  now,
  live,
  status,
  onShare,
}: {
  game: GameDetail;
  now: number;
  live: boolean;
  status?: { label: string; tone?: PillTone; icon?: IconName } | null;
  onShare?: () => void;
}) {
  const { t, locale } = useT();
  const insets = useSafeAreaInsets();
  const { width } = useBreakpoint();
  const sport = t(`common:sports.${game.sport}`);
  const startMs = Date.parse(game.startsAt);
  const day = capitalize(formatDay(game.startsAt, locale, now), locale);
  const relative = live ? t('map:card.live') : startMs > now ? formatRelative(game.startsAt, locale, now) : null;
  const end = formatTime(game.endsAt, locale);
  return (
    <Gradient
      name={game.sport}
      style={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: spacing.xxl + spacing.lg,
        borderBottomStartRadius: radius.xl,
        borderBottomEndRadius: radius.xl,
        overflow: 'hidden',
      }}
    >
      {/* Watermark at the bottom-end corner via flex (absolute `end` compiles to `right` on web). */}
      <View aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end', opacity: 0.14 }}>
        <View style={{ marginEnd: -36, marginBottom: -48 }}>
          <Icon name={sportColors[game.sport].phosphor} size={Math.min(220, Math.max(180, width * 0.5))} weight="fill" color="#FFFFFF" directional={false} />
        </View>
      </View>
      <View style={{ width: '100%', maxWidth: 760, alignSelf: 'center', paddingStart: spacing.md, paddingEnd: spacing.md, gap: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <BackButton fallback="/map" onMedia />
          <View style={{ flex: 1 }} />
          {onShare ? <MediaIconButton testID="game.share" icon="ShareNetwork" label={t('common:actions.share')} onPress={onShare} /> : null}
        </View>
        <View style={{ paddingStart: spacing.sm, paddingEnd: spacing.sm, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <SportGlyphBadge sport={game.sport} size={32} variant="glass" squircle />
            <Text variant="overline" color="textOnMedia" style={{ opacity: 0.9, flexShrink: 1 }} numberOfLines={1}>
              {sport}
            </Text>
            {status ? <StatusPill label={status.label} tone={status.tone ?? 'glass'} icon={status.icon} /> : null}
          </View>
          <BidiText variant="title1" color="textOnMedia" role="heading" aria-level={1} numberOfLines={3} testID="game.title">
            {game.title}
          </BidiText>
          <View testID="game.time" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, flexWrap: 'wrap' }}>
            <Text variant="display" color="textOnMedia" style={{ fontVariant: ['tabular-nums'], fontSize: 44, lineHeight: 48, letterSpacing: -1.2 }}>
              {isolate(formatTime(game.startsAt, locale), 'ltr')}
            </Text>
            <View style={{ paddingBottom: 4, gap: 0 }}>
              <Text variant="headline" color="textOnMedia">
                {day}
              </Text>
              <Text variant="footnote" weight="medium" color="textOnMedia" style={{ opacity: 0.85 }}>
                {relative ? `${relative} · ` : ''}
                {t('games:details.until', { time: isolate(end, 'ltr') })}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Gradient>
  );
}

/* ------------------------------------------------------------------ facts strip */

/** Compact unit duration for stat values: "12 min", "2 hr", "1.5 hr" (Intl unit, short). */
export function compactMinutes(minutes: number, locale: string): string {
  const unit = (value: number, u: 'minute' | 'hour' | 'day') => {
    try {
      return new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'short', maximumFractionDigits: 1 }).format(value);
    } catch {
      return String(value);
    }
  };
  if (minutes < 60 || (minutes < 180 && minutes % 60 !== 0)) return unit(Math.max(1, Math.round(minutes)), 'minute');
  if (minutes < 48 * 60) return unit(Math.round((minutes / 60) * 2) / 2, 'hour');
  return unit(Math.round(minutes / 1440), 'day');
}

function Fact({ children, label, value }: { children?: ReactNode; label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: spacing.xs, paddingTop: spacing.xs, paddingBottom: spacing.xs }}>
      {children}
      <Text variant="statSmall" numberOfLines={1} align="center">
        {value}
      </Text>
      <Text variant="caption" color="textSecondary" numberOfLines={1} align="center">
        {label}
      </Text>
    </View>
  );
}

export function FactsStrip({ game, now, live, depositAmount }: { game: GameDetail; now: number; live: boolean; depositAmount: string | null }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const c = theme.colors;
  const ratio = game.capacity > 0 ? game.approvedCount / game.capacity : 0;
  const full = game.approvedCount >= game.capacity;
  const ringColor = full ? c.textTertiary : ratio >= 0.75 ? sportColors[game.sport].gradient[0] : c.primary;
  const startMs = Date.parse(game.startsAt);
  const minutes = Math.round((Date.parse(game.endsAt) - startMs) / 60_000);
  const startsValue = live
    ? t('games:details.facts.liveNow')
    : startMs > now
      ? compactMinutes((startMs - now) / 60_000, locale)
      : t('games:details.facts.over');
  const startsLabel = !live && startMs > now ? t('games:details.facts.startsIn') : t('games:details.facts.starts');
  const divider = <View aria-hidden style={{ width: 1, alignSelf: 'stretch', marginTop: spacing.sm, marginBottom: spacing.sm, backgroundColor: c.border }} />;
  return (
    <Card elevation={2} padding="md" style={{ gap: spacing.md }}>
      <View testID="game.facts" style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
          <Fact label={t('games:details.facts.playersLabel')} value={isolate(`${game.approvedCount}/${game.capacity}`, 'ltr')}>
            <ProgressRing
              progress={ratio}
              size={40}
              thickness={4}
              color={ringColor}
              label={t('games:details.facts.players', { joined: game.approvedCount, capacity: game.capacity })}
              valueText={t('games:details.facts.players', { joined: game.approvedCount, capacity: game.capacity })}
            >
              <Icon name={full ? 'LockSimple' : 'Users'} size={16} weight="fill" color={full ? 'textTertiary' : 'primary'} />
            </ProgressRing>
          </Fact>
          {divider}
          <Fact label={startsLabel} value={startsValue}>
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: live ? c.accent : c.surfaceSunken }}>
              <Icon name={live ? 'Broadcast' : 'ClockCountdown'} size={20} weight={live ? 'bold' : 'duotone'} color={live ? 'onAccent' : 'textSecondary'} />
            </View>
          </Fact>
          {divider}
          <Fact label={t('games:details.facts.duration')} value={compactMinutes(minutes, locale)}>
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceSunken }}>
              <Icon name="Timer" size={20} weight="duotone" color="textSecondary" />
            </View>
          </Fact>
        </View>
        {depositAmount || game.womenOnly || game.visibility === 'private' || game.waitlistCount ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2, justifyContent: 'center', paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.border }}>
            {depositAmount ? <StatusPill tone="warning" icon="Coins" size="md" label={t('games:details.facts.deposit', { amount: depositAmount })} /> : null}
            {game.waitlistCount ? <StatusPill tone="info" icon="Hourglass" size="md" label={t('games:details.facts.waitlist', { count: game.waitlistCount })} /> : null}
            {game.womenOnly ? <StatusPill icon="GenderFemale" size="md" label={t('games:details.facts.womenOnly')} /> : null}
            {game.visibility === 'private' ? <StatusPill icon="LockSimple" size="md" label={t('games:details.facts.private')} /> : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ venue */

export function VenueCardRow({ game, onDirections }: { game: GameDetail; onDirections?: () => void }) {
  const { t } = useT();
  const hidden = !game.location;
  return (
    <Card padding="md">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <MiniMap sport={game.sport} hidden={hidden} />
        <View style={{ flex: 1, gap: 2 }}>
          {game.venue ? (
            <>
              <BidiText variant="headline" numberOfLines={2}>
                {game.venue.name}
              </BidiText>
              {game.venue.address ? (
                <BidiText variant="footnote" color="textSecondary" numberOfLines={2}>
                  {game.venue.address}
                </BidiText>
              ) : null}
            </>
          ) : (
            <Text variant="headline">{t('games:card.pinnedSpot')}</Text>
          )}
          {hidden ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: 2 }}>
              <Icon name="LockSimple" size={14} weight="fill" color="textTertiary" />
              <Text variant="footnote" color="textSecondary" style={{ flex: 1 }} testID="game.location.hidden">
                {t('games:details.hiddenLocation')}
              </Text>
            </View>
          ) : null}
        </View>
        {onDirections && !hidden ? (
          <IconButton testID="game.venue.directions" icon="NavigationArrow" variant="tonal" label={t('games:details.action.directions')} onPress={onDirections} />
        ) : null}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ host */

export function HostCard({ game }: { game: GameDetail }) {
  const { t, locale } = useT();
  const h = game.host;
  const label = t(`common:reliability.status.${h.reliabilityStatus}`);
  const percent = h.reliabilityScore !== null && h.reliabilityStatus !== 'new' ? Math.round(h.reliabilityScore * 100) : undefined;
  const since = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(new Date(h.memberSince));
  return (
    <View testID="game.host">
      <Card padding="lg">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <ReliabilityAvatar name={h.displayName} uri={h.avatarUrl} status={h.reliabilityStatus} score={h.reliabilityScore} size="lg" />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text variant="footnote" color="textSecondary">
              {t('games:details.host.title')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <BidiText variant="title3" numberOfLines={1} style={{ flexShrink: 1 }} aria-label={t('games:details.host.hostedBy', { name: isolate(h.displayName) })}>
                {h.displayName}
              </BidiText>
              {h.verifiedHost ? <Icon name="SealCheck" size={20} weight="fill" color="info" label={t('games:details.host.verified')} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
              <StatusBadge size="sm" status={h.reliabilityStatus} label={label} percent={percent} />
              <Text variant="caption" color="textTertiary">
                {t('games:details.host.since', { date: since })}
              </Text>
            </View>
          </View>
        </View>
      </Card>
    </View>
  );
}

/* ------------------------------------------------------------------ participants */

export function SectionTitle({ title, count, end }: { title: string; count?: string; end?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 }}>
      <Text variant="title3" role="heading" aria-level={2}>
        {title}
      </Text>
      {count ? (
        <Text variant="statSmall" color="textTertiary">
          {count}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      {end}
    </View>
  );
}

/** Players: title + count + AvatarStack header that expands to the full list. */
export function PlayersSection({
  game,
  players,
  hint,
  bands,
}: {
  game: GameDetail;
  players: ParticipantView[];
  hint?: string | null;
  /** Host only: 1–5 skill bands for balancing (never shown to players). */
  bands?: Readonly<Record<string, Stars>> | null;
}) {
  const { t } = useT();
  const theme = useTheme();
  const [open, setOpen] = useState(players.length <= 3);
  const names = players.map((p) => p.profile.displayName);
  if (!players.length) {
    return hint ? (
      <Text variant="footnote" color="textTertiary">
        {hint}
      </Text>
    ) : null;
  }
  return (
    <View style={{ gap: spacing.md }} testID="game.players">
      <Pressable
        testID="game.players.toggle"
        role="button"
        aria-expanded={open}
        aria-label={Platform.OS === 'web' ? undefined : t('games:details.players.toggle', { count: players.length })}
        onPress={() => {
          Haptics.selection();
          setOpen((o) => !o);
        }}
        style={({ pressed }) => ({ borderRadius: radius.lg, opacity: pressed ? 0.8 : 1 })}
      >
        <View>
        <SectionTitle
          title={t('games:details.sections.players')}
          count={isolate(`${game.approvedCount}/${game.capacity}`, 'ltr')}
          end={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <AvatarStack
                people={players.map((p) => ({ name: p.profile.displayName, uri: p.profile.avatarUrl }))}
                max={4}
                size="sm"
                label={names.join(', ')}
                ringColor={theme.colors.background}
              />
              <Icon name={open ? 'CaretUp' : 'CaretDown'} size={18} weight="bold" color="textTertiary" />
            </View>
          }
        />
        </View>
      </Pressable>
      {open ? (
        <ListGroup>
          {players.map((p) => (
            <ParticipantRow
              key={p.userId}
              p={p}
              isHost={p.userId === game.hostId}
              trailing={bands?.[p.userId] ? <BandMeter band={bands[p.userId] as Stars} testID={`game.band.${p.userId}`} /> : undefined}
            />
          ))}
        </ListGroup>
      ) : null}
      {hint ? (
        <Text variant="footnote" color="textTertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Host-only: join requests with quick approve / reject actions on every row. */
export function RequestsSection({
  requests,
  busy,
  onDecide,
}: {
  requests: ParticipantView[];
  busy: boolean;
  onDecide: (userId: string, decision: 'approve' | 'reject') => void;
}) {
  const { t } = useT();
  if (!requests.length) return null;
  return (
    <View style={{ gap: spacing.md }} testID="game.requests">
      <SectionTitle title={t('games:details.sections.requests')} count={isolate(String(requests.length), 'ltr')} />
      <ListGroup>
        {requests.map((p) => (
          <ParticipantRow
            key={p.userId}
            p={p}
            trailing={
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <IconButton
                  testID={`game.host.reject.${p.userId}`}
                  icon="X"
                  weight="bold"
                  variant="tonal"
                  color="dangerText"
                  label={t('games:details.host.rejectA11y', { name: p.profile.displayName })}
                  disabled={busy}
                  onPress={() => onDecide(p.userId, 'reject')}
                />
                <IconButton
                  testID={`game.host.approve.${p.userId}`}
                  icon="Check"
                  weight="bold"
                  variant="filled"
                  label={t('games:details.host.approveA11y', { name: p.profile.displayName })}
                  disabled={busy}
                  onPress={() => onDecide(p.userId, 'approve')}
                />
              </View>
            }
          />
        ))}
      </ListGroup>
    </View>
  );
}

export function WaitlistSection({ waitlist }: { waitlist: ParticipantView[] }) {
  const { t } = useT();
  const { colors } = useTheme();
  if (!waitlist.length) return null;
  return (
    <View style={{ gap: spacing.md }} testID="game.waitlist">
      <SectionTitle title={t('games:details.sections.waitlist')} count={isolate(String(waitlist.length), 'ltr')} />
      <ListGroup>
        {waitlist.map((p, i) => (
          <ParticipantRow
            key={p.userId}
            p={p}
            trailing={
              <View style={{ minWidth: 32, height: 28, paddingStart: spacing.sm, paddingEnd: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" weight="semibold" color="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
                  {isolate(`#${p.waitlistRank ?? i + 1}`, 'ltr')}
                </Text>
              </View>
            }
          />
        ))}
      </ListGroup>
    </View>
  );
}
