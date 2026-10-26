/**
 * Inbox (design v2 §15.12): large title + Notifications | Chats segmented control (counts).
 * Notifications render from i18n key + ICU params (the server sends no prose), grouped into
 * day sections; unread sanction notices are pinned on top until read and open the sanction
 * screen. Rows carry a category icon in a tinted circle and an unread dot; swipe toward the
 * start edge (or the row's accessibility action, or "Mark all as read") marks them read.
 */
import { DEFAULT_TRUST_CONFIG, isChatOpen, type Notification, type NotificationKind } from '@st/domain';
import {
  BidiText,
  Button,
  EmptyState,
  Haptics,
  Icon,
  LargeHeader,
  radius,
  Row,
  Segmented,
  Skeleton,
  spacing,
  SportGlyphBadge,
  Stack,
  StatusPill,
  Text,
  useTheme,
  type IconName,
} from '@st/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorView } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { toneColorsFor, type NoticeTone } from '@/features/kit/Notice';
import { statementValues } from '@/features/sanctions/SanctionScreen';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT, type TFunction } from '@/i18n';
import { formatDate, formatRelative } from '@/lib/format';

const KIND: Partial<Record<NotificationKind, { icon: IconName; tone: NoticeTone }>> = {
  join_requested: { icon: 'UserPlus', tone: 'brand' },
  join_approved: { icon: 'CheckCircle', tone: 'success' },
  join_rejected: { icon: 'XCircle', tone: 'neutral' },
  join_waitlisted: { icon: 'Hourglass', tone: 'info' },
  waitlist_offer: { icon: 'Hourglass', tone: 'brand' },
  waitlist_promoted: { icon: 'Confetti', tone: 'success' },
  participant_removed: { icon: 'UserMinus', tone: 'neutral' },
  game_cancelled: { icon: 'CalendarX', tone: 'danger' },
  game_reminder: { icon: 'CalendarDots', tone: 'info' },
  checkin_open: { icon: 'MapPin', tone: 'brand' },
  result_requested: { icon: 'Trophy', tone: 'warning' },
  sanction_issued: { icon: 'ShieldWarning', tone: 'warning' },
  sanction_decided: { icon: 'ShieldCheck', tone: 'info' },
  appeal_decided: { icon: 'SealCheck', tone: 'info' },
  visibility_restricted: { icon: 'ShieldWarning', tone: 'warning' },
  chat_muted: { icon: 'ChatSlash', tone: 'warning' },
  venue_hidden: { icon: 'MapPin', tone: 'neutral' },
  deposit_action_required: { icon: 'Coins', tone: 'warning' },
};

const PINNED: NotificationKind[] = ['sanction_issued', 'sanction_decided', 'visibility_restricted', 'chat_muted'];

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface Section {
  key: string;
  title: string;
  items: Notification[];
}

function sectionsFor(list: readonly Notification[], now: number, t: TFunction, locale: string): Section[] {
  const pinned = list.filter((n) => !n.readAt && PINNED.includes(n.kind));
  const rest = list.filter((n) => !pinned.includes(n));
  const out: Section[] = [];
  if (pinned.length) out.push({ key: 'pinned', title: t('chat:inbox.needsAttention'), items: pinned });
  const today = startOfDay(now);
  const buckets = new Map<string, Section>();
  for (const n of rest) {
    const day = startOfDay(Date.parse(n.createdAt));
    const diff = Math.round((today - day) / 86_400_000);
    const key = diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : diff < 7 ? String(day) : 'earlier';
    const title =
      key === 'today'
        ? t('chat:day.today')
        : key === 'yesterday'
          ? t('chat:day.yesterday')
          : key === 'earlier'
            ? t('chat:inbox.earlier')
            : formatDate(n.createdAt, locale, { weekday: 'long', day: 'numeric', month: 'short' });
    const s = buckets.get(key) ?? { key, title, items: [] };
    s.items.push(n);
    buckets.set(key, s);
  }
  return [...out, ...buckets.values()];
}

