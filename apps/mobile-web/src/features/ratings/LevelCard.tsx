/**
 * Skill level per sport (GLK-004/005): the big level ("3.4") inside a confidence ring (RD →
 * confidence), the format family, the weekly history as a sparkline, and an honest caption —
 * "Provisional — play 6 more rated games", "Improve reliability to 70% to earn rating", or the
 * evidence behind a shown level. Optional private peer summary (RATE-004) as attribute meters.
 */
import { DEFAULT_PHASE15_CONFIG, isFrozen, type PeerSkillSummary, type RatingUpdate, type SkillRating } from '@st/domain';
import { Card, Icon, isolate, ProgressRing, radius, spacing, SportGlyphBadge, StatusPill, Text, useTheme } from '@st/ui';
import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { Sparkline } from '@/components/Sparkline';
import { useT } from '@/i18n';
import { formatNumber, formatPercent } from '@/lib/format';

const CFG = DEFAULT_PHASE15_CONFIG;

/** RD 350 (new) … 50 (very sure) → 0 … 1. */
export function confidenceOf(rd: number): number {
  return Math.max(0, Math.min(1, (CFG.glickoInitialRd - rd) / (CFG.glickoInitialRd - 50)));
}

export type LevelState = { kind: 'shown' } | { kind: 'frozen' } | { kind: 'games'; more: number } | { kind: 'reliability' } | { kind: 'settling' };

/** Why a level is (not) shown, in the order a player can act on it (GLK-004). */
export function levelState(rating: Pick<SkillRating, 'games' | 'rd' | 'provisional'>, reliability: number | null): LevelState {
  if (isFrozen(reliability)) return { kind: 'frozen' };
  if (!rating.provisional) return { kind: 'shown' };
  if (rating.games < CFG.glickoDisplayMinGames) return { kind: 'games', more: CFG.glickoDisplayMinGames - rating.games };
  if (reliability === null || reliability < CFG.glickoDisplayMinReliability) return { kind: 'reliability' };
  return { kind: 'settling' };
}

const level = (r: number) => Math.round(Math.min(7, Math.max(0, (r - 900) / 200)) * 10) / 10;

