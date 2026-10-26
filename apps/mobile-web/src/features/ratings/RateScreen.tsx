/**
 * Post-game peer rating (RATE-001..004): pick up to five co-players who checked in, then score
 * the sport's attributes on 1–5 star scales (any can be skipped). Ratings are private: they only
 * shape the player's own summary and the host's balancing band, never sanctions (RATE-005).
 * When the caller may not rate, every failing gate is explained with a way forward (AC-RATE-002).
 */
import {
  DEFAULT_PHASE15_CONFIG,
  PLAYER_RATING_ATTRIBUTES,
  type ParticipantView,
  type PeerRatingInput,
  type PlayerRatingAttribute,
  type RatingEligibility,
  type RatingIneligibleReason,
  type Stars,
} from '@st/domain';
import { Avatar, BidiText, Button, Card, Haptics, Icon, IconButton, Illustration, isolate, radius, spacing, StatusPill, Text, useTheme, type IconName } from '@st/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { focusVisible } from '@/components/focusVisible';
import { Screen } from '@/components/Screen';
import { StarInput } from '@/components/StarInput';
import { ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatDateTime, formatPercent } from '@/lib/format';

type Scores = Partial<Record<PlayerRatingAttribute, Stars>>;

const GATE_ICON: Record<RatingIneligibleReason, IconName> = {
  not_verified: 'MapPin',
  low_reliability: 'ShieldCheck',
  too_few_games: 'CalendarCheck',
  active_sanction: 'ShieldWarning',
  window_not_open: 'Clock',
  window_closed: 'LockSimple',
};

