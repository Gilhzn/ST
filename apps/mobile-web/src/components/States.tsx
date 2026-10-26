/**
 * Loading / error / notice states shared by screens (design v2 §15 preamble): shimmer skeletons
 * (never spinners, shown after 300 ms), illustrated error states that say what happened + Retry,
 * and calm inline banners with an icon (never color alone).
 */
import type { StError } from '@st/domain';
import { EmptyState, Icon, radius, Skeleton as Shimmer, SkeletonGameCard, spacing, Text, useTheme, type IconName } from '@st/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { errorKey } from '@/data/errors';
import { useT } from '@/i18n';

export type SkeletonKind = 'block' | 'game' | 'row' | 'hero';

/** One skeleton list row: avatar/icon well + two text lines. */
function SkeletonRow() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 }}>
      <Shimmer width={40} height={40} radius={radius.pill} />
      <View style={{ flex: 1, gap: spacing.sm }}>
        <Shimmer width="58%" height={14} />
        <Shimmer width="36%" height={12} />
      </View>
    </View>
  );
}

/** Hero skeleton for detail screens: gradient-band placeholder, facts strip, rows. */
function SkeletonHero() {
  return (
    <View style={{ gap: spacing.lg }}>
      <Shimmer height={220} radius={radius.xl} />
      <Shimmer height={88} radius={radius.lg} />
      <SkeletonRow />
      <SkeletonRow />
    </View>
  );
}

/**
 * Shimmer placeholders; appear only after 300 ms so fast loads don't flash. `kind` picks the
 * shape: `game` (hero game cards), `row` (list rows), `hero` (details), `block` (generic cards).
 */
export function Skeleton({ rows = 3, height = 88, testID = 'state.loading', kind = 'block' }: { rows?: number; height?: number; testID?: string; kind?: SkeletonKind }) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(id);
  }, []);
  return (
    <View testID={testID} role="progressbar" aria-busy aria-label={t('common:status.loading')} style={{ gap: kind === 'row' ? spacing.xs : spacing.md }}>
      {visible
        ? kind === 'hero'
          ? <SkeletonHero />
          : Array.from({ length: rows }, (_, i) => (
              <View key={i} style={{ opacity: 1 - i * 0.18 }}>
                {kind === 'game' ? <SkeletonGameCard /> : kind === 'row' ? <SkeletonRow /> : <Shimmer height={height} radius={radius.lg} />}
              </View>
            ))
        : null}
    </View>
  );
}

/** Full-area error with Retry: illustration, what happened, and how to fix it. */
export function ErrorView({ error, onRetry, testID = 'state.errorView' }: { error: StError | null; onRetry?: () => void; testID?: string }) {
  const { t } = useT();
  return (
    <EmptyState
      testID={testID}
      tone={error?.code === 'network' ? 'offline' : 'error'}
      title={t('common:errorState.title')}
      body={error ? t(errorKey(error)) : t('common:errorState.body')}
      actionLabel={onRetry ? t('common:actions.retry') : undefined}
      actionIcon="ArrowClockwise"
      onAction={onRetry}
      style={{ paddingTop: spacing.xxl, paddingBottom: spacing.xxl }}
    />
  );
}

export type BannerTone = 'info' | 'warning' | 'success' | 'danger' | 'brand';

const BANNER_ICON: Record<BannerTone, IconName> = {
  info: 'Info',
  warning: 'Warning',
  success: 'CheckCircle',
  danger: 'WarningCircle',
  brand: 'Sparkle',
};

/**
 * Calm notice card: tinted surface, 32dp icon well, optional bold title, body and trailing action.
 * Announced politely. Used for cancelled/ended games, legal drafts, offline and info hints.
 */
export function Banner({
  text,
  title,
  tone = 'info',
  icon,
  action,
  testID,
  role,
}: {
  text: string;
  title?: string;
  tone?: BannerTone;
  icon?: IconName;
  action?: ReactNode;
  testID?: string;
  role?: 'alert' | 'status';
}) {
  const { colors, scheme } = useTheme();
  const map = {
    info: [colors.infoSubtle, 'infoText'],
    warning: [colors.warningSubtle, 'warningText'],
    success: [colors.successSubtle, 'successText'],
    danger: [colors.dangerSubtle, 'dangerText'],
    brand: [colors.primarySubtle, 'onPrimarySubtle'],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View
      testID={testID}
      role={role ?? 'status'}
      aria-live="polite"
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, backgroundColor: bg, borderRadius: radius.lg, padding: spacing.md, paddingEnd: spacing.lg }}
    >
      <View aria-hidden style={{ width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: scheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)' }}>
        <Icon name={icon ?? BANNER_ICON[tone]} size={18} weight="fill" color={fg} />
      </View>
      <View style={{ flex: 1, gap: 2, paddingTop: title ? 0 : 6 }}>
        {title ? (
          <Text variant="label" weight="semibold" color={fg}>
            {title}
          </Text>
        ) : null}
        <Text variant={title ? 'footnote' : 'callout'} color={fg}>
          {text}
        </Text>
      </View>
      {action}
    </View>
  );
}

/** Inline banner for a failed action (announced assertively, danger tone, icon + text). */
export function InlineError({ error, testID = 'state.error' }: { error: StError | null; testID?: string }) {
  const { t } = useT();
  if (!error) return null;
  return <Banner testID={testID} tone="danger" role="alert" text={t(errorKey(error))} />;
}
