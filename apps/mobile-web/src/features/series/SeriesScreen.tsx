/**
 * Recurring series (GAME-010/011): a sport-gradient hero (cadence, title, venue), a facts card
 * (regulars, next date, regulars-first window), the viewer's roster state (invite to accept,
 * "I'm always in"), the host's WhatsApp-migration card, the next dates (per-date skip / edit
 * for the host), the regulars and the host tools (edit this or following dates, end series).
 */
import { DEFAULT_PHASE15_CONFIG, zonedTimeToEpoch, type GameDetail, type GameSeries, type RosterMemberView, type SeriesOccurrence } from '@st/domain';
import {
  Avatar,
  AvatarStack,
  BidiText,
  borderWidth,
  Button,
  Card,
  Gradient,
  Haptics,
  Icon,
  IconButton,
  isolate,
  ListGroup,
  ListItem,
  ProgressRing,
  radius,
  Segmented,
  spacing,
  SportGlyphBadge,
  showFocusRing,
  sportColors,
  StatusPill,
  Text,
  TextField,
  useTheme,
  type IconName,
} from '@st/ui';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RangeSlider } from '@/components/RangeSlider';
import { BackButton, MediaIconButton, Screen } from '@/components/Screen';
import { SelectField } from '@/components/SelectField';
import { Banner, ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { compactMinutes } from '@/features/game/DetailsParts';
import { SheetModal } from '@/features/kit/SheetModal';
import { SwitchRow } from '@/features/settings/SwitchRow';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatNumber, formatRelative } from '@/lib/format';

import { cadenceLabel, dayLabel, localTimeLabel, monthDay, shortDayTime, timeIn } from './format';
import { DateTile } from './SeriesParts';

const LATE_HOURS = 24;

