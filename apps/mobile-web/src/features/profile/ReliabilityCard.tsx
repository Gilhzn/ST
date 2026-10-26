/**
 * Reliability card, the profile's hero (design §13.12): big percentage, status
 * badge (glyph + label), a meter that mirrors with threshold ticks at the red
 * and green limits, the 90-day basis, active yellow cards with expiry and an
 * inline "How this works" explanation.
 */
import { DEFAULT_TRUST_CONFIG, type ReliabilitySnapshot, type Sanction } from '@st/domain';
import { Button, Card, isolate, radius, Row, Stack, Text, useTheme } from '@st/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ReliabilityBadge } from '@/components/ReliabilityBadge';
import { useT } from '@/i18n';
import { formatDate, formatPercent } from '@/lib/format';

const CFG = DEFAULT_TRUST_CONFIG;

/** Yellow cards currently in force, soonest expiry first. */
export function activeYellowCards(sanctions: readonly Sanction[], now: number): Sanction[] {
  return sanctions
    .filter((s) => s.kind === 'yellow_card' && (s.status === 'active' || s.status === 'disputed' || s.status === 'upheld') && s.expiresAt !== null && Date.parse(s.expiresAt) > now)
    .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''));
}

function Meter({ reliability }: { reliability: ReliabilitySnapshot }) {
  const theme = useTheme();
  const { t, locale } = useT();
  const token = theme.reliability[reliability.status];
  const score = reliability.score ?? 0;
  const pct = Math.round(score * 100);
  const red = formatPercent(CFG.reliabilityRedBelow, locale);
  const green = formatPercent(CFG.reliabilityGreenMin, locale);
  return (
    <View
      testID="profile.reliability.meter"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('trust:reliability.meter.a11y', { percent: formatPercent(score, locale), red, green })}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      style={{ gap: 6 }}
    >
      <View style={{ height: 12, borderRadius: radius.pill, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden', flexDirection: 'row' }}>
        <View style={{ width: `${pct}%`, backgroundColor: token.solid, borderRadius: radius.pill }} />
      </View>
      {/* Threshold ticks use logical `start`, so they mirror with the bar. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -3, start: 0, end: 0, height: 18 }}>
        {[CFG.reliabilityRedBelow, CFG.reliabilityGreenMin].map((limit) => (
          <View key={limit} style={{ position: 'absolute', start: `${limit * 100}%`, width: 2, height: 18, backgroundColor: theme.colors.textSecondary }} />
        ))}
      </View>
      <Row justify="between" gap="sm" wrap>
        <Text variant="caption" color="textSecondary">
          {t('trust:reliability.meter.restrictedBelow', { percent: isolate(red, 'ltr') })}
        </Text>
        <Text variant="caption" color="textSecondary">
          {t('trust:reliability.meter.reliableFrom', { percent: isolate(green, 'ltr') })}
        </Text>
      </Row>
    </View>
  );
}

export function ReliabilityCard({ reliability, sanctions, now }: { reliability: ReliabilitySnapshot; sanctions: readonly Sanction[]; now: number }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const isNew = reliability.status === 'new' || reliability.score === null;
  const cards = activeYellowCards(sanctions, now);
  const firstExpiry = cards[0]?.expiresAt;

  return (
    <View testID="profile.reliability">
      <Card accessibilityLabel={t('profile:reliabilityCard.a11y')}>
        <Stack gap="md">
          <Row gap="sm" justify="between" wrap>
            <Text variant="title3">{t('trust:reliability.title')}</Text>
            <ReliabilityBadge status={reliability.status} score={reliability.score} size="md" />
          </Row>
          {isNew ? (
            <Text variant="body" color="textSecondary" testID="profile.reliability.new">
              {t('trust:reliability.newPlayer', { games: CFG.reliabilityMinGames })}
            </Text>
          ) : (
            <>
              <Text variant="display" testID="profile.reliability.percent" style={{ fontVariant: ['tabular-nums'] }}>
                {isolate(formatPercent(reliability.score ?? 0, locale), 'ltr')}
              </Text>
              <Meter reliability={reliability} />
              <Text variant="body" color="textSecondary">
                {t('trust:reliability.basedOn', {
                  days: CFG.reliabilityWindowDays,
                  games: Math.round(reliability.commitmentCount),
                  checkIns: reliability.verifiedCount,
                  lateCancels: reliability.lateCancelCount,
                })}
              </Text>
            </>
          )}
          {cards.length > 0 && firstExpiry ? (
            <Row gap="xs" align="start" testID="profile.reliability.cards">
              <Icon name="alert-outline" size={18} color="warningText" />
              <Text variant="callout" color="warningText" style={{ flex: 1 }}>
                {t('trust:reliability.yellowCards', { count: cards.length, date: formatDate(firstExpiry, locale, { day: 'numeric', month: 'short' }) })}
              </Text>
            </Row>
          ) : null}
          <Button
            testID="profile.reliability.how"
            variant="ghost"
            label={t('trust:reliability.howItWorks')}
            accessibilityState={{ expanded: open }}
            aria-expanded={open}
            endIcon={<Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color="primaryText" />}
            onPress={() => setOpen((v) => !v)}
          />
          {open ? (
            <Stack gap="xs" testID="profile.reliability.explain">
              <Text variant="body" color="textSecondary">
                {t('trust:reliability.how.body', { days: CFG.reliabilityWindowDays, games: CFG.reliabilityMinGames })}
              </Text>
              <Text variant="callout">{t('trust:reliability.how.green', { percent: isolate(formatPercent(CFG.reliabilityGreenMin, locale), 'ltr') })}</Text>
              <Text variant="callout">{t('trust:reliability.how.yellow')}</Text>
              <Text variant="callout">{t('trust:reliability.how.red', { percent: isolate(formatPercent(CFG.reliabilityRedBelow, locale), 'ltr') })}</Text>
              <Text variant="callout">{t('trust:reliability.how.new')}</Text>
            </Stack>
          ) : null}
        </Stack>
      </Card>
    </View>
  );
}
