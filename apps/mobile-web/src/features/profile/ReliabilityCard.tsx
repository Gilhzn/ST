/**
 * Reliability card, the profile's centrepiece (design v2 §4, §15.13): a status-colored ring
 * with the big tabular % (the meter: role=progressbar with aria-valuenow), the status badge
 * (icon + label, never color alone) with a one-line explanation, the 90-day basis, active
 * yellow cards with expiry and an inline "How this works" with every status explained.
 */
import { DEFAULT_TRUST_CONFIG, type ReliabilitySnapshot, type ReliabilityStatus, type Sanction } from '@st/domain';
import { Button, Icon, isolate, ProgressRing, radius, Row, spacing, Stack, StatusBadge, Text, useTheme } from '@st/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { useT } from '@/i18n';
import { formatDate, formatPercent } from '@/lib/format';

const CFG = DEFAULT_TRUST_CONFIG;
const STATUSES: ReliabilityStatus[] = ['green', 'yellow', 'red', 'new'];

/** Yellow cards currently in force, soonest expiry first. */
export function activeYellowCards(sanctions: readonly Sanction[], now: number): Sanction[] {
  return sanctions
    .filter((s) => s.kind === 'yellow_card' && (s.status === 'active' || s.status === 'disputed' || s.status === 'upheld') && s.expiresAt !== null && Date.parse(s.expiresAt) > now)
    .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''));
}

function explain(status: ReliabilityStatus, t: ReturnType<typeof useT>['t'], locale: string): string {
  if (status === 'green') return t('trust:reliability.how.green', { percent: isolate(formatPercent(CFG.reliabilityGreenMin, locale), 'ltr') });
  if (status === 'red') return t('trust:reliability.how.red', { percent: isolate(formatPercent(CFG.reliabilityRedBelow, locale), 'ltr') });
  return t(`trust:reliability.how.${status}`);
}

export function ReliabilityCard({ reliability, sanctions, now }: { reliability: ReliabilitySnapshot; sanctions: readonly Sanction[]; now: number }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const isNew = reliability.status === 'new' || reliability.score === null;
  const cards = activeYellowCards(sanctions, now);
  const firstExpiry = cards[0]?.expiresAt;
  const tone = theme.reliability[reliability.status];
  const score = reliability.score ?? 0;
  const pct = Math.round(score * 100);
  const label = t(`common:reliability.status.${reliability.status}`);
  const percentText = formatPercent(score, locale);

  const ringContent = (
    <View style={{ alignItems: 'center' }}>
      <Text testID={isNew ? undefined : 'profile.reliability.percent'} variant="numeric" allowFontScaling={false} style={{ fontSize: 32, lineHeight: 38 }}>
        {isNew ? '—' : isolate(percentText, 'ltr')}
      </Text>
    </View>
  );

  return (
    <View
      testID="profile.reliability"
      role="group"
      aria-label={t('profile:reliabilityCard.a11y')}
      style={{ padding: spacing.xl, gap: spacing.lg, borderRadius: radius.xl, ...theme.elevation(2) }}
    >
      <Row gap="lg" align="center">
        {isNew ? (
          <ProgressRing progress={0} size={116} thickness={10}>
            {ringContent}
          </ProgressRing>
        ) : (
          <View
            testID="profile.reliability.meter"
            role="progressbar"
            aria-label={t('trust:reliability.meter.a11y', {
              percent: percentText,
              red: formatPercent(CFG.reliabilityRedBelow, locale),
              green: formatPercent(CFG.reliabilityGreenMin, locale),
            })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`${percentText}, ${label}`}
          >
            <ProgressRing progress={score} size={116} thickness={10} color={tone.solid}>
              {ringContent}
            </ProgressRing>
          </View>
        )}
        <Stack gap="sm" style={{ flex: 1 }}>
          <Text variant="overline" color="textTertiary">
            {t('trust:reliability.title')}
          </Text>
          <View testID="profile.reliability.status">
            <StatusBadge status={reliability.status} label={label} />
          </View>
          <Text variant="footnote" color="textSecondary">
            {explain(reliability.status, t, locale)}
          </Text>
        </Stack>
      </Row>

      {isNew ? (
        <Text variant="callout" color="textSecondary" testID="profile.reliability.new">
          {t('trust:reliability.newPlayer', { games: CFG.reliabilityMinGames })}
        </Text>
      ) : (
        <Text variant="callout" color="textSecondary">
          {t('trust:reliability.basedOn', {
            days: CFG.reliabilityWindowDays,
            games: Math.round(reliability.commitmentCount),
            checkIns: reliability.verifiedCount,
            lateCancels: reliability.lateCancelCount,
          })}
        </Text>
      )}

      {cards.length > 0 && firstExpiry ? (
        <Row gap="md" testID="profile.reliability.cards" style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: theme.colors.warningSubtle }}>
          <View aria-hidden style={{ width: 22, height: 28, borderRadius: 4, backgroundColor: theme.colors.warning, transform: [{ rotate: '-8deg' }] }} />
          <Text variant="callout" weight="medium" color="warningText" style={{ flex: 1 }}>
            {t('trust:reliability.yellowCards', { count: cards.length, date: formatDate(firstExpiry, locale, { day: 'numeric', month: 'short' }) })}
          </Text>
        </Row>
      ) : null}

      <View style={{ height: 1, backgroundColor: theme.colors.border, marginStart: -spacing.xl, marginEnd: -spacing.xl }} aria-hidden />
      <Button
        testID="profile.reliability.how"
        variant="ghost"
        size="sm"
        icon="Question"
        iconEnd={open ? 'CaretUp' : 'CaretDown'}
        label={t('trust:reliability.howItWorks')}
        aria-expanded={open}
        onPress={() => setOpen((v) => !v)}
        style={{ alignSelf: 'flex-start', marginStart: -spacing.md, marginTop: -spacing.xs, marginBottom: -spacing.xs }}
      />
      {open ? (
        <Stack gap="md" testID="profile.reliability.explain">
          <Text variant="callout" color="textSecondary">
            {t('trust:reliability.how.body', { days: CFG.reliabilityWindowDays, games: CFG.reliabilityMinGames })}
          </Text>
          {STATUSES.map((st) => (
            <Row key={st} gap="md" align="start">
              <View style={{ width: 112 }}>
                <StatusBadge size="sm" status={st} label={t(`common:reliability.status.${st}`)} />
              </View>
              <Text variant="footnote" style={{ flex: 1 }}>
                {explain(st, t, locale)}
              </Text>
            </Row>
          ))}
          <Row gap="xs">
            <Icon name="Info" size={16} color="textTertiary" />
            <Text variant="footnote" color="textTertiary" style={{ flex: 1 }}>
              {t('trust:sanctions.statement.askPerson')}
            </Text>
          </Row>
        </Stack>
      ) : null}
    </View>
  );
}
