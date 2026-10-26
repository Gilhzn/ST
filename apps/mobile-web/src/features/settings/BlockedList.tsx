/**
 * Blocked players with Unblock (TrustApi.listBlocked / unblockUser). The port
 * returns ids only, and a blocked user's public profile is hidden by design, so
 * rows are labelled by position and block date.
 */
import type { Block } from '@st/domain';
import { Button, Row, Stack, Text } from '@st/ui';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';

export function BlockedList() {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const blocked = useAsync(() => port.listBlocked(), [port]);
  const [target, setTarget] = useState<{ block: Block; index: number } | null>(null);
  const unblock = useAction(async (userId: string) => {
    await port.unblockUser(userId);
    await blocked.reload();
    toast(t('settings:privacy.blocked.unblocked'));
  });

  return (
    <Stack gap="sm" testID="settings.blocked">
      <Text variant="title3">{t('settings:privacy.blocked.title')}</Text>
      {blocked.loading && blocked.data === undefined ? (
        <Skeleton rows={1} height={56} />
      ) : blocked.error && blocked.data === undefined ? (
        <ErrorView error={blocked.error} onRetry={() => void blocked.reload()} />
      ) : (blocked.data ?? []).length === 0 ? (
        <Text variant="body" color="textSecondary" testID="settings.blocked.empty">
          {t('settings:privacy.blocked.empty')}
        </Text>
      ) : (
        (blocked.data ?? []).map((b, i) => {
          const name = t('settings:privacy.blocked.unnamed', { number: i + 1 });
          const since = t('settings:privacy.blocked.since', { date: formatDate(b.createdAt, locale, { day: 'numeric', month: 'short', year: 'numeric' }) });
          return (
            <Row key={b.blockedId} gap="md" testID={`settings.blocked.${b.blockedId}`} style={{ minHeight: 56 }}>
              <Icon name="account-cancel-outline" />
              <Stack gap="xxs" style={{ flex: 1 }} accessible accessibilityLabel={`${name}. ${since}`}>
                <Text variant="body">{name}</Text>
                <Text variant="caption" color="textSecondary">
                  {since}
                </Text>
              </Stack>
              <Button
                testID={`settings.blocked.unblock.${b.blockedId}`}
                variant="secondary"
                size="sm"
                label={t('common:actions.unblock')}
                accessibilityLabel={`${t('common:actions.unblock')}: ${name}`}
                hitSlop={6}
                onPress={() => setTarget({ block: b, index: i })}
              />
            </Row>
          );
        })
      )}
      <InlineError error={unblock.error} />
      <ConfirmDialog
        testID="settings.blocked.confirm"
        visible={!!target}
        title={target ? t('settings:privacy.blocked.unblockConfirm', { name: t('settings:privacy.blocked.unnamed', { number: target.index + 1 }) }) : ''}
        confirmLabel={t('common:actions.unblock')}
        cancelLabel={t('common:actions.cancel')}
        busy={unblock.busy}
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          const id = target?.block.blockedId;
          setTarget(null);
          if (id) void unblock.run(id);
        }}
      />
    </Stack>
  );
}
