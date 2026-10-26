/**
 * Blocked players with Unblock. Names come from `listBlockedNamed` (adapter
 * extension); entries without a known name are labelled by position.
 */
import { Avatar, Button, ListGroup, ListItem, Skeleton, Stack } from '@st/ui';
import { View } from 'react-native';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorView, InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { listBlockedNamed, type BlockedEntry } from '@/data/blocked';
import { useData } from '@/data/DataProvider';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';

export function BlockedList() {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const blocked = useAsync(() => listBlockedNamed(port), [port]);
  const [target, setTarget] = useState<{ block: BlockedEntry; index: number } | null>(null);
  const unblock = useAction(async (userId: string) => {
    await port.unblockUser(userId);
    await blocked.reload();
    toast(t('settings:privacy.blocked.unblocked'));
  });

  const list = blocked.data ?? [];
  return (
    <Stack gap="sm" testID="settings.blocked">
      {blocked.loading && blocked.data === undefined ? (
        <View aria-busy>
          <Skeleton height={64} radius={20} />
        </View>
      ) : blocked.error && blocked.data === undefined ? (
        <ErrorView error={blocked.error} onRetry={() => void blocked.reload()} />
      ) : (
        <ListGroup title={t('settings:privacy.blocked.title')}>
          {list.length === 0 ? (
            <ListItem testID="settings.blocked.empty" icon="UserMinus" iconTone="neutral" title={t('settings:privacy.blocked.empty')} />
          ) : (
            list.map((b, i) => {
              const name = b.displayName ?? t('settings:privacy.blocked.unnamed', { number: i + 1 });
              const since = t('settings:privacy.blocked.since', { date: formatDate(b.createdAt, locale, { day: 'numeric', month: 'short', year: 'numeric' }) });
              return (
                <ListItem
                  key={b.blockedId}
                  testID={`settings.blocked.${b.blockedId}`}
                  leading={<Avatar name={name} size="md" decorative />}
                  title={name}
                  subtitle={since}
                  aria-label={`${name}. ${since}`}
                  trailing={
                    <Button
                      testID={`settings.blocked.unblock.${b.blockedId}`}
                      variant="secondary"
                      size="sm"
                      label={t('common:actions.unblock')}
                      aria-label={`${t('common:actions.unblock')}: ${name}`}
                      onPress={() => setTarget({ block: b, index: i })}
                    />
                  }
                />
              );
            })
          )}
        </ListGroup>
      )}
      <InlineError error={unblock.error} />
      <ConfirmDialog
        testID="settings.blocked.confirm"
        visible={!!target}
        title={target ? t('settings:privacy.blocked.unblockConfirm', { name: target.block.displayName ?? t('settings:privacy.blocked.unnamed', { number: target.index + 1 }) }) : ''}
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