export function RateScreen({ gameId }: { gameId: string }) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const now = useNow(60_000);
  const game = useAsync(() => port.getGame(gameId), [port, gameId]);
  const eligibility = useAsync(() => port.getRatingEligibility(gameId), [port, gameId]);
  const players = useAsync(() => port.listParticipants(gameId), [port, gameId]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, Scores>>({});
  const submit = useAction((inputs: PeerRatingInput[]) => port.submitPeerRatings(gameId, inputs));

  const g = game.data;
  const e = eligibility.data;
  const back = `/game/${gameId}` as const;
  if ((game.loading && !g) || (eligibility.loading && !e)) {
    return (
      <Screen testID="screen.game.rate" title={t('ratings:rate.title')} backFallback={back}>
        <Skeleton kind="row" rows={4} />
      </Screen>
    );
  }
  if (!g || !e) {
    return (
      <Screen testID="screen.game.rate" title={t('ratings:rate.title')} backFallback={back}>
        <ErrorView error={game.error ?? eligibility.error} onRetry={() => void Promise.all([game.reload(), eligibility.reload()])} />
      </Screen>
    );
  }

  const attributes = PLAYER_RATING_ATTRIBUTES[g.sport] as readonly PlayerRatingAttribute[];
  const byId = new Map((players.data ?? []).map((p) => [p.userId, p]));
  const rateable = e.rateableUserIds.map((id) => byId.get(id)).filter((p): p is ParticipantView => !!p);
  const max = e.remainingRatees;
  const inputs: PeerRatingInput[] = selected
    .map((id) => ({ rateeId: id, scores: Object.fromEntries(Object.entries(scores[id] ?? {}).filter(([, v]) => v != null)) as Scores }))
    .filter((i) => Object.keys(i.scores).length > 0);
  const toggle = (id: string) => {
    Haptics.selection();
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= max ? prev : [...prev, id]));
  };

  if (!e.canRate) {
    return (
      <Screen testID="screen.game.rate" title={t('ratings:rate.title')} backFallback={back} contentStyle={{ gap: spacing.xl }}>
        <BidiText variant="callout" color="textSecondary" numberOfLines={1} style={{ marginTop: -spacing.md }}>
          {g.title}
        </BidiText>
        <Gate eligibility={e} sport={t(`common:sports.${g.sport}`)} now={now} />
      </Screen>
    );
  }

  return (
    <Screen
      testID="screen.game.rate"
      title={t('ratings:rate.title')}
      backFallback={back}
      contentStyle={{ gap: spacing.xl }}
      footer={
        <>
          <InlineError error={submit.error} />
          <Button
            testID="rate.submit"
            size="lg"
            fullWidth
            icon="Check"
            label={inputs.length ? t('ratings:rate.submitCount', { count: inputs.length }) : t('ratings:rate.submit')}
            disabled={inputs.length === 0}
            loading={submit.busy}
            haptic="none"
            onPress={async () => {
              const res = await submit.run(inputs);
              if (res) {
                Haptics.success();
                toast(t('ratings:rate.thanks', { count: res.length }), 'success');
                if (router.canGoBack()) router.back();
                else router.replace(back);
              }
            }}
          />
        </>
      }
    >
      <View style={{ gap: spacing.xs, marginTop: -spacing.md }}>
        <BidiText variant="callout" color="textSecondary" numberOfLines={1}>
          {g.title}
        </BidiText>
        <Text variant="footnote" color="textTertiary">
          {t('ratings:rate.closes', { time: isolate(formatDateTime(e.windowClosesAt, locale), 'ltr') })}
        </Text>
      </View>

      <Card variant="filled" padding="lg">
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Icon name="LockSimple" size={20} weight="duotone" color="textSecondary" />
          <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
            {t('ratings:rate.privacy')}
          </Text>
        </View>
      </Card>

      {rateable.length === 0 ? (
        <Text variant="callout" color="textSecondary" testID="rate.none">
          {t('ratings:rate.nobodyLeft')}
        </Text>
      ) : (
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="title3" role="heading" aria-level={2} style={{ flex: 1 }}>
              {t('ratings:rate.pickTitle')}
            </Text>
            <StatusPill tone={selected.length >= max ? 'brand' : 'neutral'} label={t('ratings:rate.picked', { count: selected.length, max })} />
          </View>
          <View role="group" aria-label={t('ratings:rate.pickTitle')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {rateable.map((p) => (
              <PlayerChip key={p.userId} p={p} selected={selected.includes(p.userId)} disabled={!selected.includes(p.userId) && selected.length >= max} onPress={() => toggle(p.userId)} />
            ))}
          </View>
          {selected.length >= max ? (
            <Text variant="footnote" color="textTertiary">
              {t('ratings:rate.limit', { count: max })}
            </Text>
          ) : null}
        </View>
      )}

      {selected.map((id) => {
        const p = byId.get(id);
        if (!p) return null;
        return (
          <Card key={id} padding="lg" testID={`rate.card.${id}`}>
            <View style={{ gap: spacing.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar name={p.profile.displayName} uri={p.profile.avatarUrl} size="md" decorative />
                <BidiText variant="headline" numberOfLines={1} style={{ flex: 1 }}>
                  {p.profile.displayName}
                </BidiText>
                <IconButton testID={`rate.card.${id}.remove`} icon="X" variant="tonal" size="sm" label={t('ratings:rate.removeA11y', { name: p.profile.displayName })} onPress={() => toggle(id)} />
              </View>
              {attributes.map((a) => (
                <StarInput
                  key={a}
                  testID={`rate.${id}.${a}`}
                  label={t(`ratings:attribute.${a}`)}
                  value={scores[id]?.[a] ?? null}
                  onChange={(v) => setScores((prev) => ({ ...prev, [id]: { ...prev[id], [a]: v ?? undefined } }))}
                  starLabel={(n) => t('ratings:stars.a11y', { count: n })}
                  valueWord={(n) => (n ? t(`ratings:stars.word.${n}`) : t('ratings:stars.skip'))}
                />
              ))}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

function PlayerChip({ p, selected, disabled, onPress }: { p: ParticipantView; selected: boolean; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      testID={`rate.pick.${p.userId}`}
      role="checkbox"
      aria-checked={selected}
      aria-disabled={disabled}
      aria-label={p.profile.displayName}
      disabled={disabled}
      onPress={onPress}
      style={(st) => {
        const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
        return {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          height: 44,
          paddingStart: 4,
          paddingEnd: spacing.md,
          borderRadius: radius.pill,
          backgroundColor: selected ? c.surfaceInverse : pressed ? c.border : c.surfaceSunken,
          opacity: disabled ? 0.45 : 1,
          ...(focusVisible(focused) ? ({ outlineColor: c.focusRing, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 2 } as object) : null),
        };
      }}
    >
      <Avatar name={p.profile.displayName} uri={p.profile.avatarUrl} size="sm" decorative />
      <BidiText variant="label" weight="semibold" color={selected ? 'textInverse' : 'text'} numberOfLines={1} style={{ maxWidth: 140 }}>
        {p.profile.displayName}
      </BidiText>
      {selected ? <Icon name="Check" size={16} weight="bold" color="textInverse" /> : null}
    </Pressable>
  );
}

/** Friendly explanation of every failing gate, each with what to do next. */
function Gate({ eligibility: e, sport, now }: { eligibility: RatingEligibility; sport: string; now: number }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const closed = e.reasons.includes('window_closed');
  const time = isolate(formatDateTime(e.windowClosesAt, locale), 'ltr');
  const text = (r: RatingIneligibleReason) =>
    r === 'too_few_games'
      ? t('ratings:ineligible.too_few_games', { count: Math.max(1, e.requiredGames - e.verifiedGamesInSport), sport, required: e.requiredGames })
      : r === 'low_reliability'
        ? t('ratings:ineligible.low_reliability', { percent: formatPercent(DEFAULT_PHASE15_CONFIG.peerRaterMinReliability, locale) })
        : r === 'window_closed'
          ? t('ratings:ineligible.window_closed', { time, hours: DEFAULT_PHASE15_CONFIG.peerRatingWindowHours })
          : t(`ratings:ineligible.${r}`, { time, hours: DEFAULT_PHASE15_CONFIG.peerRatingWindowHours });
  return (
    <View style={{ gap: spacing.xl }} testID="rate.gate">
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <Illustration name={closed ? 'success' : 'ageGate'} size={140} />
        <Text variant="title2" align="center" role="heading" aria-level={2} testID="rate.gate.title">
          {closed ? t('ratings:gate.closedTitle') : t('ratings:gate.title')}
        </Text>
        <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 360 }}>
          {t('ratings:gate.body')}
        </Text>
      </View>
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', ...theme.elevation(1) }}>
        {e.reasons.map((r, i) => (
          <View
            key={r}
            testID={`rate.gate.${r}`}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, backgroundColor: theme.colors.surface, borderTopWidth: i ? 1 : 0, borderTopColor: theme.colors.border }}
          >
            <View aria-hidden style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.warningSubtle }}>
              <Icon name={GATE_ICON[r]} size={20} weight="duotone" color="warningText" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="headline">{t(`ratings:gateTitle.${r}`)}</Text>
              <Text variant="footnote" color="textSecondary">
                {text(r)}
              </Text>
            </View>
          </View>
        ))}
      </View>
      {now > Date.parse(e.windowClosesAt) ? null : (
        <Text variant="caption" color="textTertiary" align="center">
          {t('ratings:gate.fair')}
        </Text>
      )}
    </View>
  );
}
