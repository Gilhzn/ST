import type { ReliabilityStatus } from '@st/domain';
import { Avatar, ProgressRing, ReliabilityRing, StatusBadge, StatusDot, useTheme, type AvatarSize } from '@st/ui';

import { useT } from '@/i18n';
import { formatPercent } from '@/lib/format';

function useReliabilityLabels(status: ReliabilityStatus, score: number | null) {
  const { t, locale } = useT();
  const label = t(`common:reliability.status.${status}`);
  const percent = score !== null && status !== 'new' ? Math.round(score * 100) : undefined;
  const a11y =
    percent === undefined
      ? t('common:reliability.a11yNew')
      : t('common:reliability.a11y', { status: label, percent: formatPercent(percent / 100, locale) });
  return { label, percent, a11y };
}

/** Reliability pill: Phosphor status glyph + approved label + % (design §4). */
export function ReliabilityBadge({ status, score, size = 'sm' }: { status: ReliabilityStatus; score: number | null; size?: 'sm' | 'md' }) {
  const { label, percent, a11y } = useReliabilityLabels(status, score);
  return <StatusBadge status={status} label={label} percent={percent} size={size} accessibilityLabel={a11y} />;
}

/** Dense-list status dot (participants, chat authors); always paired with a spoken label. */
export function ReliabilityDot({ status, score }: { status: ReliabilityStatus; score: number | null }) {
  const { a11y } = useReliabilityLabels(status, score);
  return <StatusDot status={status} accessibilityLabel={a11y} />;
}

/** The big ring (profile hero, host sheet): status arc, tabular % and label. */
export function ReliabilityRingView({ status, score, size = 132, testID }: { status: ReliabilityStatus; score: number | null; size?: number; testID?: string }) {
  const { label, percent, a11y } = useReliabilityLabels(status, score);
  return <ReliabilityRing status={status} percent={percent} label={label} size={size} accessibilityLabel={a11y} testID={testID} />;
}

const RING: Record<Extract<AvatarSize, 'sm' | 'md' | 'lg'>, { ring: number; stroke: number }> = {
  sm: { ring: 30, stroke: 2.5 },
  md: { ring: 48, stroke: 3 },
  lg: { ring: 66, stroke: 4 },
};

/**
 * Avatar wrapped in a reliability arc (status color, filled to the reliability score; an empty
 * track for new players). Decorative: the status is spoken by the adjacent StatusBadge / StatusDot.
 */
export function ReliabilityAvatar({
  name,
  uri,
  status,
  score,
  size = 'md',
}: {
  name: string;
  uri?: string | null;
  status: ReliabilityStatus;
  score: number | null;
  size?: Extract<AvatarSize, 'sm' | 'md' | 'lg'>;
}) {
  const theme = useTheme();
  const r = RING[size];
  const progress = status === 'new' || score === null ? 0 : Math.max(0, Math.min(1, score));
  const avatarSize: AvatarSize = size === 'lg' ? 'lg' : size === 'md' ? 'md' : 'xs';
  return (
    <ProgressRing progress={progress} size={r.ring} thickness={r.stroke} color={theme.reliability[status].solid} animated={false}>
      <Avatar name={name} uri={uri} size={avatarSize} decorative />
    </ProgressRing>
  );
}
