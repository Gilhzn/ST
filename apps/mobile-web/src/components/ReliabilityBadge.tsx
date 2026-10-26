import type { ReliabilityStatus } from '@st/domain';
import { StatusBadge, StatusDot } from '@st/ui';

import { useT } from '@/i18n';
import { formatPercent } from '@/lib/format';

/** Reliability pill: glyph + approved label + % (design §4). */
export function ReliabilityBadge({
  status,
  score,
  size = 'sm',
}: {
  status: ReliabilityStatus;
  score: number | null;
  size?: 'sm' | 'md';
}) {
  const { t, locale } = useT();
  const label = t(`common:reliability.status.${status}`);
  const percent = score !== null && status !== 'new' ? Math.round(score * 100) : undefined;
  const a11y =
    percent === undefined
      ? t('common:reliability.a11yNew')
      : t('common:reliability.a11y', { status: label, percent: formatPercent(percent / 100, locale) });
  return <StatusBadge status={status} label={label} percent={percent} size={size} accessibilityLabel={a11y} />;
}

export function ReliabilityDot({ status, score }: { status: ReliabilityStatus; score: number | null }) {
  const { t, locale } = useT();
  const label = t(`common:reliability.status.${status}`);
  const a11y =
    score === null || status === 'new'
      ? t('common:reliability.a11yNew')
      : t('common:reliability.a11y', { status: label, percent: formatPercent(score, locale) });
  return <StatusDot status={status} accessibilityLabel={a11y} />;
}
