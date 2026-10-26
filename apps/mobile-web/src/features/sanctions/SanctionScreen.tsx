/**
 * Sanction and appeal (design §13.13, DSA Art. 17/20, GDPR Art. 22): a calm status
 * card (what applies, since/until with a countdown), the statement of reasons
 * (facts, rule, automated or human, what it affects and what it doesn't), how to
 * get back on track, and the dispute (within the window) or appeal form with a
 * timeline. Never only red; always a next step.
 */
import { canDispute, type Appeal } from '@st/domain';
import { Button, Divider, isolate, Row, Stack, StatusBadge, Text, TextField } from '@st/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { Card } from '@/components/CardView';
import { ChoiceChip } from '@/components/ChoiceChip';
import { Screen } from '@/components/Screen';
import { Banner, ErrorView, InlineError, Skeleton } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT, type TFunction } from '@/i18n';
import { formatDate, formatDateTime, formatDuration } from '@/lib/format';

const MIN_CHARS = 20;
const MAX_CHARS = 2000;
const REVIEW_HOURS = 72;
const REASONS = ['was_present', 'cancelled_in_time', 'technical_problem', 'not_my_message', 'disagree', 'other'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** ICU params for server-provided statements: dates localized, text isolated, numbers as-is. */
export function statementValues(params: Readonly<Record<string, string | number>>, locale: string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'number' ? v : ISO.test(v) ? isolate(formatDate(v, locale, { day: 'numeric', month: 'short', year: 'numeric' }), 'ltr') : isolate(v);
  }
  return out;
}