export function InboxScreen() {
  const { t, locale } = useT();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const port = useData();
  const now = useNow(60_000);
  const [tab, setTab] = useState<'notifications' | 'chats'>('notifications');
  const [refreshing, setRefreshing] = useState(false);
  const notifications = useAsync(() => port.listNotifications({ limit: 100 }), [port]);
  const games = useAsync(() => port.listMyGames(), [port]);
  const reload = notifications.reload;
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const list = useMemo(() => notifications.data ?? [], [notifications.data]);
  const sections = useMemo(() => sectionsFor(list, now, t, locale), [list, now, t, locale]);
  const unread = list.filter((n) => !n.readAt);

  const markRead = (ids: string[]) => {
    if (!ids.length) return;
    const at = new Date().toISOString();
    notifications.setData((prev) => (prev ?? []).map((x) => (ids.includes(x.id) ? { ...x, readAt: x.readAt ?? at } : x)));
    void port.markNotificationsRead(ids).catch(() => undefined);
  };

  const open = (n: Notification) => {
    markRead(n.readAt ? [] : [n.id]);
    if (n.sanctionId) router.push(`/sanctions/${n.sanctionId}`);
    else if (n.gameId) router.push(n.kind === 'result_requested' ? `/game/${n.gameId}/result` : n.kind === 'checkin_open' ? `/game/${n.gameId}/checkin` : `/game/${n.gameId}`);
  };

  const chats = (games.data ?? []).filter((g) => (g.isHost || g.myParticipation?.status === 'approved') && g.status !== 'cancelled' && isChatOpen(g, now, DEFAULT_TRUST_CONFIG));

  const onRefresh = async () => {
    setRefreshing(true);
    Haptics.trigger('pullToRefresh');
    await Promise.all([notifications.reload(), games.reload()]);
    setRefreshing(false);
  };

  return (
    <SafeAreaView testID="screen.inbox" edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.colors.primary} />}
        stickyHeaderIndices={[0]}
      >
        <LargeHeader
          title={t('chat:inbox.title')}
          actions={
            tab === 'notifications' && unread.length ? (
              <Button testID="inbox.markAllRead" variant="ghost" size="sm" icon="Check" label={t('chat:inbox.markAllRead')} onPress={() => markRead(unread.map((n) => n.id))} />
            ) : undefined
          }
        >
          <Segmented
            label={t('chat:inbox.title')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'notifications', label: t('chat:inbox.tabNotifications'), icon: 'Bell', count: unread.length || undefined, testID: 'inbox.tab.notifications' },
              { value: 'chats', label: t('chat:inbox.tabChats'), icon: 'ChatsCircle', count: chats.length || undefined, testID: 'inbox.tab.chats' },
            ]}
          />
        </LargeHeader>

        <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingStart: spacing.lg, paddingEnd: spacing.lg, gap: spacing.xl }}>
          {tab === 'notifications' ? (
            notifications.loading && !notifications.data ? (
              <RowsSkeleton />
            ) : notifications.error && !notifications.data ? (
              <ErrorView error={notifications.error} onRetry={() => void notifications.reload()} />
            ) : sections.length === 0 ? (
              <EmptyState testID="inbox.empty" illustration="noNotifications" title={t('chat:inbox.tabNotifications')} body={t('chat:inbox.caughtUp')} />
            ) : (
              sections.map((s) => (
                <Group key={s.key} title={s.title} tone={s.key === 'pinned' ? 'warning' : undefined}>
                  {s.items.map((n, i) => (
                    <SwipeToRead key={n.id} enabled={!n.readAt} onRead={() => markRead([n.id])} divider={i > 0}>
                      <NotificationRow n={n} pinned={s.key === 'pinned'} onPress={() => open(n)} relative={formatRelative(n.createdAt, locale, now)} onMarkRead={() => markRead([n.id])} />
                    </SwipeToRead>
                  ))}
                </Group>
              ))
            )
          ) : games.loading && !games.data ? (
            <RowsSkeleton />
          ) : chats.length === 0 ? (
            <EmptyState testID="inbox.chats.empty" illustration="noChat" title={t('chat:inbox.tabChats')} body={t('chat:inbox.empty')} actionLabel={t('common:nav.map')} actionIcon="MapTrifold" onAction={() => router.push('/map')} />
          ) : (
            <Group>
              {chats.map((g, i) => (
                <View key={g.id} testID={`inbox.chat.${g.id}`}>
                  <Pressable
                    role="button"
                    aria-label={g.title}
                    onPress={() => router.push(`/game/${g.id}/chat`)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                      minHeight: 72,
                      paddingStart: spacing.lg,
                      paddingEnd: spacing.md,
                      backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
                    })}
                  >
                    <SportGlyphBadge sport={g.sport} size={44} variant="solid" squircle />
                    <Stack gap="xxs" style={{ flex: 1 }}>
                      <BidiText variant="headline" numberOfLines={1}>
                        {g.title}
                      </BidiText>
                      <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                        {formatRelative(g.startsAt, locale, now)}
                      </Text>
                    </Stack>
                    <Icon name="CaretRight" size={18} weight="bold" color="textTertiary" />
                  </Pressable>
                  {i > 0 ? <View aria-hidden style={{ position: 'absolute', top: 0, start: spacing.lg + 44 + spacing.md, end: 0, height: 1, backgroundColor: theme.colors.border }} /> : null}
                </View>
              ))}
            </Group>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ title, tone, children }: { title?: string; tone?: 'warning'; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {title ? (
        <Row gap="xs" style={{ paddingStart: spacing.lg }}>
          {tone ? <Icon name="ShieldWarning" size={14} weight="fill" color="warningText" /> : null}
          <Text variant="overline" color={tone ? 'warningText' : 'textTertiary'} role="heading">
            {title}
          </Text>
        </Row>
      ) : null}
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', ...theme.elevation(1), ...(tone ? { borderWidth: 1.5, borderColor: theme.colors.warning } : null) }}>{children}</View>
    </View>
  );
}

