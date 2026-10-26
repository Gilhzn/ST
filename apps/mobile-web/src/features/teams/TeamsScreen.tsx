/**
 * Teams (design §13.9): the host balances checked-in players with the domain
 * squad algorithm (scarce positions first, snake draft, annealing; seeded so a
 * reshuffle is a new seed), moves players with buttons (no drag-only), and locks
 * the teams. Team identity is a light/dark bib pattern plus a name, never color
 * alone. Ratings are visible to the host only.
 */
import { balanceTeams, seedFromString, toSquadPlayer, type ParticipantView, type PositionId, type UserId } from '@st/domain';
import { BidiText, Button, EmptyState, isolate, radius, Row, spacing, Stack, Text, useTheme } from '@st/ui';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useGame } from '@/features/game/useGame';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useT } from '@/i18n';
import { formatList, formatNumber } from '@/lib/format';

const LETTERS = 'ABCDEFGHIJKLMNOP';

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
  const { bp } = useBreakpoint();
  const { game, participants, refresh } = useGame(gameId);
  const [seed, setSeed] = useState<number | null>(null);
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

  if (game.loading && !g) {
    return (
      <Screen testID="screen.game.teams" title={t('games:teams.title')}>
        <Skeleton rows={2} height={160} />
      </Screen>
    );
  }
  if (!g) {
    return (
      <Screen testID="screen.game.teams" title={t('games:teams.title')}>
        <ErrorView error={game.error} onRetry={() => void game.reload()} />
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
  const sums = columns.map((c) => c.reduce((a, m) => a + m.rating, 0) / Math.max(1, c.length));
  const diff = sums.length > 1 ? Math.max(...sums) - Math.min(...sums) : 0;
  const coverage = formatList(
    columns.map((c, i) => {
      const roles = c.map((m) => (m.role ? t(`common:positionsShort.${m.role}`) : null)).filter((x): x is string => !!x);
      return t('games:teams.coverageTeam', { team: teamName(i), roles: roles.length ? formatList(roles, locale) : '—' });
    }),
    locale,
  );

  const move = (userId: UserId) => {
    setAssign((prev) => {
      const next = { ...prev, [userId]: ((prev[userId] ?? 0) + 1) % teamCount };
      AccessibilityInfo.announceForAccessibility?.(t('games:teams.moveTo', { team: teamName(next[userId] ?? 0) }));
      return next;
    });
  };

  const empty = pool.length < 2;
  const noneSaved = !hostView && columns.every((c) => c.length === 0);

  return (
    <Screen testID="screen.game.teams" title={t('games:teams.title')} backFallback={`/game/${gameId}`}>
      <BidiText variant="callout" color="textSecondary">
        {g.title}
      </BidiText>
      {empty ? (
        <View testID="teams.empty">
          <EmptyState title={t('games:teams.empty')} />
        </View>
      ) : noneSaved ? (
        <View testID="teams.notLocked">
          <EmptyState title={t('games:teams.notLocked')} />
        </View>
      ) : (
        <Stack gap="lg">
          {hostView ? (
            <Stack gap="xxs" testID="teams.balance" accessibilityLiveRegion="polite">
              <Text variant="bodyStrong">{t('games:teams.balance', { diff: isolate(formatNumber(diff, locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }), 'ltr') })}</Text>
              <Text variant="caption" color="textSecondary">
                {t('games:teams.coverage', { summary: coverage })}
              </Text>
            </Stack>
          ) : null}
          <View style={{ flexDirection: bp === 'compact' ? 'column' : 'row', gap: spacing.md }}>
            {columns.map((members, i) => (
              <View
                key={i}
                testID={`teams.team.${i}`}
                accessibilityLabel={teamName(i)}
                style={{ flex: bp === 'compact' ? undefined : 1, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}
              >
                <Bib index={i} label={teamName(i)} count={members.length} />
                <Stack gap="xs" padding="md">
                  {members.map((m) => {
                    const p = byId.get(m.userId);
                    const name = p?.profile.displayName ?? '—';
                    const next = teamName((i + 1) % teamCount);
                    return (
                      <Pressable
                        key={m.userId}
                        testID={`teams.player.${m.userId}`}
                        disabled={!hostView || teamCount < 2}
                        accessibilityRole={hostView ? 'button' : 'text'}
                        accessibilityLabel={hostView ? `${name}. ${t('games:teams.moveTo', { team: next })}` : name}
                        onPress={() => move(m.userId)}
                        style={({ pressed }) => ({
                          minHeight: 48,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: spacing.sm,
                          paddingStart: spacing.md,
                          paddingEnd: spacing.md,
                          borderRadius: radius.pill,
                          backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.background,
                        })}
                      >
                        {m.role ? (
                          <View style={{ minWidth: 36, paddingStart: 4, paddingEnd: 4, borderRadius: radius.xs, backgroundColor: theme.colors.primarySubtle, alignItems: 'center' }}>
                            <Text variant="caption" color="onPrimarySubtle">
                              {t(`common:positionsShort.${m.role}`)}
                            </Text>
                          </View>
                        ) : null}
                        <BidiText variant="callout" numberOfLines={1} style={{ flex: 1 }}>
                          {name}
                        </BidiText>
                        {hostView ? (
                          <Text variant="caption" color="textTertiary" style={{ fontVariant: ['tabular-nums'] }}>
                            {isolate(formatNumber(m.rating, locale, { maximumFractionDigits: 1 }), 'ltr')}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </Stack>
              </View>
            ))}
          </View>
          <InlineError error={save.error} />
          {hostView ? (
            <Row gap="sm" wrap>
              <Button
                testID="teams.reshuffle"
                variant="secondary"
                label={t('games:teams.reshuffle')}
                onPress={() => {
                  setSeed((s) => ((s ?? 1) * 1103515245 + 12345) >>> 0);
                  setPendingBalance(true);
                  AccessibilityInfo.announceForAccessibility?.(t('games:teams.reshuffled'));
                }}
              />
              <Button
                testID="teams.lock"
                label={t('games:teams.lock')}
                loading={save.busy}
                onPress={async () => {
                  const res = await save.run(assign);
                  if (res) {
                    toast(t('games:teams.locked'));
                    void refresh();
                  }
                }}
              />
            </Row>
          ) : null}
        </Stack>
      )}
    </Screen>
  );
}

/** Team header: solid "dark bib" for odd teams, striped "light bib" for even ones, plus the name. */
function Bib({ index, label, count }: { index: number; label: string; count: number }) {
  const { colors } = useTheme();
  const dark = index % 2 === 1;
  return (
    <View style={{ minHeight: 44, justifyContent: 'center', paddingStart: spacing.md, paddingEnd: spacing.md, backgroundColor: dark ? colors.surfaceInverse : colors.surfaceSunken, overflow: 'hidden' }}>
      {!dark ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, flexDirection: 'row', gap: 10 }}>
          {Array.from({ length: 40 }, (_, k) => (
            <View key={k} style={{ width: 4, backgroundColor: colors.border }} />
          ))}
        </View>
      ) : null}
      <Text variant="title3" color={dark ? 'textInverse' : 'text'} accessibilityRole="header">
        {label}
        <Text variant="caption" color={dark ? 'textInverse' : 'textSecondary'}>
          {`  ${isolate(String(count), 'ltr')}`}
        </Text>
      </Text>
    </View>
  );
}
