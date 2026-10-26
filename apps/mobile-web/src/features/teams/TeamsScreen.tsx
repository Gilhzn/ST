/**
 * Teams (design v2 §15.6): the host balances checked-in players with the domain squad
 * algorithm (scarce positions first, snake draft, annealing; seeded so a reshuffle is a new
 * seed), moves players with a tap (no drag-only), and locks the teams.
 * - Team cards: gradient header (sport colors for the first team, night for the second) with
 *   a letter badge; odd teams add a striped "bib" so identity never relies on color alone.
 * - Players: avatar, name, position badge and (host only) rating.
 * - Balance card: a ring (balance score) plus a split meter of the team averages.
 * - Reshuffle animates the cards in (skipped with reduced motion).
 */
import { balanceTeams, seedFromString, toSquadPlayer, type ParticipantView, type PositionId, type SportId, type UserId } from '@st/domain';
import {
  Avatar,
  BidiText,
  Button,
  EmptyState,
  Gradient,
  Haptics,
  Icon,
  isolate,
  ProgressRing,
  radius,
  Row,
  Skeleton,
  spacing,
  Stack,
  Text,
  useTheme,
  type GradientName,
} from '@st/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { Screen } from '@/components/Screen';
import { ErrorView, InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useGame } from '@/features/game/useGame';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useT } from '@/i18n';
import { formatList, formatNumber, formatPercent } from '@/lib/format';

const LETTERS = 'ABCDEFGHIJKLMNOP';
/** Ratings run 1–5; a 2-point gap between averages reads as fully unbalanced. */
const MAX_DIFF = 2;

interface Member {
  userId: UserId;
  rating: number;
  role: PositionId | null;
}

