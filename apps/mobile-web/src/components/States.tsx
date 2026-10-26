/** Loading / error / placeholder states shared by screens (design §13 preamble). */
import type { StError } from '@st/domain';
import { EmptyState, radius, Row, spacing, Stack, Text, useTheme } from '@st/ui';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { errorKey } from '@/data/errors';
import { useT } from '@/i18n';

/** Skeleton blocks; shown only after 300 ms so fast loads don't flash. */
export function Skeleton({ rows = 3, height = 88, testID = 'state.loading' }: { rows?: number; height?: number; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(id);
  }, []);
  return (
    <Stack gap="md" testID={testID} accessibilityLabel={t('common:status.loading')} accessibilityRole="progressbar">
      {visible
        ? Array.from({ length: rows }, (_, i) => (
            <View key={i} style={{ height, borderRadius: radius.lg, backgroundColor: colors.skeleton, opacity: 1 - i * 0.2 }} />
          ))
        : null}
    </Stack>
  );
}

/** Full-area error with Retry: says what happened and how to fix it. */
export function ErrorView({ error, onRetry }: { error: StError | null; onRetry?: () => void }) {
  const { t } = useT();
  return (
    <EmptyState
      tone={error?.code === 'network' ? 'offline' : 'error'}
      title={t('common:errorState.title')}
      body={error ? t(errorKey(error)) : t('common:errorState.body')}
      actionLabel={onRetry ? t('common:actions.retry') : undefined}
      onAction={onRetry}
    />
  );
}

/** Inline banner for a failed action (announced politely). */
export function InlineError({ error, testID = 'state.error' }: { error: StError | null; testID?: string }) {
  const { t } = useT();
  const { colors } = useTheme();
  if (!error) return null;
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ backgroundColor: colors.dangerSubtle, borderRadius: radius.md, padding: spacing.md }}
    >
      <Row gap="xs" align="start">
        <Text variant="callout" color="dangerText" importantForAccessibility="no">
          ⚠
        </Text>
        <Text variant="callout" color="dangerText" style={{ flex: 1 }}>
          {t(errorKey(error))}
        </Text>
      </Row>
    </View>
  );
}

/** Informational banner (info / warning / success tone). */
export function Banner({
  text,
  tone = 'info',
  testID,
}: {
  text: string;
  tone?: 'info' | 'warning' | 'success';
  testID?: string;
}) {
  const { colors } = useTheme();
  const bg = tone === 'warning' ? colors.warningSubtle : tone === 'success' ? colors.successSubtle : colors.infoSubtle;
  const fg = tone === 'warning' ? 'warningText' : tone === 'success' ? 'successText' : 'infoText';
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={{ backgroundColor: bg, borderRadius: radius.md, padding: spacing.md }}>
      <Text variant="callout" color={fg}>
        {text}
      </Text>
    </View>
  );
}
