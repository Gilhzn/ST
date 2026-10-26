/**
 * Sanction and appeal (design v2 §15.14, DSA Art. 17/20, GDPR Art. 22). Calm by design:
 * 1. Status card — what applies, a status badge (icon + label), since / ends in, a time ring.
 * 2. Statement of reasons — facts, rule, who decided (automated or a person), what it affects
 *    and what you can still do, as grouped rows (never truncated).
 * 3. Way back — how to get back on track.
 * 4. Dispute (with a countdown ring for the window) or appeal: a reason picker (radio rows),
 *    a message with a live counter, then a vertical timeline once filed.
 * Never only red; always a next step.
 */
import { canDispute, type Appeal, type Sanction } from '@st/domain';
import { Button, Haptics, Icon, isolate, ListGroup, ProgressRing, radius, Row, Skeleton, spacing, Stack, StatusBadge, Text, TextField, useTheme, type IconName } from '@st/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { ErrorView, InlineError } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { Notice, toneColorsFor, useToneColors, type NoticeTone } from '@/features/kit/Notice';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT, type TFunction } from '@/i18n';
import { formatDate, formatDateTime, formatDuration } from '@/lib/format';

const MIN_CHARS = 20;
const MAX_CHARS = 2000;
const REVIEW_HOURS = 72;
const REASONS = ['was_present', 'cancelled_in_time', 'technical_problem', 'not_my_message', 'disagree', 'other'] as const;
const REASON_ICONS: Record<(typeof REASONS)[number], IconName> = {
  was_present: 'MapPin',
  cancelled_in_time: 'CalendarX',
  technical_problem: 'GpsFix',
  not_my_message: 'ChatSlash',
  disagree: 'Question',
  other: 'DotsThree',
};
const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** ICU params for server-provided statements: dates localized, text isolated, numbers as-is. */
export function statementValues(params: Readonly<Record<string, string | number>>, locale: string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'number' ? v : ISO.test(v) ? isolate(formatDate(v, locale, { day: 'numeric', month: 'short', year: 'numeric' }), 'ltr') : isolate(v);
  }
  return out;
}

/** "36 h" / "6 d" in the user's language (Intl unit formatting), for ring centres. */
function compactLeft(ms: number, locale: string): string {
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  const [value, unit] = hours < 48 ? [hours, 'hour'] : [Math.ceil(hours / 24), 'day'];
  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value);
  } catch {
    return `${value}${unit === 'hour' ? 'h' : 'd'}`;
  }
}

function toneFor(s: Sanction, inForce: boolean): NoticeTone {
  if (!inForce) return 'success';
  return s.kind === 'yellow_card' ? 'warning' : s.kind === 'permanent_ban' ? 'danger' : 'warning';
}

