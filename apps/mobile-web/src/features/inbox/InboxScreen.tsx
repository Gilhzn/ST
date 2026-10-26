/**
 * Inbox (design §13.15, phase 1): Chats | Notifications. Notifications render
 * from i18n key + ICU params (server sends no prose). Unread sanction notices are
 * pinned on top until read and open the sanction screen.
 */
import { DEFAULT_TRUST_CONFIG, isChatOpen, type Notification, type NotificationKind } from '@st/domain';
import { BidiText, EmptyState, radius, Row, spacing, Stack, Text, useTheme } from '@st/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { ErrorView, Skeleton } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { statementValues } from '@/features/sanctions/SanctionScreen';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatRelative } from '@/lib/format';

const ICONS: Partial<Record<NotificationKind, IconName>> = {
  join_requested: 'account-plus-outline',
  join_approved: 'check-circle-outline',
  join_rejected: 'close-circle-outline',
  join_waitlisted: 'timer-sand',
  waitlist_offer: 'timer-sand',
  waitlist_promoted: 'party-popper',
  game_cancelled: 'calendar-remove-outline',
  game_reminder: 'calendar-clock',
  checkin_open: 'map-marker-check',
  result_requested: 'scoreboard-outline',
  sanction_issued: 'shield-alert-outline',
  sanction_decided: 'shield-check-outline',
  appeal_decided: 'gavel',
  chat_muted: 'message-off-outline',
  deposit_action_required: 'shield-lock-outline',
};

const PINNED: NotificationKind[] = ['sanction_issued', 'sanction_decided', 'visibility_restricted', 'chat_muted'];

export function InboxScreen() {
  const { t, locale } = useT();
  const port = useData();
  const now = useNow(60_000);
  const [tab, setTab] = useState<'notifications' | 'chats'>('notifications');
  const notifications = useAsync(() => port.listNotifications({ limit: 100 }), [port]);
  const games = useAsync(() => port.listMyGames(), [port], tab === 'chats');
  const reload = notifications.reload;
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const sorted = useMemo(() => {
    const list = notifications.data ?? [];
    const pinned = list.filter((n) => !n.readAt && PINNED.includes(n.kind));
    return [...pinned, ...list.filter((n) => !pinned.includes(n))];
  }, [notifications.data]);

  const open = async (n: Notification) => {
    if (!n.readAt) {
      notifications.setData((prev) => (prev ?? []).map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      void port.markNotificationsRead([n.id]).catch(() => undefined);
    }
    if (n.sanctionId) router.push(`/sanctions/${n.sanctionId}`);
    else if (n.gameId) router.push(n.kind === 'result_requested' ? `/game/${n.gameId}/result` : n.kind === 'checkin_open' ? `/game/${n.gameId}/checkin` : `/game/${n.gameId}`);
  };

  const chats = (games.data ?? []).filter((g) => (g.isHost || g.myParticipation?.status === 'approved') && g.status !== 'cancelled' && isChatOpen(g, now, DEFAULT_TRUST_CONFIG));

  return (
    <Screen title={t('chat:inbox.title')} back={false} testID="screen.inbox" edges={['top']} scroll={false}>
      <Row gap="sm" accessibilityRole="tablist">
        <ChoiceChip testID="inbox.tab.notifications" selectionRole="radio" label={t('chat:inbox.tabNotifications')} selected={tab === 'notifications'} onToggle={() => setTab('notifications')} />
        <ChoiceChip testID="inbox.tab.chats" selectionRole="radio" label={t('chat:inbox.tabChats')} selected={tab === 'chats'} onToggle={() => setTab('chats')} />
      </Row>
      {tab === 'notifications' ? (
        notifications.loading && !notifications.data ? (
          <Skeleton rows={4} height={64} />
        ) : notifications.error ? (
          <ErrorView error={notifications.error} onRetry={() => void notifications.reload()} />
        ) : sorted.length === 0 ? (
          <EmptyState title={t('chat:inbox.empty')} />
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(n) => n.id}
            contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.xxl }}
            renderItem={({ item }) => (
              <NotificationRow n={item} pinned={!item.readAt && PINNED.includes(item.kind)} onPress={() => void open(item)} relative={formatRelative(item.createdAt, locale, now)} />
            )}
          />
        )
      ) : games.loading && !games.data ? (
        <Skeleton rows={3} height={64} />
      ) : chats.length === 0 ? (
        <EmptyState title={t('chat:inbox.empty')} actionLabel={t('common:nav.map')} onAction={() => router.push('/map')} />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ gap: spacing.xs }}
          renderItem={({ item }) => (
            <View testID={`inbox.chat.${item.id}`}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/game/${item.id}/chat`)}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64 }}
              >
                <Icon name="message-text-outline" />
                <Stack gap="xxs" style={{ flex: 1 }}>
                  <BidiText variant="callout">{item.title}</BidiText>
                  <Text variant="caption" color="textSecondary">
                    {formatRelative(item.startsAt, locale, now)}
                  </Text>
                </Stack>
                <Icon name="chevron-right" directional />
              </Pressable>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

function NotificationRow({ n, pinned, onPress, relative }: { n: Notification; pinned: boolean; onPress: () => void; relative: string }) {
  const { t, locale } = useT();
  const { colors } = useTheme();
  const params = statementValues(n.params, locale);
  const unread = !n.readAt;
  return (
    <Pressable
      testID={`inbox.notification.${n.id}`}
      accessibilityRole="button"
      accessibilityState={{ selected: unread }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.surfaceSunken : unread ? colors.surface : 'transparent',
        borderWidth: pinned ? 1.5 : 0,
        borderColor: colors.warning,
      })}
    >
      <Icon name={ICONS[n.kind] ?? 'bell-outline'} color={unread ? 'primary' : 'textSecondary'} />
      <Stack gap="xxs" style={{ flex: 1 }}>
        <Text variant="callout" style={unread ? { fontWeight: '700' } : undefined}>
          {t(`notifications:${n.kind}.title`, params)}
        </Text>
        <Text variant="caption" color="textSecondary">
          {t(`notifications:${n.kind}.body`, params)}
        </Text>
        <Row gap="sm">
          <Text variant="caption" color="textTertiary">
            {relative}
          </Text>
          {pinned ? (
            <Text variant="caption" color="warningText">
              {t('chat:inbox.pinned')}
            </Text>
          ) : null}
        </Row>
      </Stack>
      {unread ? <View accessibilityElementsHidden style={{ width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: colors.primary }} /> : null}
    </Pressable>
  );
}