export function SanctionScreen({ sanctionId }: { sanctionId: string }) {
  const { t, locale } = useT();
  const port = useData();
  const now = useNow(30_000);
  const sanction = useAsync(() => port.getSanction(sanctionId), [port, sanctionId]);
  const appeals = useAsync(() => port.listMyAppeals(), [port]);
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [text, setText] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const file = useAction(async (body: string) => port.fileAppeal(sanctionId, body));

  if (sanction.loading && !sanction.data) {
    return (
      <Screen testID="screen.sanction" title={t('trust:sanctions.title')}>
        <Skeleton rows={3} />
      </Screen>
    );
  }
  const s = sanction.data;
  if (!s) {
    return (
      <Screen testID="screen.sanction" title={t('trust:sanctions.title')}>
        {sanction.error ? <ErrorView error={sanction.error} onRetry={() => void sanction.reload()} /> : <Banner tone="warning" text={t('errors:not_found')} />}
      </Screen>
    );
  }

  const values = statementValues(s.statementParams, locale);
  const inForce = s.status === 'active' || s.status === 'disputed' || s.status === 'upheld';
  const disputable = canDispute(s, now);
  const appeal = (appeals.data ?? []).find((a) => a.sanctionId === s.id && (a.status === 'open' || a.decidedAt !== null)) ?? null;
  const msLeft = s.expiresAt ? Date.parse(s.expiresAt) - now : null;
  const tooShort = text.trim().length < MIN_CHARS;

  const submit = async () => {
    if (!reason || tooShort) {
      setShowErrors(true);
      return;
    }
    const res = await file.run(`${t(`trust:sanctions.appeal.reason.${reason}`)}\n\n${text.trim()}`);
    if (res) {
      setFormOpen(false);
      void appeals.reload();
      void sanction.reload();
    }
  };

  return (
    <Screen testID="screen.sanction" title={t('trust:sanctions.title')} backFallback="/profile">
      {/* 1. Status */}
      <Card testID={`sanctions.item.${s.id}`} outlined>
        <Stack gap="sm">
          <Row gap="sm" wrap>
            <Text variant="title3" style={{ flex: 1 }}>
              {t(`trust:sanctions.kind.${s.kind}.name`)}
            </Text>
            <StatusBadge
              size="sm"
              status={!inForce ? 'green' : s.kind === 'yellow_card' ? 'yellow' : 'red'}
              label={t(`trust:sanctions.status.${s.status}`)}
            />
          </Row>
          <Text variant="body">{t(`trust:sanctions.kind.${s.kind}.effect`)}</Text>
          <Text variant="callout" color="textSecondary">
            {t('trust:sanctions.since', { date: isolate(formatDateTime(s.startsAt, locale), 'ltr') })}
          </Text>
          {s.expiresAt === null ? (
            <Text variant="callout" color="textSecondary">
              {t('trust:sanctions.noEndDate')}
            </Text>
          ) : inForce && msLeft !== null && msLeft > 0 ? (
            <Stack gap="xxs">
              <Text variant="bodyStrong" testID="sanctions.endsIn">
                {t('trust:sanctions.endsIn', { duration: formatDuration(Math.ceil(msLeft / 60_000), locale) })}
              </Text>
              <Text variant="caption" color="textSecondary">
                {t('trust:sanctions.until', { date: isolate(formatDateTime(s.expiresAt, locale), 'ltr') })}
              </Text>
            </Stack>
          ) : (
            <Text variant="callout" color="textSecondary" testID="sanctions.ended">
              {t('trust:sanctions.ended', { date: isolate(formatDateTime(s.expiresAt, locale), 'ltr') })}
            </Text>
          )}
        </Stack>
      </Card>

      {/* 2. Statement of reasons */}
      <Stack gap="sm" testID="sanctions.statement">
        <Text variant="title3">{t('trust:sanctions.statement.title')}</Text>
        <Text variant="body">{t(`trust:${s.statementKey}`, values)}</Text>
        <Text variant="callout" color="textSecondary">
          {t('trust:sanctions.statement.ruleLine', { rule: t(`trust:sanctions.rule.${s.reasonCode}`) })}
        </Text>
        <Text variant="callout" color="textSecondary">
          {s.decidedBy === 'system' ? t('trust:sanctions.statement.automated') : t('trust:sanctions.statement.human')}
        </Text>
        <Text variant="callout" color="textSecondary">
          {t('trust:sanctions.statement.askPerson')}
        </Text>
        <Row gap="lg" wrap align="start">
          <Stack gap="xxs" style={{ flex: 1, minWidth: 220 }}>
            <Text variant="label">{t('trust:sanctions.statement.affectsTitle')}</Text>
            <Text variant="callout">{t(`trust:sanctions.kind.${s.kind}.effect`)}</Text>
          </Stack>
          <Stack gap="xxs" style={{ flex: 1, minWidth: 220 }}>
            <Text variant="label">{t('trust:sanctions.statement.stillAllowedTitle')}</Text>
            <Text variant="callout">{t(`trust:sanctions.kind.${s.kind}.stillAllowed`)}</Text>
          </Stack>
        </Row>
      </Stack>

      {/* 3. Way back */}
      <Stack gap="xs">
        <Text variant="title3">{t('trust:sanctions.fix.title')}</Text>
        <Text variant="body">{t(`trust:sanctions.fix.${s.reasonCode}`, values)}</Text>
        {s.kind === 'yellow_card' && s.expiresAt ? (
          <Text variant="callout" color="textSecondary">
            {t('trust:sanctions.fix.expiresOn', { date: isolate(formatDate(s.expiresAt, locale, { day: 'numeric', month: 'short' }), 'ltr') })}
          </Text>
        ) : null}
      </Stack>

      <Divider />

      {/* 4. Dispute / appeal */}
      {appeal ? (
        <AppealTimeline appeal={appeal} t={t} locale={locale} />
      ) : s.status === 'overturned' || s.status === 'expired' ? null : (
        <Stack gap="md">
          {s.disputeUntil ? (
            <Text variant="callout" color={disputable ? 'text' : 'textSecondary'} testID="sanctions.disputeWindow" accessibilityLiveRegion="polite">
              {disputable
                ? t('trust:sanctions.dispute.windowLeft', {
                    date: isolate(formatDateTime(s.disputeUntil, locale), 'ltr'),
                    duration: formatDuration(Math.max(1, Math.ceil((Date.parse(s.disputeUntil) - now) / 60_000)), locale),
                  })
                : t('trust:sanctions.dispute.windowClosed')}
            </Text>
          ) : null}
          {!formOpen ? (
            <Button
              testID={disputable ? 'sanctions.dispute' : 'sanctions.appeal'}
              label={disputable ? t('trust:sanctions.dispute.cta') : t('trust:sanctions.appeal.cta')}
              onPress={() => setFormOpen(true)}
            />
          ) : (
            <Card outlined testID="sanctions.appeal.form">
              <Stack gap="md">
                <Text variant="title3">{t('trust:sanctions.appeal.title')}</Text>
                <Stack gap="xs">
                  <Text variant="label">{t('trust:sanctions.appeal.reasonLabel')}</Text>
                  <Row gap="sm" wrap accessibilityRole="radiogroup">
                    {REASONS.map((r) => (
                      <ChoiceChip key={r} testID={`sanctions.appeal.reason.${r}`} selectionRole="radio" label={t(`trust:sanctions.appeal.reason.${r}`)} selected={reason === r} onToggle={() => setReason(r)} />
                    ))}
                  </Row>
                  {showErrors && !reason ? (
                    <Text variant="caption" color="dangerText">
                      {t('common:validation.required')}
                    </Text>
                  ) : null}
                </Stack>
                <View>
                  <TextField
                    testID="sanctions.appeal.text"
                    label={t('trust:sanctions.appeal.messageLabel')}
                    helperText={t('trust:sanctions.appeal.messageHint', { min: MIN_CHARS })}
                    error={showErrors && tooShort ? t('common:validation.tooShort', { min: MIN_CHARS }) : undefined}
                    value={text}
                    onChangeText={setText}
                    multiline
                    maxLength={MAX_CHARS}
                    inputDirection="auto"
                    numberOfLines={5}
                  />
                  <Text variant="caption" color="textTertiary" align="center" accessibilityLiveRegion="polite" testID="sanctions.appeal.counter">
                    {t('trust:sanctions.appeal.counter', { count: text.trim().length, max: MAX_CHARS })}
                  </Text>
                </View>
                <InlineError error={file.error} />
                <Row gap="sm">
                  <Button testID="sanctions.appeal.submit" label={t('trust:sanctions.appeal.submit')} loading={file.busy} onPress={() => void submit()} />
                  <Button variant="ghost" label={t('common:actions.cancel')} onPress={() => setFormOpen(false)} />
                </Row>
              </Stack>
            </Card>
          )}
        </Stack>
      )}
    </Screen>
  );
}