export function SanctionScreen({ sanctionId }: { sanctionId: string }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const port = useData();
  const now = useNow(30_000);
  const sanction = useAsync(() => port.getSanction(sanctionId), [port, sanctionId]);
  const appeals = useAsync(() => port.listMyAppeals(), [port]);
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [text, setText] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const file = useAction(async (body: string) => port.fileAppeal(sanctionId, body));

  const s = sanction.data;
  if (!s) {
    return (
      <Screen testID="screen.sanction" title={t('trust:sanctions.title')} backFallback="/profile">
        {sanction.loading ? (
          <Stack gap="lg" aria-busy testID="state.loading">
            <Skeleton height={180} radius={radius.lg} />
            <Skeleton height={220} radius={radius.lg} />
          </Stack>
        ) : sanction.error ? (
          <ErrorView error={sanction.error} onRetry={() => void sanction.reload()} />
        ) : (
          <Notice tone="warning" icon="Info" text={t('errors:not_found')} />
        )}
      </Screen>
    );
  }

  const values = statementValues(s.statementParams, locale);
  const inForce = s.status === 'active' || s.status === 'disputed' || s.status === 'upheld';
  const disputable = canDispute(s, now);
  const appeal = (appeals.data ?? []).find((a) => a.sanctionId === s.id && (a.status === 'open' || a.decidedAt !== null)) ?? null;
  const msLeft = s.expiresAt ? Date.parse(s.expiresAt) - now : null;
  const total = s.expiresAt ? Date.parse(s.expiresAt) - Date.parse(s.startsAt) : null;
  const tooShort = text.trim().length < MIN_CHARS;
  const tone = toneFor(s, inForce);
  const toneColors = toneColorsFor(theme.colors, tone);

  const submit = async () => {
    if (!reason || tooShort) {
      setShowErrors(true);
      Haptics.warning();
      return;
    }
    const res = await file.run(`${t(`trust:sanctions.appeal.reason.${reason}`)}\n\n${text.trim()}`);
    if (res) {
      Haptics.success();
      setFormOpen(false);
      void appeals.reload();
      void sanction.reload();
    }
  };

  return (
    <Screen testID="screen.sanction" title={t('trust:sanctions.title')} backFallback="/profile">
      {/* 1. Status */}
      <View testID={`sanctions.item.${s.id}`} style={{ borderRadius: radius.xl, overflow: 'hidden', ...theme.elevation(1) }}>
        <View style={{ backgroundColor: toneColors.bg, padding: spacing.lg, gap: spacing.md }}>
          <Row gap="md" align="start">
            <View aria-hidden style={{ width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }}>
              <Icon name={inForce ? 'ShieldWarning' : 'ShieldCheck'} size={26} weight="fill" color={toneColors.fg} />
            </View>
            <Stack gap="xs" style={{ flex: 1 }}>
              <Text variant="title2">{t(`trust:sanctions.kind.${s.kind}.name`)}</Text>
              <StatusBadge size="sm" status={!inForce ? 'green' : s.kind === 'yellow_card' ? 'yellow' : 'red'} label={t(`trust:sanctions.status.${s.status}`)} />
            </Stack>
          </Row>
          <Text variant="callout">{t(`trust:sanctions.kind.${s.kind}.effect`)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg }}>
          <Stack gap="xs" style={{ flex: 1 }}>
            <Text variant="footnote" color="textSecondary">
              {t('trust:sanctions.since', { date: isolate(formatDateTime(s.startsAt, locale), 'ltr') })}
            </Text>
            {s.expiresAt === null ? (
              <Text variant="callout" color="textSecondary">
                {t('trust:sanctions.noEndDate')}
              </Text>
            ) : inForce && msLeft !== null && msLeft > 0 ? (
              <>
                <Text variant="statSmall" testID="sanctions.endsIn">
                  {t('trust:sanctions.endsIn', { duration: formatDuration(Math.ceil(msLeft / 60_000), locale) })}
                </Text>
                <Text variant="footnote" color="textSecondary">
                  {t('trust:sanctions.until', { date: isolate(formatDateTime(s.expiresAt, locale), 'ltr') })}
                </Text>
              </>
            ) : (
              <Text variant="callout" color="textSecondary" testID="sanctions.ended">
                {t('trust:sanctions.ended', { date: isolate(formatDateTime(s.expiresAt, locale), 'ltr') })}
              </Text>
            )}
          </Stack>
          {inForce && msLeft !== null && msLeft > 0 && total ? (
            <ProgressRing progress={msLeft / total} size={64} thickness={6} color={toneColors.fg}>
              <Text variant="caption" weight="bold" allowFontScaling={false} style={{ fontVariant: ['tabular-nums'] }}>
                {isolate(compactLeft(msLeft, locale), 'ltr')}
              </Text>
            </ProgressRing>
          ) : null}
        </View>
      </View>

      {/* 2. Statement of reasons */}
      <Stack gap="lg" testID="sanctions.statement">
        <ListGroup title={t('trust:sanctions.statement.title')} footer={t('trust:sanctions.statement.askPerson')}>
          <InfoRow icon="FileText" tone="brand" body={t(`trust:${s.statementKey}`, values)} />
          <InfoRow icon="Flag" tone="neutral" title={t('trust:sanctions.statement.ruleLabel')} body={t(`trust:sanctions.rule.${s.reasonCode}`)} />
          <InfoRow
            icon={s.decidedBy === 'system' ? 'Lightning' : 'User'}
            tone="info"
            title={t('trust:sanctions.statement.decidedByTitle')}
            body={s.decidedBy === 'system' ? t('trust:sanctions.statement.automated') : t('trust:sanctions.statement.human')}
          />
        </ListGroup>
        <ListGroup>
          <InfoRow icon="Prohibit" tone="warning" title={t('trust:sanctions.statement.affectsTitle')} body={t(`trust:sanctions.kind.${s.kind}.effect`)} />
          <InfoRow icon="CheckCircle" tone="success" title={t('trust:sanctions.statement.stillAllowedTitle')} body={t(`trust:sanctions.kind.${s.kind}.stillAllowed`)} />
        </ListGroup>
      </Stack>

      {/* 3. Way back */}
      <ListGroup title={t('trust:sanctions.fix.title')}>
        <InfoRow icon="ArrowClockwise" tone="success" body={t(`trust:sanctions.fix.${s.reasonCode}`, values)} />
        {s.kind === 'yellow_card' && s.expiresAt ? (
          <InfoRow icon="CalendarCheck" tone="neutral" body={t('trust:sanctions.fix.expiresOn', { date: isolate(formatDate(s.expiresAt, locale, { day: 'numeric', month: 'short' }), 'ltr') })} />
        ) : null}
      </ListGroup>

      {/* 4. Dispute / appeal */}
      {appeal ? (
        <AppealTimeline appeal={appeal} t={t} locale={locale} />
      ) : s.status === 'overturned' || s.status === 'expired' ? null : (
        <Stack gap="lg">
          {s.disputeUntil ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, ...theme.elevation(1) }}>
              {disputable ? (
                <ProgressRing
                  progress={(Date.parse(s.disputeUntil) - now) / Math.max(1, Date.parse(s.disputeUntil) - Date.parse(s.startsAt))}
                  size={72}
                  thickness={7}
                  color="primary"
                >
                  <Text variant="label" weight="bold" allowFontScaling={false} style={{ fontVariant: ['tabular-nums'] }}>
                    {isolate(compactLeft(Date.parse(s.disputeUntil) - now, locale), 'ltr')}
                  </Text>
                  <Text variant="caption" color="textSecondary" allowFontScaling={false} style={{ fontSize: 10, lineHeight: 12 }}>
                    {t('trust:sanctions.dispute.ringCaption')}
                  </Text>
                </ProgressRing>
              ) : (
                <View aria-hidden style={{ width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken }}>
                  <Icon name="ClockCountdown" size={24} color="textSecondary" />
                </View>
              )}
              <Text variant="callout" color={disputable ? 'text' : 'textSecondary'} testID="sanctions.disputeWindow" aria-live="polite" style={{ flex: 1 }}>
                {disputable
                  ? t('trust:sanctions.dispute.windowLeft', {
                      date: isolate(formatDateTime(s.disputeUntil, locale), 'ltr'),
                      duration: formatDuration(Math.max(1, Math.ceil((Date.parse(s.disputeUntil) - now) / 60_000)), locale),
                    })
                  : t('trust:sanctions.dispute.windowClosed')}
              </Text>
            </View>
          ) : null}
          {!formOpen ? (
            <Button
              testID={disputable ? 'sanctions.dispute' : 'sanctions.appeal'}
              size="lg"
              fullWidth
              icon="ChatCircleText"
              label={disputable ? t('trust:sanctions.dispute.cta') : t('trust:sanctions.appeal.cta')}
              onPress={() => setFormOpen(true)}
            />
          ) : (
            <View testID="sanctions.appeal.form" style={{ gap: spacing.lg, padding: spacing.lg, borderRadius: radius.xl, ...theme.elevation(2) }}>
              <Text variant="title2">{t('trust:sanctions.appeal.title')}</Text>
              <Stack gap="sm">
                <Text variant="label" color="textSecondary">
                  {t('trust:sanctions.appeal.reasonLabel')}
                </Text>
                <View role="radiogroup" aria-label={t('trust:sanctions.appeal.reasonLabel')} style={{ borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: showErrors && !reason ? theme.colors.danger : theme.colors.border }}>
                  {REASONS.map((r, i) => (
                    <ReasonRow key={r} reason={r} first={i === 0} selected={reason === r} onSelect={() => setReason(r)} />
                  ))}
                </View>
                {showErrors && !reason ? (
                  <Row gap="xs">
                    <Icon name="WarningCircle" size={16} color="dangerText" />
                    <Text variant="footnote" color="dangerText">
                      {t('common:validation.required')}
                    </Text>
                  </Row>
                ) : null}
              </Stack>
              <Stack gap="xs">
                <TextField
                  testID="sanctions.appeal.text"
                  label={t('trust:sanctions.appeal.messageLabel')}
                  error={showErrors && tooShort ? t('common:validation.tooShort', { min: MIN_CHARS }) : undefined}
                  value={text}
                  onChangeText={setText}
                  multiline
                  maxLength={MAX_CHARS}
                  inputDirection="auto"
                  numberOfLines={5}
                  textAlignVertical="top"
                />
                <Row gap="sm" justify="between">
                  <Text variant="footnote" color="textTertiary" style={{ flex: 1 }}>
                    {t('trust:sanctions.appeal.messageHint', { min: MIN_CHARS })}
                  </Text>
                  <Text
                    variant="footnote"
                    weight="semibold"
                    color={text.trim().length >= MIN_CHARS ? 'successText' : 'textTertiary'}
                    aria-live="polite"
                    testID="sanctions.appeal.counter"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {isolate(t('trust:sanctions.appeal.counter', { count: text.trim().length, max: MAX_CHARS }), 'ltr')}
                  </Text>
                </Row>
              </Stack>
              <InlineError error={file.error} />
              <Stack gap="xs">
                <Button testID="sanctions.appeal.submit" size="lg" fullWidth icon="PaperPlaneRight" label={t('trust:sanctions.appeal.submit')} loading={file.busy} onPress={() => void submit()} />
                <Button variant="ghost" label={t('common:actions.cancel')} onPress={() => setFormOpen(false)} />
              </Stack>
            </View>
          )}
        </Stack>
      )}
    </Screen>
  );
}