export function SeriesScreen({ seriesId }: { seriesId: string }) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const now = useNow(60_000);
  const theme = useTheme();
  const detail = useAsync(() => port.getSeries(seriesId), [port, seriesId]);
  const d = detail.data;
  const isMember = !!d && (d.isHost || d.myRoster?.status === 'regular');
  const roster = useAsync(() => port.listRoster(seriesId), [port, seriesId], isMember);
  const stats = useAsync(() => port.getMigrationStats({ kind: 'series', seriesId }), [port, seriesId], !!d?.isHost);
  const upcomingIds = (d?.upcoming ?? []).map((o) => o.gameId).join(',');
  const games = useAsync(
    async () => {
      const list = await Promise.all((d?.upcoming ?? []).map((o) => port.getGame(o.gameId).catch(() => null)));
      return new Map(list.filter((g): g is GameDetail => !!g).map((g) => [g.id, g]));
    },
    [port, upcomingIds],
    !!d,
  );

  const [skip, setSkip] = useState<SeriesOccurrence | null>(null);
  const [edit, setEdit] = useState<{ occurrence: SeriesOccurrence; scope: 'this' | 'following' } | null>(null);
  const [ending, setEnding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [removing, setRemoving] = useState<RosterMemberView | null>(null);

  const reloadAll = async () => {
    await Promise.all([detail.reload(), roster.reload(), stats.reload()]);
  };
  const accept = useAction(() => port.acceptRosterInvite(seriesId));
  const alwaysIn = useAction((v: boolean) => port.setAlwaysIn(seriesId, v));
  const skipAction = useAction((key: string) => port.skipOccurrence(seriesId, key));
  const endAction = useAction(() => port.endSeries(seriesId));
  const leaveAction = useAction(() => port.leaveRoster(seriesId));
  const removeAction = useAction((userId: string) => port.removeFromRoster(seriesId, userId));

  if (detail.loading && !d) {
    return (
      <Screen testID="screen.series" backFallback="/games">
        <Skeleton kind="hero" />
      </Screen>
    );
  }
  if (!d) {
    return (
      <Screen testID="screen.series" backFallback="/games">
        {detail.error ? <ErrorView error={detail.error} onRetry={() => void detail.reload()} /> : <Banner testID="series.notFound" tone="warning" text={t('errors:not_found')} />}
      </Screen>
    );
  }

  const s = d.series;
  const ended = s.status === 'ended';
  const next = d.upcoming.find((o) => o.status === 'scheduled' && Date.parse(o.startsAt) > now) ?? null;
  const nextGame = next ? games.data?.get(next.gameId) : undefined;
  const inPriority = !!next && Date.parse(next.priorityUntil) > now;
  const regulars = (roster.data ?? []).filter((m) => m.status === 'regular');
  const actionError = accept.error ?? alwaysIn.error ?? skipAction.error ?? endAction.error ?? leaveAction.error ?? removeAction.error;
  const venueLine = d.series.hideExactLocation && !s.location ? t('games:card.areaOnly') : null;

  const onAccept = async () => {
    const res = await accept.run();
    if (res) {
      Haptics.success();
      toast(t('series:member.welcome'), 'success');
      await reloadAll();
    }
  };

  return (
    <Screen
      testID="screen.series"
      backFallback="/games"
      hero={<SeriesHero series={s} hostName={d.host.displayName} venueLine={venueLine} onInvite={d.isHost && !ended ? () => router.push(`/series/${s.id}/invite`) : undefined} />}
      contentStyle={{ gap: spacing.xl, marginTop: -(spacing.xxl + spacing.xs) }}
      footer={
        d.myRoster?.status === 'invited' && !ended ? (
          <>
            <InlineError error={accept.error} />
            <Button testID="series.accept" size="lg" fullWidth icon="UserPlus" haptic="joinGame" label={t('series:member.accept')} loading={accept.busy} onPress={() => void onAccept()} />
          </>
        ) : d.isHost && !ended ? (
          <Button testID="series.invite" size="lg" fullWidth icon="WhatsappLogo" label={t('series:host.inviteGroup')} onPress={() => router.push(`/series/${s.id}/invite`)} />
        ) : undefined
      }
    >
      <SeriesFacts series={s} rosterCount={d.rosterCount} next={next} nextGame={nextGame ?? null} now={now} people={regulars} />

      {ended ? <Banner testID="series.ended" tone="warning" icon="StopCircle" text={t('series:ended')} /> : null}
      <InlineError error={d.myRoster?.status === 'invited' ? null : actionError} />

      {d.myRoster?.status === 'invited' && !ended ? (
        <Card padding="lg" testID="series.invited">
          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
            <Avatar name={d.host.displayName} uri={d.host.avatarUrl} size="md" decorative />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="headline">{t('series:member.invitedTitle', { name: isolate(d.host.displayName) })}</Text>
              <Text variant="footnote" color="textSecondary">
                {t('series:member.invitedBody', { hours: s.rosterPriorityHours })}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {next && inPriority && !ended ? (
        <Banner
          testID="series.priority"
          tone="brand"
          icon="Hourglass"
          title={t('series:priority.title')}
          text={
            d.isHost
              ? t('series:priority.bannerHost', { time: isolate(shortDayTime(next.priorityUntil, locale), 'ltr') })
              : d.myRoster?.status === 'regular'
                ? t('series:priority.bannerRegular', { time: isolate(shortDayTime(next.priorityUntil, locale), 'ltr') })
                : t('series:priority.banner', { time: isolate(shortDayTime(next.priorityUntil, locale), 'ltr') })
          }
        />
      ) : null}

      {d.myRoster?.status === 'regular' && !ended ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title={t('series:member.title')} />
          <View style={{ borderRadius: radius.lg, overflow: 'hidden', ...theme.elevation(1) }}>
            <SwitchRow
              testID="series.alwaysIn"
              icon="Lightning"
              label={t('series:member.alwaysIn')}
              help={t('series:member.alwaysInHelp', { hours: s.autoJoinReconfirmHours })}
              value={d.myRoster.alwaysIn}
              disabled={alwaysIn.busy}
              onChange={async (v) => {
                const res = await alwaysIn.run(v);
                if (res) {
                  toast(v ? t('series:member.alwaysInOn') : t('series:member.alwaysInOff'), 'success');
                  detail.setData((prev) => (prev ? { ...prev, myRoster: res } : null));
                }
              }}
            />
          </View>
        </View>
      ) : null}

      {d.isHost ? <MigrationCard stats={stats.data ?? null} loading={stats.loading && !stats.data} rosterCount={d.rosterCount} /> : null}

      <View style={{ gap: spacing.sm }} testID="series.dates">
        <SectionHeader title={t('series:dates.title')} />
        {d.upcoming.length === 0 ? (
          <Text variant="callout" color="textSecondary" testID="series.dates.empty">
            {ended ? t('series:dates.none') : t('series:dates.empty', { weeks: s.horizonWeeks })}
          </Text>
        ) : (
          <ListGroup>
            {d.upcoming.map((o, i) => (
              <OccurrenceRow
                key={o.occurrenceKey}
                index={i}
                series={s}
                occurrence={o}
                game={games.data?.get(o.gameId) ?? null}
                now={now}
                isHost={d.isHost}
                onOpen={() => router.push(`/game/${o.gameId}`)}
                onSkip={() => setSkip(o)}
                onEdit={() => setEdit({ occurrence: o, scope: 'this' })}
              />
            ))}
          </ListGroup>
        )}
        {!ended ? (
          <Text variant="caption" color="textTertiary" style={{ paddingStart: spacing.lg }}>
            {t('series:dates.horizon', { weeks: s.horizonWeeks })}
          </Text>
        ) : null}
      </View>

      {isMember ? (
        <RosterSection
          members={roster.data ?? null}
          isHost={d.isHost}
          onRemove={(m) => setRemoving(m)}
        />
      ) : (
        <Card variant="filled" padding="lg" testID="series.notMember">
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Icon name="UsersThree" size={22} weight="duotone" color="textSecondary" />
            <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
              {t('series:member.askHost', { name: isolate(d.host.displayName), count: d.rosterCount })}
            </Text>
          </View>
        </Card>
      )}

      {d.isHost && !ended ? (
        <View style={{ gap: spacing.sm }} testID="series.host">
          <SectionHeader title={t('series:host.title')} />
          <ListGroup>
            <ListItem
              testID="series.host.edit"
              icon="PencilSimple"
              iconTone="brand"
              title={t('series:host.edit')}
              subtitle={t('series:host.editHelp')}
              chevron
              disabled={!next}
              onPress={() => next && setEdit({ occurrence: next, scope: 'following' })}
            />
            <ListItem
              testID="series.host.end"
              icon="StopCircle"
              destructive
              title={t('series:host.end')}
              subtitle={t('series:host.endHelp')}
              onPress={() => setEnding(true)}
            />
          </ListGroup>
        </View>
      ) : null}

      {d.myRoster?.status === 'regular' && !ended ? (
        <Button testID="series.leave" variant="ghost" icon="SignOut" fullWidth label={t('series:member.leave')} onPress={() => setLeaving(true)} />
      ) : null}

      <ConfirmDialog
        testID="series.skipDialog"
        visible={!!skip}
        icon="SkipForward"
        title={skip ? t('series:skip.title', { date: dayLabel(skip.startsAt, locale) }) : ''}
        body={
          skip
            ? Date.parse(skip.startsAt) - now < LATE_HOURS * 3_600_000 && (games.data?.get(skip.gameId)?.approvedCount ?? 1) > 1
              ? `${t('series:skip.body')} ${t('series:skip.late', { hours: LATE_HOURS })}`
              : t('series:skip.body')
            : undefined
        }
        confirmLabel={t('series:skip.confirm')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        busy={skipAction.busy}
        onConfirm={async () => {
          if (!skip) return;
          const res = await skipAction.run(skip.occurrenceKey);
          setSkip(null);
          if (res) {
            toast(t('series:skip.done'), 'success');
            await reloadAll();
          }
        }}
        onCancel={() => setSkip(null)}
      />
      <ConfirmDialog
        testID="series.endDialog"
        visible={ending}
        icon="StopCircle"
        title={t('series:end.title')}
        body={t('series:end.body')}
        confirmLabel={t('series:end.confirm')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        busy={endAction.busy}
        onConfirm={async () => {
          const res = await endAction.run();
          setEnding(false);
          if (res) {
            toast(t('series:end.done'));
            await reloadAll();
          }
        }}
        onCancel={() => setEnding(false)}
      />
      <ConfirmDialog
        testID="series.leaveDialog"
        visible={leaving}
        icon="SignOut"
        title={t('series:member.leaveTitle')}
        body={t('series:member.leaveBody')}
        confirmLabel={t('series:member.leaveConfirm')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        busy={leaveAction.busy}
        onConfirm={async () => {
          const res = await leaveAction.run();
          setLeaving(false);
          if (res) {
            toast(t('series:member.left'));
            await reloadAll();
          }
        }}
        onCancel={() => setLeaving(false)}
      />
      <ConfirmDialog
        testID="series.removeDialog"
        visible={!!removing}
        icon="UserMinus"
        title={removing ? t('series:roster.removeTitle', { name: isolate(removing.profile.displayName) }) : ''}
        body={t('series:roster.removeBody')}
        confirmLabel={t('series:roster.remove')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        busy={removeAction.busy}
        onConfirm={async () => {
          if (!removing) return;
          const res = await removeAction.run(removing.userId);
          setRemoving(null);
          if (res) await reloadAll();
        }}
        onCancel={() => setRemoving(null)}
      />
      {edit ? (
        <EditSheet
          series={s}
          occurrence={edit.occurrence}
          initialScope={edit.scope}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            setEdit(null);
            toast(t('series:edit.saved'), 'success');
            await reloadAll();
          }}
        />
      ) : null}
    </Screen>
  );
}

/* ------------------------------------------------------------------ hero */

function SeriesHero({ series, hostName, venueLine, onInvite }: { series: GameSeries; hostName: string; venueLine: string | null; onInvite?: () => void }) {
  const { t, locale } = useT();
  const insets = useSafeAreaInsets();
  return (
    <Gradient
      name={series.sport}
      style={{ paddingTop: insets.top + spacing.sm, paddingBottom: spacing.xxl + spacing.lg, borderBottomStartRadius: radius.xl, borderBottomEndRadius: radius.xl, overflow: 'hidden' }}
    >
      <View aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end', opacity: 0.14 }}>
        <View style={{ marginEnd: -36, marginBottom: -48 }}>
          <Icon name={sportColors[series.sport].phosphor} size={200} weight="fill" color="#FFFFFF" directional={false} />
        </View>
      </View>
      <View style={{ width: '100%', maxWidth: 760, alignSelf: 'center', paddingStart: spacing.md, paddingEnd: spacing.md, gap: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <BackButton fallback="/games" onMedia />
          <View style={{ flex: 1 }} />
          {onInvite ? <MediaIconButton testID="series.share" icon="ShareNetwork" label={t('series:host.inviteGroup')} onPress={onInvite} /> : null}
        </View>
        <View style={{ paddingStart: spacing.sm, paddingEnd: spacing.sm, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <SportGlyphBadge sport={series.sport} size={32} variant="glass" squircle />
            <Text variant="overline" color="textOnMedia" style={{ opacity: 0.9, flexShrink: 1 }} numberOfLines={1}>
              {t(`common:sports.${series.sport}`)}
            </Text>
            <StatusPill tone="glass" icon="Repeat" label={t(`series:recurrence.${series.recurrence}`)} />
          </View>
          <BidiText variant="title1" color="textOnMedia" role="heading" aria-level={1} numberOfLines={3} testID="series.title">
            {series.title}
          </BidiText>
          <View style={{ gap: 2 }}>
            <Text variant="title3" color="textOnMedia" testID="series.cadence">
              {cadenceLabel(series, t, locale)}
            </Text>
            <Text variant="footnote" weight="medium" color="textOnMedia" style={{ opacity: 0.85 }} numberOfLines={1}>
              {venueLine ?? t('series:hostedBy', { name: isolate(hostName) })}
            </Text>
          </View>
        </View>
      </View>
    </Gradient>
  );
}

/* ------------------------------------------------------------------ facts */

function SeriesFacts({
  series,
  rosterCount,
  next,
  nextGame,
  now,
  people,
}: {
  series: GameSeries;
  rosterCount: number;
  next: SeriesOccurrence | null;
  nextGame: GameDetail | null;
  now: number;
  people: RosterMemberView[];
}) {
  const { t, locale } = useT();
  const theme = useTheme();
  const c = theme.colors;
  const divider = <View aria-hidden style={{ width: 1, alignSelf: 'stretch', marginTop: spacing.sm, marginBottom: spacing.sm, backgroundColor: c.border }} />;
  const ratio = nextGame ? nextGame.approvedCount / Math.max(1, nextGame.capacity) : 0;
  return (
    <Card elevation={2} padding="md" testID="series.facts">
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        <Fact label={t('series:facts.regulars')} value={isolate(formatNumber(rosterCount, locale), 'ltr')}>
          {people.length ? (
            <AvatarStack people={people.map((p) => ({ name: p.profile.displayName, uri: p.profile.avatarUrl }))} max={3} size="xs" label={t('series:regularsCount', { count: rosterCount })} ringColor={c.surface} />
          ) : (
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceSunken }}>
              <Icon name="UsersThree" size={20} weight="duotone" color="textSecondary" />
            </View>
          )}
        </Fact>
        {divider}
        <Fact
          label={next ? dayLabel(next.startsAt, locale) : t('series:facts.next')}
          value={next ? formatRelative(next.startsAt, locale, now) || timeIn(next.startsAt, locale) : '—'}
        >
          <ProgressRing progress={ratio} size={40} thickness={4} color={ratio >= 0.75 ? sportColors[series.sport].gradient[0] : 'primary'} animated={false}>
            <Icon name="CalendarCheck" size={16} weight="fill" color="primary" />
          </ProgressRing>
        </Fact>
        {divider}
        <Fact label={t('series:facts.regularsFirst')} value={compactMinutes(series.rosterPriorityHours * 60, locale)}>
          <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySubtle }}>
            <Icon name="Hourglass" size={20} weight="duotone" color="onPrimarySubtle" />
          </View>
        </Fact>
      </View>
    </Card>
  );
}

function Fact({ children, label, value }: { children?: ReactNode; label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: spacing.xs, paddingTop: spacing.xs, paddingBottom: spacing.xs }}>
      <View style={{ height: 40, justifyContent: 'center' }}>{children}</View>
      <Text variant="statSmall" numberOfLines={1} align="center">
        {value}
      </Text>
      <Text variant="caption" color="textSecondary" numberOfLines={1} align="center">
        {label}
      </Text>
    </View>
  );
}

function SectionHeader({ title, count, end }: { title: string; count?: string; end?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingStart: spacing.lg, minHeight: 24 }}>
      <Text variant="overline" color="textTertiary" role="heading" aria-level={2}>
        {title}
      </Text>
      {count ? (
        <Text variant="overline" color="textTertiary">
          {count}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      {end}
    </View>
  );
}

/* ------------------------------------------------------------------ migration */

function MigrationCard({
  stats,
  loading,
  rosterCount,
}: {
  stats: { joinedFromLink: number; activeFromLink: number; lastJoinAt: string | null } | null;
  loading: boolean;
  rosterCount: number;
}) {
  const { t, locale } = useT();
  const theme = useTheme();
  if (loading) return <Skeleton height={150} />;
  if (!stats) return null;
  const joined = stats.joinedFromLink;
  const active = stats.activeFromLink;
  return (
    <View testID="series.migration" style={{ borderRadius: radius.lg, overflow: 'hidden', ...theme.elevation(1) }}>
      <Gradient name="brandNight" style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View aria-hidden style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#25D366' }}>
            <Icon name="WhatsappLogo" size={20} weight="fill" color="#FFFFFF" />
          </View>
          <Text variant="overline" color="textOnMedia" style={{ opacity: 0.85, flex: 1 }} numberOfLines={1}>
            {t('series:migration.title')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="statLarge" color="textOnMedia" testID="series.migration.joined">
              {isolate(formatNumber(joined, locale), 'ltr')}
            </Text>
            <Text variant="callout" weight="medium" color="textOnMedia" testID="series.migration.text">
              {joined > 0 ? t('series:migration.joinedLabel', { count: joined }) : t('series:migration.none')}
            </Text>
          </View>
          <ProgressRing
            progress={joined ? active / joined : 0}
            size={76}
            thickness={8}
            color="accent"
            trackColor="rgba(255,255,255,0.14)"
            label={t('series:migration.active', { count: active })}
            valueText={t('series:migration.active', { count: active })}
          >
            <Text variant="headline" color="textOnMedia" style={{ fontVariant: ['tabular-nums'] }}>
              {isolate(`${active}/${joined}`, 'ltr')}
            </Text>
          </ProgressRing>
        </View>
        <Text variant="footnote" color="textOnMedia" style={{ opacity: 0.8 }}>
          {t('series:migration.active', { count: active })} · {t('series:regularsCount', { count: rosterCount })}
        </Text>
      </Gradient>
    </View>
  );
}

/* ------------------------------------------------------------------ dates */

function OccurrenceRow({
  index,
  series,
  occurrence: o,
  game,
  now,
  isHost,
  onOpen,
  onSkip,
  onEdit,
}: {
  index: number;
  series: GameSeries;
  occurrence: SeriesOccurrence;
  game: GameDetail | null;
  now: number;
  isHost: boolean;
  onOpen: () => void;
  onSkip: () => void;
  onEdit: () => void;
}) {
  const { t, locale } = useT();
  const theme = useTheme();
  const skipped = o.status === 'skipped';
  const priority = !skipped && Date.parse(o.priorityUntil) > now;
  const mine = game?.myParticipation?.status === 'approved' && !isHost;
  const title = `${dayLabel(o.startsAt, locale)} · ${timeIn(o.startsAt, locale)}`;
  const time = `${monthDay(o.startsAt, locale)} · ${timeIn(o.startsAt, locale)}`;
  const subtitle = skipped
    ? t('series:dates.skipped')
    : game
      ? t('games:details.facts.players', { joined: game.approvedCount, capacity: game.capacity })
      : t('series:dates.capacity', { capacity: series.capacity });
  const badge: { label: string; tone: 'brand' | 'success' | 'neutral'; icon: IconName } | null = skipped
    ? { label: t('series:dates.skippedBadge'), tone: 'neutral', icon: 'SkipForward' }
    : mine
      ? { label: t('series:dates.youreIn'), tone: 'success', icon: 'CheckCircle' }
      : priority
        ? { label: t('series:dates.regularsOnly'), tone: 'brand', icon: 'Hourglass' }
        : null;
  return (
    <View testID={`series.occurrence.${index}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Pressable
        testID={`series.occurrence.${index}.open`}
        role="button"
        aria-label={`${title}, ${subtitle}${badge ? `, ${badge.label}` : ''}`}
        aria-disabled={skipped}
        disabled={skipped}
        onPress={onOpen}
        style={{ flex: 1 }}
      >
        {(st) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingStart: spacing.lg,
              paddingEnd: isHost ? spacing.sm : spacing.md,
              paddingTop: spacing.md,
              paddingBottom: spacing.md,
              backgroundColor: st.pressed ? theme.colors.surfaceSunken : 'transparent',
              opacity: skipped ? 0.6 : 1,
              ...(showFocusRing((st as { focused?: boolean }).focused)
                ? { outlineColor: theme.colors.focusRing, outlineWidth: borderWidth.focus, outlineStyle: 'solid', outlineOffset: -3 }
                : null),
            }}
          >
            <DateTile iso={o.startsAt} sport={series.sport} muted={skipped} />
            <View style={{ flex: 1, gap: 2, alignItems: 'flex-start' }}>
              <Text variant="headline" numberOfLines={1} style={skipped ? { textDecorationLine: 'line-through' } : undefined}>
                {time}
              </Text>
              <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                {subtitle}
              </Text>
              {badge ? (
                <View style={{ marginTop: spacing.xs }}>
                  <StatusPill label={badge.label} tone={badge.tone} icon={badge.icon} />
                </View>
              ) : null}
            </View>
            {!skipped && !isHost ? <Icon name="CaretRight" size={18} weight="bold" color="textTertiary" /> : null}
          </View>
        )}
      </Pressable>
      {isHost && !skipped ? (
        <View style={{ flexDirection: 'row', gap: spacing.xs, paddingEnd: spacing.md }}>
          <IconButton testID={`series.occurrence.${index}.edit`} icon="PencilSimple" variant="tonal" size="sm" label={t('series:dates.editA11y', { date: title })} onPress={onEdit} />
          <IconButton testID={`series.occurrence.${index}.skip`} icon="SkipForward" variant="tonal" size="sm" label={t('series:dates.skipA11y', { date: title })} onPress={onSkip} />
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ roster */

function RosterSection({ members, isHost, onRemove }: { members: RosterMemberView[] | null; isHost: boolean; onRemove: (m: RosterMemberView) => void }) {
  const { t, locale } = useT();
  const theme = useTheme();
  if (!members) return <Skeleton kind="row" rows={3} />;
  const regulars = members.filter((m) => m.status === 'regular');
  const invited = members.filter((m) => m.status === 'invited');
  const always = regulars.filter((m) => m.alwaysIn).length;
  const row = (m: RosterMemberView) => {
    const parts = [
      m.joinedVia === 'invite_link' ? t('series:roster.viaLink') : m.joinedVia === 'played_with' ? t('series:roster.viaPlayedWith') : t('series:roster.viaHost'),
      t('series:roster.since', { date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(m.joinedAt)) }),
    ];
    return (
      <View
        key={m.userId}
        testID={`series.roster.${m.userId}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingStart: spacing.lg, paddingEnd: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.sm }}
      >
        <Avatar name={m.profile.displayName} uri={m.profile.avatarUrl} size="md" decorative />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
            <BidiText variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>
              {m.profile.displayName}
            </BidiText>
            {m.status === 'invited' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingStart: 6, paddingEnd: 8, paddingTop: 2, paddingBottom: 2, borderRadius: radius.pill, backgroundColor: theme.colors.surfaceSunken }}>
                <Icon name="Hourglass" size={12} weight="bold" color="textSecondary" />
                <Text variant="caption" weight="semibold" color="textSecondary">
                  {t('series:roster.invited')}
                </Text>
              </View>
            ) : null}
            {m.alwaysIn ? (
              <View
                testID={`series.roster.${m.userId}.alwaysIn`}
                role="img"
                aria-label={t('series:roster.alwaysIn')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingStart: 6, paddingEnd: 8, paddingTop: 2, paddingBottom: 2, borderRadius: radius.pill, backgroundColor: theme.colors.primarySubtle }}
              >
                <Icon name="Lightning" size={12} weight="fill" color="onPrimarySubtle" />
                <Text variant="caption" weight="semibold" color="onPrimarySubtle" aria-hidden>
                  {t('series:roster.alwaysIn')}
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="footnote" color="textSecondary" numberOfLines={1}>
            {parts.join(' · ')}
          </Text>
        </View>
        {isHost ? (
          <IconButton testID={`series.roster.${m.userId}.remove`} icon="UserMinus" variant="plain" size="sm" color="textTertiary" label={t('series:roster.removeA11y', { name: m.profile.displayName })} onPress={() => onRemove(m)} />
        ) : null}
      </View>
    );
  };
  return (
    <View style={{ gap: spacing.sm }} testID="series.roster">
      <SectionHeader title={t('series:roster.title')} count={isolate(String(regulars.length), 'ltr')} end={always ? <Text variant="caption" color="textTertiary">{t('series:roster.alwaysInCount', { count: always })}</Text> : undefined} />
      {regulars.length === 0 ? (
        <Text variant="callout" color="textSecondary" style={{ paddingStart: spacing.lg }}>
          {t('series:roster.empty')}
        </Text>
      ) : (
        <ListGroup>{regulars.map(row)}</ListGroup>
      )}
      {isHost && invited.length ? (
        <ListGroup title={t('series:roster.pending')}>{invited.map(row)}</ListGroup>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ edit */

const TIMES = Array.from({ length: 36 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

function EditSheet({
  series,
  occurrence,
  initialScope,
  onClose,
  onSaved,
}: {
  series: GameSeries;
  occurrence: SeriesOccurrence;
  initialScope: 'this' | 'following';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useT();
  const port = useData();
  const currentTime = timeIn(occurrence.startsAt, 'en-GB', series.timeZone).slice(0, 5);
  const [scope, setScope] = useState<'this' | 'following'>(initialScope);
  const [title, setTitle] = useState(series.title);
  const [capacity, setCapacity] = useState(series.capacity);
  const [time, setTime] = useState(scope === 'this' ? currentTime : series.startTime);
  const [priority, setPriority] = useState(series.rosterPriorityHours);
  const save = useAction(async () => {
    const changed = <T,>(a: T, b: T) => (a !== b ? a : undefined);
    if (scope === 'this') {
      const startsAt = time !== currentTime ? new Date(zonedTimeToEpoch(occurrence.slotDate, time, series.timeZone)).toISOString() : undefined;
      return port.editSeries(series.id, {
        scope: 'this',
        occurrenceKey: occurrence.occurrenceKey,
        patch: { title: changed(title.trim(), series.title), capacity: changed(capacity, series.capacity), startsAt },
      });
    }
    return port.editSeries(series.id, {
      scope: 'following',
      occurrenceKey: occurrence.occurrenceKey,
      patch: {
        title: changed(title.trim(), series.title),
        capacity: changed(capacity, series.capacity),
        startTime: changed(time, series.startTime),
        rosterPriorityHours: changed(priority, series.rosterPriorityHours),
      },
    });
  });
  const options = (TIMES.includes(time) ? TIMES : [time, ...TIMES]).map((v) => ({ value: v, label: localTimeLabel(v, locale) }));
  return (
    <SheetModal
      visible
      testID="series.edit"
      title={t('series:edit.title')}
      onClose={onClose}
      closeLabel={t('common:actions.close')}
      start={<Button variant="ghost" size="sm" label={t('common:actions.cancel')} onPress={onClose} />}
      footer={
        <View style={{ gap: spacing.sm }}>
          <InlineError error={save.error} />
          <Button
            testID="series.edit.save"
            size="lg"
            fullWidth
            icon="Check"
            label={t('series:edit.save')}
            loading={save.busy}
            disabled={!title.trim()}
            onPress={async () => {
              const res = await save.run();
              if (res) onSaved();
            }}
          />
        </View>
      }
    >
      <View style={{ gap: spacing.sm }}>
        <Segmented
          testID="series.edit.scope"
          label={t('series:edit.scope')}
          value={scope}
          onChange={(v) => {
            setScope(v);
            setTime(v === 'this' ? currentTime : series.startTime);
          }}
          options={[
            { value: 'this', label: t('series:edit.scopeThis'), testID: 'series.edit.scope.this' },
            { value: 'following', label: t('series:edit.scopeFollowing'), testID: 'series.edit.scope.following' },
          ]}
        />
        <Text variant="footnote" color="textSecondary">
          {scope === 'this' ? t('series:edit.scopeThisHelp', { date: dayLabel(occurrence.startsAt, locale, series.timeZone) }) : t('series:edit.scopeFollowingHelp', { date: dayLabel(occurrence.startsAt, locale, series.timeZone) })}
        </Text>
      </View>
      <TextField testID="series.edit.title" label={t('series:edit.name')} value={title} maxLength={80} onChangeText={setTitle} icon="PencilSimple" />
      <SelectField testID="series.edit.time" icon="Clock" label={t('series:edit.time')} placeholder={t('series:edit.time')} value={time} options={options} onChange={setTime} />
      <Card padding="lg">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">{t('games:wizard.who.capacity')}</Text>
            <Text variant="footnote" color="textSecondary">
              {t('series:edit.capacityHelp')}
            </Text>
          </View>
          <IconButton testID="series.edit.capacity.dec" icon="Minus" weight="bold" variant="tonal" label={t('games:wizard.who.fewer')} disabled={capacity <= 2} onPress={() => setCapacity((n) => Math.max(2, n - 1))} />
          <Text variant="numeric" style={{ minWidth: 44 }} align="center" aria-live="polite" testID="series.edit.capacity.value">
            {isolate(String(capacity), 'ltr')}
          </Text>
          <IconButton testID="series.edit.capacity.inc" icon="Plus" weight="bold" variant="tonal" label={t('games:wizard.who.more')} disabled={capacity >= 50} onPress={() => setCapacity((n) => Math.min(50, n + 1))} />
        </View>
      </Card>
      {scope === 'following' ? (
        <PriorityWindowCard value={priority} onChange={setPriority} testID="series.edit.priority" />
      ) : null}
    </SheetModal>
  );
}

/** "Regulars get first pick for 24 h" card with the 6–72 h slider (create wizard and series edit). */
export function PriorityWindowCard({ value, onChange, testID }: { value: number; onChange: (v: number) => void; testID?: string }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const cfg = DEFAULT_PHASE15_CONFIG;
  const label = compactMinutes(value * 60, locale);
  return (
    <Card padding="lg">
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View aria-hidden style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primarySubtle }}>
            <Icon name="Hourglass" size={22} weight="duotone" color="onPrimarySubtle" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">{t('series:priority.windowTitle')}</Text>
            <Text variant="footnote" color="textSecondary">
              {t('series:priority.windowHelp')}
            </Text>
          </View>
          <Text variant="statSmall" color="primaryText" testID={testID ? `${testID}.value` : undefined}>
            {isolate(label, 'ltr')}
          </Text>
        </View>
        <RangeSlider
          testID={testID}
          value={value}
          min={cfg.rosterPriorityHoursMin}
          max={cfg.rosterPriorityHoursMax}
          step={6}
          onChange={onChange}
          label={t('series:priority.windowTitle')}
          valueText={(v) => compactMinutes(v * 60, locale)}
          decLabel={t('series:priority.shorter')}
          incLabel={t('series:priority.longer')}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingStart: 52, paddingEnd: 52 }}>
          <Text variant="caption" color="textTertiary">
            {isolate(compactMinutes(cfg.rosterPriorityHoursMin * 60, locale), 'ltr')}
          </Text>
          <Text variant="caption" color="textTertiary">
            {isolate(compactMinutes(cfg.rosterPriorityHoursMax * 60, locale), 'ltr')}
          </Text>
        </View>
      </View>
    </Card>
  );
}