function AppealTimeline({ appeal, t, locale }: { appeal: Appeal; t: TFunction; locale: string }) {
  const decided = appeal.status !== 'open';
  const steps = [
    { key: 'received', done: true },
    { key: 'inReview', done: true },
    { key: 'decided', done: decided },
  ] as const;
  return (
    <Stack gap="sm" testID="sanctions.appeal.timeline">
      <Banner tone="success" testID="sanctions.appeal.received" text={t('trust:sanctions.appeal.received', { hours: REVIEW_HOURS })} />
      <Row gap="md" wrap accessibilityRole="list">
        {steps.map((s, i) => (
          <Row key={s.key} gap="xs">
            <Text variant="label" color={s.done ? 'successText' : 'textTertiary'}>
              {s.done ? '✓' : String(i + 1)}
            </Text>
            <Text variant="label" color={s.done ? 'text' : 'textTertiary'}>
              {t(`trust:sanctions.appeal.timeline.${s.key}`)}
            </Text>
          </Row>
        ))}
      </Row>
      <Text variant="caption" color="textTertiary">
        {isolate(formatDateTime(appeal.createdAt, locale), 'ltr')}
      </Text>
      {decided && (appeal.status === 'upheld' || appeal.status === 'overturned') ? (
        <Stack gap="xxs">
          <Text variant="bodyStrong">{t(`trust:sanctions.appeal.outcome.${appeal.status}`)}</Text>
          {appeal.decisionNote ? (
            <Text variant="callout" color="textSecondary">
              {t('trust:sanctions.appeal.reviewerNoteLine', { note: appeal.decisionNote })}
            </Text>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}