/** Grouped info row that never truncates (statements are long). */
function InfoRow({ icon, tone, title, body }: { icon: IconName; tone: NoticeTone; title?: string; body: string }) {
  const c = useToneColors(tone);
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surface }}>
      <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === 'neutral' ? colors.surfaceSunken : c.bg }}>
        <Icon name={icon} size={20} weight="duotone" color={c.fg} />
      </View>
      <Stack gap="xxs" style={{ flex: 1, paddingTop: title ? 0 : spacing.xs }}>
        {title ? (
          <Text variant="footnote" weight="semibold" color="textSecondary">
            {title}
          </Text>
        ) : null}
        <Text variant="callout">{body}</Text>
      </Stack>
    </View>
  );
}

function ReasonRow({ reason, first, selected, onSelect }: { reason: (typeof REASONS)[number]; first: boolean; selected: boolean; onSelect: () => void }) {
  const { t } = useT();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={`sanctions.appeal.reason.${reason}`}
      role="radio"
      aria-checked={selected}
      onPress={() => {
        Haptics.selection();
        onSelect();
      }}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingStart: spacing.md,
        paddingEnd: spacing.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: selected ? colors.primarySubtle : pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      <Icon name={REASON_ICONS[reason]} size={20} weight={selected ? 'fill' : 'regular'} color={selected ? 'primary' : 'textSecondary'} />
      <Text variant="callout" weight={selected ? 'semibold' : 'regular'} color={selected ? 'onPrimarySubtle' : 'text'} style={{ flex: 1 }}>
        {t(`trust:sanctions.appeal.reason.${reason}`)}
      </Text>
      <View
        aria-hidden
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: selected ? 0 : 2,
          borderColor: colors.borderStrong,
          backgroundColor: selected ? colors.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Icon name="Check" size={14} weight="bold" color="onPrimary" /> : null}
      </View>
    </Pressable>
  );
}