export function LevelCard({
  rating,
  history,
  reliability,
  peers,
}: {
  rating: SkillRating;
  history: readonly RatingUpdate[];
  reliability: number | null;
  peers?: PeerSkillSummary | null;
}) {
  const { t, locale } = useT();
  const theme = useTheme();
  const c = theme.colors;
  const [width, setWidth] = useState(0);
  const state = levelState(rating, reliability);
  const muted = state.kind !== 'shown';
  const conf = confidenceOf(rating.rd);
  const sportName = t(`common:sports.${rating.sport}`);
  const value = formatNumber(rating.level, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const series = [...history.map((u) => level(u.before.r)).slice(0, 1), ...history.map((u) => level(u.after.r))];
  const change = series.length > 1 ? Math.round(((series[series.length - 1] as number) - (series[0] as number)) * 10) / 10 : 0;
  const caption =
    state.kind === 'frozen'
      ? t('ratings:level.frozen', { percent: formatPercent(CFG.glickoFreezeBelowReliability, locale) })
      : state.kind === 'games'
        ? t('ratings:level.provisionalGames', { count: state.more })
        : state.kind === 'reliability'
          ? t('ratings:level.provisionalReliability', { percent: formatPercent(CFG.glickoDisplayMinReliability, locale) })
          : state.kind === 'settling'
            ? t('ratings:level.provisionalSettling')
            : t('ratings:level.basedOn', { count: rating.games });
  const a11y = [sportName, t(`ratings:family.${rating.formatFamily}`), muted ? t('ratings:level.provisional') : t('ratings:level.a11y', { level: value }), caption].join('. ');
  const ringColor = state.kind === 'frozen' ? c.textTertiary : muted ? c.borderStrong : theme.sport(rating.sport).color;

  return (
    <Card padding="lg" testID={`profile.level.${rating.sport}`}>
      <View style={{ gap: spacing.lg }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <SportGlyphBadge sport={rating.sport} size={36} squircle />
          <View style={{ flex: 1, gap: 0 }}>
            <Text variant="headline" numberOfLines={1}>
              {sportName}
            </Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {t(`ratings:family.${rating.formatFamily}`)}
            </Text>
          </View>
          {state.kind === 'frozen' ? (
            <StatusPill tone="warning" icon="LockSimple" label={t('ratings:level.frozenPill')} />
          ) : muted ? (
            <StatusPill tone="neutral" icon="Hourglass" label={t('ratings:level.provisional')} />
          ) : change !== 0 ? (
            <StatusPill tone={change > 0 ? 'success' : 'neutral'} icon="ChartLineUp" label={isolate(`${change > 0 ? '+' : '−'}${formatNumber(Math.abs(change), locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`, 'ltr')} />
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }} role="img" aria-label={a11y}>
          <ProgressRing progress={conf} size={96} thickness={8} color={ringColor} animated={false}>
            <Text
              testID={`profile.level.${rating.sport}.value`}
              variant="statLarge"
              allowFontScaling={false}
              style={{ fontSize: 34, lineHeight: 40, opacity: muted ? 0.45 : 1 }}
            >
              {isolate(value, 'ltr')}
            </Text>
          </ProgressRing>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text variant="overline" color="textTertiary">
              {t('ratings:level.label')}
            </Text>
            <Text variant="callout" weight={muted ? 'semibold' : 'regular'} color={state.kind === 'frozen' ? 'warningText' : muted ? 'text' : 'textSecondary'} testID={`profile.level.${rating.sport}.caption`}>
              {caption}
            </Text>
            <Text variant="caption" color="textTertiary">
              {t('ratings:level.confidence', { percent: formatPercent(conf, locale) })}
            </Text>
          </View>
        </View>

        {series.length > 1 && width > 0 ? (
          <View style={{ gap: spacing.xs }}>
            <Sparkline
              testID={`profile.level.${rating.sport}.history`}
              values={series}
              width={width}
              height={52}
              color={muted ? c.textTertiary : theme.sport(rating.sport).color}
              label={t('ratings:level.historyA11y', { from: formatNumber(series[0] as number, locale), to: formatNumber(series[series.length - 1] as number, locale), weeks: series.length - 1 })}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" color="textTertiary">
                {t('ratings:level.weeksAgo', { count: series.length - 1 })}
              </Text>
              <Text variant="caption" color="textTertiary">
                {t('ratings:level.now')}
              </Text>
            </View>
          </View>
        ) : null}

        {peers ? <PeerBars summary={peers} /> : null}
      </View>
    </Card>
  );
}

function PeerBars({ summary }: { summary: PeerSkillSummary }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const attrs = Object.entries(summary.attributes).filter(([k, v]) => k !== 'overall' && v && v.ratingsUsed > 0);
  if (!attrs.length) return null;
  return (
    <View style={{ gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.border }} testID="profile.level.peers">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Icon name="LockSimple" size={14} weight="fill" color="textTertiary" />
        <Text variant="caption" weight="semibold" color="textSecondary" style={{ flex: 1 }}>
          {t('ratings:peers.title', { count: summary.raterCount })}
        </Text>
      </View>
      {attrs.map(([k, v]) => {
        const mean = v?.mean ?? 0;
        return (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text variant="footnote" color="textSecondary" style={{ width: 110 }} numberOfLines={1}>
              {t(`ratings:attribute.${k}`)}
            </Text>
            <View aria-hidden style={{ flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden', flexDirection: 'row' }}>
              <View style={{ width: `${Math.round((mean / 5) * 100)}%`, backgroundColor: theme.colors.primary, borderRadius: radius.pill }} />
            </View>
            <Text variant="footnote" weight="semibold" style={{ width: 28, fontVariant: ['tabular-nums'] }} align="center">
              {isolate(formatNumber(mean, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), 'ltr')}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