function NotificationRow({ n, pinned, onPress, relative, onMarkRead }: { n: Notification; pinned: boolean; onPress: () => void; relative: string; onMarkRead: () => void }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const params = statementValues(n.params, locale);
  const unread = !n.readAt;
  const kind = KIND[n.kind] ?? { icon: 'Bell' as IconName, tone: 'neutral' as NoticeTone };
  const tc = toneColorsFor(theme.colors, kind.tone);
  const title = t(`notifications:${n.kind}.title`, params);
  return (
    <Pressable
      testID={`inbox.notification.${n.id}`}
      role="button"
      aria-label={`${title}. ${relative}`}
      accessibilityActions={unread ? [{ name: 'markRead', label: t('chat:inbox.markRead') }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'markRead') onMarkRead();
      }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        paddingStart: spacing.lg,
        paddingEnd: spacing.lg,
        paddingTop: spacing.md,
        paddingBottom: spacing.md,
        backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
      })}
    >
      <View aria-hidden style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: kind.tone === 'neutral' ? theme.colors.surfaceSunken : tc.bg }}>
        <Icon name={kind.icon} size={20} weight={unread ? 'fill' : 'regular'} color={tc.fg} />
      </View>
      <Stack gap="xxs" style={{ flex: 1 }}>
        <Row gap="sm" align="start">
          <Text variant="callout" weight={unread ? 'semibold' : 'regular'} style={{ flex: 1 }} numberOfLines={2}>
            {title}
          </Text>
          <Text variant="caption" color={unread ? 'primaryText' : 'textTertiary'} weight={unread ? 'semibold' : 'regular'} numberOfLines={1}>
            {relative}
          </Text>
        </Row>
        <Text variant="footnote" color="textSecondary" numberOfLines={3}>
          {t(`notifications:${n.kind}.body`, params)}
        </Text>
        {pinned ? <StatusPill tone="warning" icon="ShieldWarning" label={t('chat:inbox.pinned')} style={{ marginTop: spacing.xs }} /> : null}
      </Stack>
      <View aria-hidden style={{ width: 10, alignItems: 'center', paddingTop: 6 }}>
        {unread ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary }} /> : null}
      </View>
    </Pressable>
  );
}

/**
 * Swipe toward the start edge to reveal "Mark as read" (behind the row, at the end edge).
 * Follows the reading direction; taps and vertical scrolls pass through.
 */
function SwipeToRead({ enabled, onRead, divider, children }: { enabled: boolean; onRead: () => void; divider: boolean; children: ReactNode }) {
  const { t } = useT();
  const theme = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const sign = theme.isRTL ? -1 : 1;
  const THRESHOLD = 88;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => enabled && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_, g) => {
          const d = Math.min(0, g.dx * sign);
          x.setValue(Math.max(-140, d));
        },
        onPanResponderRelease: (_, g) => {
          const d = g.dx * sign;
          if (d < -THRESHOLD) {
            Haptics.selection();
            onRead();
          }
          Animated.spring(x, { toValue: 0, useNativeDriver: false, damping: 22, stiffness: 380 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: false }).start(),
      }),
    [enabled, sign, x, onRead],
  );
  return (
    <View style={{ borderTopWidth: divider ? 1 : 0, borderTopColor: theme.colors.border, backgroundColor: theme.colors.primary }}>
      {enabled ? (
        <View aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, end: 0, width: 140, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <Icon name="Check" size={20} weight="bold" color="onPrimary" />
          <Text variant="caption" weight="semibold" color="onPrimary" numberOfLines={1}>
            {t('chat:inbox.markRead')}
          </Text>
        </View>
      ) : null}
      <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: Animated.multiply(x, sign) }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

function RowsSkeleton() {
  const theme = useTheme();
  return (
    <View aria-busy testID="state.loading" style={{ borderRadius: radius.lg, overflow: 'hidden', ...theme.elevation(1) }}>
      {[0, 1, 2, 3].map((i) => (
        <Row key={i} gap="md" style={{ padding: spacing.lg, borderTopWidth: i ? 1 : 0, borderTopColor: theme.colors.border }} align="start">
          <Skeleton width={40} height={40} radius={20} />
          <Stack gap="sm" style={{ flex: 1 }}>
            <Skeleton height={14} width="70%" />
            <Skeleton height={12} width="90%" />
          </Stack>
        </Row>
      ))}
    </View>
  );
}