function AppealTimeline({ appeal, t, locale }: { appeal: Appeal; t: TFunction; locale: string }) {
  const theme = useTheme();
  const { colors } = theme;
  const decided = appeal.status !== 'open';
  const steps = [
    { key: 'received', done: true, date: appeal.createdAt },
    { key: 'inReview', done: true, date: null },
    { key: 'decided', done: decided, date: appeal.decidedAt },
  ] as const;
  return (
    <Stack gap="lg" testID="sanctions.appeal.timeline">
      <Notice tone="success" icon="CheckCircle" testID="sanctions.appeal.received" text={t('trust:sanctions.appeal.received', { hours: REVIEW_HOURS })} />
      <View role="list" style={{ padding: spacing.lg, borderRadius: radius.lg, ...theme.elevation(1) }}>
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const current = !s.done && steps[i - 1]?.done;
          return (
            <View key={s.key} role="listitem" style={{ flexDirection: 'row', gap: spacing.md, minHeight: last ? 0 : 56 }}>
              <View style={{ alignItems: 'center', width: 24 }}>
                <View
                  aria-hidden
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: s.done ? colors.success : colors.surface,
                    borderWidth: s.done ? 0 : 2,
                    borderColor: current ? colors.primary : colors.borderStrong,
                  }}
                >
                  {s.done ? <Icon name="Check" size={14} weight="bold" color="onSuccess" /> : null}
                </View>
                {!last ? <View aria-hidden style={{ flex: 1, width: 2, marginTop: 4, marginBottom: 4, borderRadius: 1, backgroundColor: steps[i + 1]?.done ? colors.success : colors.border }} /> : null}
              </View>
              <Stack gap="xxs" style={{ flex: 1, paddingBottom: last ? 0 : spacing.md }}>
                <Text variant="headline" color={s.done ? 'text' : 'textTertiary'}>
                  {t(`trust:sanctions.appeal.timeline.${s.key}`)}
                </Text>
                {s.date ? (
                  <Text variant="footnote" color="textSecondary">
                    {isolate(formatDateTime(s.date, locale), 'ltr')}
                  </Text>
                ) : null}
              </Stack>
            </View>
          );
        })}
      </View>
      {decided && (appeal.status === 'upheld' || appeal.status === 'overturned') ? (
        <Notice
          tone={appeal.status === 'overturned' ? 'success' : 'neutral'}
          icon={appeal.status === 'overturned' ? 'SealCheck' : 'Info'}
          title={t(`trust:sanctions.appeal.outcome.${appeal.status}`)}
          text={appeal.decisionNote ? t('trust:sanctions.appeal.reviewerNoteLine', { note: appeal.decisionNote }) : undefined}
        />
      ) : null}
    </Stack>
  );
}
