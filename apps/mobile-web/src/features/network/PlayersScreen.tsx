/**
 * Players (network): friends, people you played with (auto-derived from games you both checked
 * in to) and friend requests, plus the privacy of "Who sees my upcoming games". Friend requests
 * are only possible with people you played with (anti-spam rule in the domain); blocks hide a
 * person everywhere.
 */
import type { ConnectionView, UpcomingGamesAudience } from '@st/domain';
import { BidiText, Button, EmptyState, Haptics, Icon, IconButton, isolate, radius, Segmented, spacing, StatusPill, Text, useTheme } from '@st/ui';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ReliabilityAvatar } from '@/components/ReliabilityBadge';
import { Screen } from '@/components/Screen';
import { ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';

type Tab = 'friends' | 'played' | 'requests';

export function PlayersScreen() {
  const { t } = useT();
  const port = useData();
  const toast = useToast();
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('friends');
  const [removing, setRemoving] = useState<ConnectionView | null>(null);
  const all = useAsync(() => port.listConnections('all'), [port]);
  const privacy = useAsync(() => port.getNetworkPrivacy(), [port]);
  const act = useAction(async (kind: 'request' | 'accept' | 'decline' | 'remove', userId: string) => {
    if (kind === 'request') return port.requestFriend(userId);
    if (kind === 'accept' || kind === 'decline') return port.respondFriendRequest(userId, kind === 'accept');
    await port.removeFriend(userId);
    return null;
  });
  const setAudience = useAction((a: UpcomingGamesAudience) => port.setNetworkPrivacy(a));

  const list = all.data ?? [];
  const friends = list.filter((c) => c.friend === 'friends');
  const played = list.filter((c) => c.playedWith);
  const incoming = list.filter((c) => c.friend === 'incoming');
  const outgoing = list.filter((c) => c.friend === 'outgoing');

  const run = async (kind: 'request' | 'accept' | 'decline' | 'remove', c: ConnectionView) => {
    const res = await act.run(kind, c.user.id);
    if (res === undefined) return;
    if (kind === 'accept') Haptics.success();
    else Haptics.selection();
    toast(
      kind === 'request'
        ? t('network:toast.requested', { name: c.user.displayName })
        : kind === 'accept'
          ? t('network:toast.accepted', { name: c.user.displayName })
          : kind === 'decline'
            ? t('network:toast.declined')
            : t('network:toast.removed'),
      kind === 'accept' || kind === 'request' ? 'success' : 'neutral',
    );
    await all.reload();
  };

  return (
    <Screen
      testID="screen.players"
      large
      title={t('network:title')}
      subtitle={all.data ? t('network:subtitle', { count: played.length }) : undefined}
      backFallback="/profile"
      headerChildren={
        <Segmented
          testID="players.tabs"
          label={t('network:title')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'friends', label: t('network:tab.friends'), count: all.data ? friends.length : undefined, testID: 'players.tab.friends' },
            { value: 'played', label: t('network:tab.played'), count: all.data ? played.length : undefined, testID: 'players.tab.played' },
            { value: 'requests', label: t('network:tab.requests'), count: incoming.length || undefined, testID: 'players.tab.requests' },
          ]}
        />
      }
      contentStyle={{ gap: spacing.xl, paddingTop: spacing.sm }}
    >
      <InlineError error={act.error ?? setAudience.error} />
      {all.loading && !all.data ? (
        <Skeleton kind="row" rows={5} />
      ) : all.error && !all.data ? (
        <ErrorView error={all.error} onRetry={() => void all.reload()} />
      ) : tab === 'friends' ? (
        friends.length ? (
          <Group testID="players.friends">
            {friends.map((c, i) => (
              <PersonRow key={c.user.id} c={c} divider={i > 0} trailing={<IconButton testID={`players.remove.${c.user.id}`} icon="UserMinus" variant="plain" size="sm" color="textTertiary" label={t('network:removeA11y', { name: c.user.displayName })} onPress={() => setRemoving(c)} />} />
            ))}
          </Group>
        ) : (
          <EmptyState testID="players.friends.empty" illustration="noChat" title={t('network:empty.friendsTitle')} body={t('network:empty.friendsBody')} actionLabel={t('network:empty.seePlayed')} actionIcon="UsersThree" onAction={() => setTab('played')} />
        )
      ) : tab === 'played' ? (
        played.length ? (
          <View style={{ gap: spacing.sm }}>
            <Group testID="players.played">
              {played.map((c, i) => (
                <PersonRow
                  key={c.user.id}
                  c={c}
                  divider={i > 0}
                  trailing={
                    c.friend === 'none' ? (
                      <Button testID={`players.add.${c.user.id}`} size="sm" variant="secondary" icon="UserPlus" label={t('network:action.add')} disabled={act.busy} onPress={() => void run('request', c)} />
                    ) : c.friend === 'outgoing' ? (
                      <StatusPill icon="Hourglass" label={t('network:state.outgoing')} />
                    ) : c.friend === 'incoming' ? (
                      <Button testID={`players.accept.${c.user.id}`} size="sm" icon="Check" label={t('network:action.accept')} disabled={act.busy} onPress={() => void run('accept', c)} />
                    ) : (
                      <StatusPill tone="success" icon="UserCheck" label={t('network:state.friends')} />
                    )
                  }
                />
              ))}
            </Group>
            <Text variant="caption" color="textTertiary" style={{ paddingStart: spacing.lg }}>
              {t('network:playedHelp')}
            </Text>
          </View>
        ) : (
          <EmptyState testID="players.played.empty" illustration="emptyGames" title={t('network:empty.playedTitle')} body={t('network:empty.playedBody')} />
        )
      ) : (
        <View style={{ gap: spacing.xl }}>
          {incoming.length ? (
            <Group title={t('network:requests.incoming')} testID="players.requests">
              {incoming.map((c, i) => (
                <PersonRow
                  key={c.user.id}
                  c={c}
                  divider={i > 0}
                  trailing={
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <IconButton testID={`players.decline.${c.user.id}`} icon="X" weight="bold" variant="tonal" color="dangerText" label={t('network:declineA11y', { name: c.user.displayName })} disabled={act.busy} onPress={() => void run('decline', c)} />
                      <IconButton testID={`players.accept.${c.user.id}`} icon="Check" weight="bold" variant="filled" label={t('network:acceptA11y', { name: c.user.displayName })} disabled={act.busy} onPress={() => void run('accept', c)} />
                    </View>
                  }
                />
              ))}
            </Group>
          ) : (
            <EmptyState testID="players.requests.empty" illustration="noNotifications" title={t('network:empty.requestsTitle')} body={t('network:empty.requestsBody')} />
          )}
          {outgoing.length ? (
            <Group title={t('network:requests.outgoing')} testID="players.sent">
              {outgoing.map((c, i) => (
                <PersonRow key={c.user.id} c={c} divider={i > 0} trailing={<Button testID={`players.cancel.${c.user.id}`} size="sm" variant="ghost" label={t('network:action.cancel')} disabled={act.busy} onPress={() => void run('remove', c)} />} />
              ))}
            </Group>
          ) : null}
        </View>
      )}

      <View style={{ gap: spacing.sm }} testID="players.privacy">
        <Text variant="overline" color="textTertiary" role="heading" style={{ paddingStart: spacing.lg }}>
          {t('network:privacy.title')}
        </Text>
        <View style={{ padding: spacing.lg, gap: spacing.md, borderRadius: radius.lg, backgroundColor: theme.colors.surface, ...theme.elevation(1) }}>
          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
            <View aria-hidden style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.successSubtle }}>
              <Icon name="Eye" size={22} weight="duotone" color="successText" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="headline">{t('network:privacy.label')}</Text>
              <Text variant="footnote" color="textSecondary">
                {t('network:privacy.help')}
              </Text>
            </View>
          </View>
          {privacy.data ? (
            <Segmented
              testID="players.privacy.audience"
              label={t('network:privacy.label')}
              value={privacy.data.upcomingGamesVisibleTo}
              onChange={async (v) => {
                const prev = privacy.data;
                privacy.setData((p) => (p ? { ...p, upcomingGamesVisibleTo: v } : (p as never)));
                const res = await setAudience.run(v);
                if (res) toast(v === 'friends' ? t('network:privacy.savedFriends') : t('network:privacy.savedNobody'), 'success');
                else if (prev) privacy.setData(prev);
              }}
              options={[
                { value: 'friends', label: t('network:privacy.friends'), icon: 'UsersThree', testID: 'players.privacy.friends' },
                { value: 'nobody', label: t('network:privacy.nobody'), icon: 'EyeSlash', testID: 'players.privacy.nobody' },
              ]}
            />
          ) : (
            <Skeleton height={44} rows={1} />
          )}
        </View>
      </View>

      <ConfirmDialog
        testID="players.removeDialog"
        visible={!!removing}
        icon="UserMinus"
        title={removing ? t('network:removeTitle', { name: isolate(removing.user.displayName) }) : ''}
        body={t('network:removeBody')}
        confirmLabel={t('network:action.remove')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        busy={act.busy}
        onConfirm={async () => {
          if (removing) await run('remove', removing);
          setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
    </Screen>
  );
}

function Group({ title, children, testID }: { title?: string; children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      {title ? (
        <Text variant="overline" color="textTertiary" role="heading" style={{ paddingStart: spacing.lg }}>
          {title}
        </Text>
      ) : null}
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surface, ...theme.elevation(1) }}>{children}</View>
    </View>
  );
}

function PersonRow({ c, trailing, divider }: { c: ConnectionView; trailing?: ReactNode; divider?: boolean }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const last = c.lastPlayedAt ? formatDate(c.lastPlayedAt, locale, { day: 'numeric', month: 'short' }) : null;
  const sub = c.playedWith
    ? last
      ? t('network:row.played', { count: c.gamesTogether, date: last })
      : t('network:row.playedNoDate', { count: c.gamesTogether })
    : t('network:row.notPlayed');
  return (
    <View
      testID={`players.person.${c.user.id}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 68, paddingStart: spacing.lg, paddingEnd: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, borderTopWidth: divider ? 1 : 0, borderTopColor: theme.colors.border }}
    >
      <ReliabilityAvatar name={c.user.displayName} uri={c.user.avatarUrl} status={c.user.reliabilityStatus} score={c.user.reliabilityScore} />
      <View style={{ flex: 1, gap: 2 }}>
        <BidiText variant="body" weight="medium" numberOfLines={1}>
          {c.user.displayName}
        </BidiText>
        <Text variant="footnote" color="textSecondary" numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {trailing}
    </View>
  );
}