export function TeamsScreen({ gameId }: { gameId: string }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const port = useData();
  const toast = useToast();
  const { width } = useBreakpoint();
  const { game, participants, refresh } = useGame(gameId);
  const [seed, setSeed] = useState<number | null>(null);
  const [shuffles, setShuffles] = useState(0);
  const [assign, setAssign] = useState<Record<UserId, number>>({});
  const save = useAction(async (a: Record<UserId, number>) => port.saveTeams(gameId, a));

  const g = game.data;
  const pool = useMemo(
    () => (participants.data ?? []).filter((p) => p.status === 'approved' && p.attendance === 'verified'),
    [participants.data],
  );
  const poolKey = pool.map((p) => p.userId).join(',');

  // Ratings come from each player's self-assessed sport profile (Glicko later).
  const sports = useAsync(
    async () => {
      if (!g) return new Map<UserId, Member>();
      const entries = await Promise.all(
        pool.map(async (p) => {
          const list = await port.listUserSports(p.userId).catch(() => []);
          const us = list.find((s) => s.sport === g.sport) ?? null;
          return [p.userId, toSquadPlayer(p.userId, us)] as const;
        }),
      );
      return new Map(entries.map(([id, sp]) => [id, { userId: id, rating: sp.rating, role: (sp.positions[0] as PositionId | undefined) ?? null }]));
    },
    [port, g?.id, poolKey],
    !!g,
  );

  const teamCount = Math.max(1, g?.teamCount ?? 2);
  const balanced = useMemo(() => {
    if (!g || seed === null || !sports.data || pool.length < 2) return null;
    const players = pool.map((p) => {
      const us = sports.data?.get(p.userId);
      return { userId: p.userId, rating: us?.rating ?? 3, positions: p.position ? [p.position] : us?.role ? [us.role] : [] };
    });
    return balanceTeams(players, { teams: teamCount, sport: g.sport, seed });
  }, [g, seed, sports.data, pool, teamCount]);

  // Start from saved teams if the host locked them before; otherwise balance with the game's seed.
  const [pendingBalance, setPendingBalance] = useState(true);
  useEffect(() => {
    if (!g || seed !== null || !participants.data) return;
    const saved = pool.filter((p) => p.team !== null);
    if (saved.length > 0 && saved.length === pool.length) {
      setAssign(Object.fromEntries(saved.map((p) => [p.userId, p.team as number])));
      setPendingBalance(false);
    }
    setSeed(seedFromString(g.id));
  }, [g, seed, participants.data, pool]);

  useEffect(() => {
    if (!balanced || !pendingBalance) return;
    const next: Record<UserId, number> = {};
    balanced.teams.forEach((team, i) => team.forEach((m) => (next[m.userId] = i)));
    setAssign(next);
    setPendingBalance(false);
  }, [balanced, pendingBalance]);

  if (!g) {
    return (
      <Screen testID="screen.game.teams" title={t('games:teams.title')} backFallback={`/game/${gameId}`}>
        {game.loading ? <TeamsSkeleton /> : <ErrorView error={game.error} onRetry={() => void game.reload()} />}
      </Screen>
    );
  }

  const teamName = (i: number) => t('games:teams.teamName', { letter: LETTERS[i] ?? String(i + 1) });
  const byId = new Map<UserId, ParticipantView>(pool.map((p) => [p.userId, p]));
  const hostView = g.isHost;
  const columns: Member[][] = Array.from({ length: teamCount }, () => []);
  if (hostView) {
    for (const p of pool) {
      const team = assign[p.userId];
      if (team === undefined) continue;
      const m = sports.data?.get(p.userId);
      columns[Math.min(team, teamCount - 1)]?.push({ userId: p.userId, rating: m?.rating ?? 3, role: p.position ?? m?.role ?? null });
    }
  } else {
    for (const p of pool) if (p.team !== null) columns[Math.min(p.team, teamCount - 1)]?.push({ userId: p.userId, rating: 0, role: p.position });
  }
  const avgs = columns.map((c) => c.reduce((a, m) => a + m.rating, 0) / Math.max(1, c.length));
  const diff = avgs.length > 1 ? Math.max(...avgs) - Math.min(...avgs) : 0;
  const score = Math.max(0, 1 - diff / MAX_DIFF);
  const fmt1 = (n: number) => formatNumber(n, locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const coverage = formatList(
    columns.map((c, i) => {
      const roles = c.map((m) => (m.role ? t(`common:positionsShort.${m.role}`) : null)).filter((x): x is string => !!x);
      return t('games:teams.coverageTeam', { team: teamName(i), roles: roles.length ? formatList(roles, locale) : '—' });
    }),
    locale,
  );

  const move = (userId: UserId) => {
    Haptics.selection();
    setAssign((prev) => {
      const next = { ...prev, [userId]: ((prev[userId] ?? 0) + 1) % teamCount };
      AccessibilityInfo.announceForAccessibility?.(t('games:teams.moveTo', { team: teamName(next[userId] ?? 0) }));
      return next;
    });
  };

  const empty = pool.length < 2;
  const noneSaved = !hostView && columns.every((c) => c.length === 0);
  const sideBySide = teamCount === 2 && width >= 400;

  return (
    <Screen
      testID="screen.game.teams"
      title={t('games:teams.title')}
      backFallback={`/game/${gameId}`}
      footer={
        hostView && !empty ? (
          <Row gap="sm">
            <Button
              testID="teams.reshuffle"
              variant="outline"
              size="lg"
              icon="Shuffle"
              label={t('games:teams.reshuffle')}
              style={{ flex: 1 }}
              onPress={() => {
                Haptics.trigger('chipToggle');
                setSeed((s) => ((s ?? 1) * 1103515245 + 12345) >>> 0);
                setShuffles((n) => n + 1);
                setPendingBalance(true);
                AccessibilityInfo.announceForAccessibility?.(t('games:teams.reshuffled'));
              }}
            />
            <Button
              testID="teams.lock"
              size="lg"
              icon="LockSimple"
              label={t('games:teams.lock')}
              loading={save.busy}
              style={{ flex: 1 }}
              onPress={async () => {
                const res = await save.run(assign);
                if (res) {
                  Haptics.success();
                  toast(t('games:teams.locked'));
                  void refresh();
                }
              }}
            />
          </Row>
        ) : undefined
      }
    >
      <BidiText variant="callout" color="textSecondary" numberOfLines={1} style={{ marginTop: -spacing.md }}>
        {g.title}
      </BidiText>
      {participants.loading && !participants.data ? (
        <TeamsSkeleton />
      ) : empty ? (
        <View testID="teams.empty">
          <EmptyState illustration="emptyGames" title={t('games:teams.empty')} />
        </View>
      ) : noneSaved ? (
        <View testID="teams.notLocked">
          <EmptyState illustration="emptyGames" title={t('games:teams.notLocked')} />
        </View>
      ) : (
        <Stack gap="lg">
          {hostView ? (
            <View testID="teams.balance" aria-live="polite" style={{ padding: spacing.lg, gap: spacing.lg, borderRadius: radius.lg, ...theme.elevation(1) }}>
              <Row gap="lg">
                <ProgressRing
                  progress={score}
                  size={64}
                  thickness={7}
                  color={score >= 0.85 ? 'success' : 'warning'}
                  label={t('games:teams.balanceLabel')}
                  valueText={formatPercent(score, locale)}
                >
                  <Text variant="label" weight="bold" allowFontScaling={false} style={{ fontVariant: ['tabular-nums'] }}>
                    {isolate(formatPercent(score, locale), 'ltr')}
                  </Text>
                </ProgressRing>
                <Stack gap="xxs" style={{ flex: 1 }}>
                  <Text variant="headline">{t('games:teams.balance', { diff: isolate(fmt1(diff), 'ltr') })}</Text>
                  <Text variant="footnote" color="textSecondary">
                    {t('games:teams.coverage', { summary: coverage })}
                  </Text>
                </Stack>
              </Row>
              {teamCount === 2 ? <SplitMeter a={avgs[0] ?? 0} b={avgs[1] ?? 0} labelA={teamName(0)} labelB={teamName(1)} fmt={fmt1} sport={g.sport} /> : null}
            </View>
          ) : null}
          {hostView && teamCount > 1 ? (
            <Row gap="xs">
              <Icon name="Info" size={16} color="textTertiary" />
              <Text variant="footnote" color="textTertiary" style={{ flex: 1 }}>
                {t('games:teams.tapToMove')}
              </Text>
            </Row>
          ) : null}
          <View style={{ flexDirection: sideBySide ? 'row' : 'column', alignItems: sideBySide ? 'flex-start' : 'stretch', gap: spacing.md }}>
            {columns.map((members, i) => (
              <Appear key={`${i}-${shuffles}`} index={i} animate={shuffles > 0} style={{ flex: sideBySide ? 1 : undefined }}>
                <View
                  testID={`teams.team.${i}`}
                  role="group"
                  aria-label={teamName(i)}
                  style={{ borderRadius: radius.lg, overflow: 'hidden', ...theme.elevation(1) }}
                >
                  <TeamHeader index={i} name={teamName(i)} count={members.length} avg={hostView ? fmt1(avgs[i] ?? 0) : null} sport={g.sport} compact={sideBySide} />
                  <View style={{ paddingTop: spacing.xs, paddingBottom: spacing.xs }}>
                    {members.map((m, k) => {
                      const p = byId.get(m.userId);
                      const name = p?.profile.displayName ?? '—';
                      const next = teamName((i + 1) % teamCount);
                      const movable = hostView && teamCount >= 2;
                      return (
                        <Pressable
                          key={m.userId}
                          testID={`teams.player.${m.userId}`}
                          disabled={!movable}
                          role={movable ? 'button' : undefined}
                          aria-label={
                            movable
                              ? `${name}. ${t('games:teams.ratingA11y', { rating: fmt1(m.rating) })}. ${t('games:teams.moveTo', { team: next })}`
                              : name
                          }
                          onPress={() => move(m.userId)}
                          style={({ pressed }) => ({
                            minHeight: 56,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: sideBySide ? spacing.sm : spacing.md,
                            paddingStart: sideBySide ? spacing.md : spacing.lg,
                            paddingEnd: sideBySide ? spacing.sm : spacing.md,
                            backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
                            borderTopWidth: k === 0 ? 0 : 1,
                            borderTopColor: theme.colors.border,
                          })}
                        >
                          <Avatar name={name} uri={p?.profile.avatarUrl} size="sm" decorative />
                          <View style={{ flex: 1, gap: 2 }}>
                            <BidiText variant="callout" weight="medium" numberOfLines={1}>
                              {name}
                            </BidiText>
                            <Row gap="xs">
                              {m.role ? <PositionBadge label={t(`common:positionsShort.${m.role}`)} /> : null}
                              {hostView ? <RatingPill value={fmt1(m.rating)} /> : null}
                            </Row>
                          </View>
                          {movable && !sideBySide ? <Icon name="ArrowsLeftRight" size={18} color="textTertiary" /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </Appear>
            ))}
          </View>
          <InlineError error={save.error} />
        </Stack>
      )}
    </Screen>
  );
}

/** Cards fade and settle in after a reshuffle (staggered); static with reduced motion. */
function Appear({ index, animate, style, children }: { index: number; animate: boolean; style?: object; children: ReactNode }) {
  const theme = useTheme();
  const v = useRef(new Animated.Value(animate && !theme.reducedMotion ? 0 : 1)).current;
  useEffect(() => {
    if (!animate || theme.reducedMotion) return;
    Animated.timing(v, { toValue: 1, duration: 320, delay: index * 70, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: false }).start();
  }, [animate, theme.reducedMotion, v, index]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function teamGradient(index: number, sport: SportId): GradientName {
  if (index === 0) return sport as GradientName;
  return index % 2 === 1 ? 'brandNight' : 'brand';
}

function TeamHeader({ index, name, count, avg, sport, compact }: { index: number; name: string; count: number; avg: string | null; sport: SportId; compact: boolean }) {
  const { t } = useT();
  const striped = index % 2 === 1;
  return (
    <Gradient name={teamGradient(index, sport)} style={{ minHeight: compact ? 84 : 76, paddingStart: spacing.md, paddingEnd: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md, justifyContent: 'center', overflow: 'hidden' }}>
      {striped ? (
        <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}>
          <Svg width="100%" height="100%">
            {Array.from({ length: 30 }, (_, k) => (
              <Line key={k} x1={k * 16 - 60} y1={0} x2={k * 16} y2={120} stroke="#FFFFFF" strokeOpacity={0.07} strokeWidth={6} />
            ))}
          </Svg>
        </View>
      ) : null}
      <Row gap="md" align="center">
        <View aria-hidden style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.18)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)' }}>
          <Text variant="title3" weight="heavy" color="textOnMedia" allowFontScaling={false}>
            {LETTERS[index] ?? String(index + 1)}
          </Text>
        </View>
        <Stack gap="xxs" style={{ flex: 1 }}>
          <Text variant="headline" color="textOnMedia" role="heading" numberOfLines={1}>
            {name}
          </Text>
          <Row gap="sm" wrap>
            <Row gap="xxs">
              <Icon name="Users" size={14} weight="bold" color="#FFFFFF" />
              <Text variant="footnote" weight="semibold" color="textOnMedia" style={{ fontVariant: ['tabular-nums'] }}>
                {isolate(String(count), 'ltr')}
              </Text>
            </Row>
            {avg ? (
              <Text variant="footnote" style={{ color: 'rgba(255, 255, 255, 0.82)' }} numberOfLines={1}>
                {t('games:teams.avg', { rating: isolate(avg, 'ltr') })}
              </Text>
            ) : null}
          </Row>
        </Stack>
      </Row>
    </Gradient>
  );
}

function PositionBadge({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ minWidth: 32, height: 20, paddingStart: 6, paddingEnd: 6, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySubtle }}>
      <Text variant="caption" weight="bold" color="onPrimarySubtle" allowFontScaling={false} style={{ fontSize: 11, lineHeight: 14, letterSpacing: 0.4 }}>
        {label}
      </Text>
    </View>
  );
}

function RatingPill({ value }: { value: string }) {
  const { colors } = useTheme();
  return (
    <View aria-hidden style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 20, paddingStart: 5, paddingEnd: 6, borderRadius: 6, backgroundColor: colors.surfaceSunken }}>
      <Icon name="Star" size={11} weight="fill" color="warning" />
      <Text variant="caption" weight="semibold" color="textSecondary" allowFontScaling={false} style={{ fontSize: 11, lineHeight: 14, fontVariant: ['tabular-nums'] }}>
        {isolate(value, 'ltr')}
      </Text>
    </View>
  );
}

/** Two-team tug meter: each side's width follows its average rating; the centre tick marks parity. */
function SplitMeter({ a, b, labelA, labelB, fmt, sport }: { a: number; b: number; labelA: string; labelB: string; fmt: (n: number) => string; sport: SportId }) {
  const theme = useTheme();
  const share = a + b > 0 ? a / (a + b) : 0.5;
  return (
    <View aria-hidden style={{ gap: spacing.xs }}>
      <Row justify="between">
        {[
          [labelA, a],
          [labelB, b],
        ].map(([label, v]) => (
          <Row key={String(label)} gap="xs">
            <Text variant="caption" color="textSecondary">
              {String(label)}
            </Text>
            <Text variant="caption" weight="bold" style={{ fontVariant: ['tabular-nums'] }}>
              {isolate(fmt(Number(v)), 'ltr')}
            </Text>
          </Row>
        ))}
      </Row>
      <View style={{ height: 10, flexDirection: 'row', gap: 3 }}>
        <View style={{ flex: share, borderRadius: radius.pill, backgroundColor: theme.sport(sport).color }} />
        <View style={{ flex: 1 - share, borderRadius: radius.pill, backgroundColor: theme.colors.surfaceInverse }} />
        <View style={{ position: 'absolute', start: '50%', top: -3, bottom: -3, width: 2, marginStart: -1, backgroundColor: theme.colors.textTertiary, borderRadius: 1 }} />
      </View>
    </View>
  );
}

function TeamsSkeleton() {
  return (
    <Stack gap="md" aria-busy testID="state.loading">
      <Skeleton height={112} radius={radius.lg} />
      <Skeleton height={260} radius={radius.lg} />
      <Skeleton height={260} radius={radius.lg} />
    </Stack>
  );
}
