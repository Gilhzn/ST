/**
 * Inbox → "Requests": actionable rows on top of the notifications. Friend requests from people
 * you played with, and photo tag requests (a tag stays invisible until you accept, VAULT-005).
 * Accept / Decline right in the row; the photo is previewed so you know what you agree to.
 */
import type { ConnectionView, MediaItemView, MediaTag, PublicProfile } from '@st/domain';
import { Haptics, IconButton, isolate, radius, Row, spacing, Stack, Text, useTheme } from '@st/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { MediaImage } from '@/components/MediaImage';
import { ReliabilityAvatar } from '@/components/ReliabilityBadge';
import { InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { getMediaItem } from '@/data/extensions';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';

interface TagRequest {
  tag: MediaTag;
  media: MediaItemView | null;
  tagger: PublicProfile | null;
}

export function useInboxRequests() {
  const port = useData();
  const friends = useAsync(() => port.listConnections('requests'), [port]);
  const tags = useAsync(async (): Promise<TagRequest[]> => {
    const list = await port.listMyTagRequests();
    return Promise.all(
      list.map(async (tag) => ({
        tag,
        media: await getMediaItem(port, tag.mediaId).catch(() => null),
        tagger: await port.getPublicProfile(tag.taggedBy).catch(() => null),
      })),
    );
  }, [port]);
  const reload = async () => {
    await Promise.all([friends.reload(), tags.reload()]);
  };
  return { friends, tags, reload, count: (friends.data?.length ?? 0) + (tags.data?.length ?? 0) };
}

export function InboxRequests({ friends, tags, onChanged }: { friends: ConnectionView[]; tags: TagRequest[]; onChanged: () => Promise<void> }) {
  const { t } = useT();
  const port = useData();
  const toast = useToast();
  const theme = useTheme();
  const act = useAction(async (kind: 'friend' | 'tag', id: string, accept: boolean) => {
    if (kind === 'friend') await port.respondFriendRequest(id, accept);
    else await port.respondToMediaTag(id, accept);
    return true;
  });
  if (!friends.length && !tags.length) return null;
  const run = async (kind: 'friend' | 'tag', id: string, accept: boolean) => {
    const ok = await act.run(kind, id, accept);
    if (!ok) return;
    if (accept) Haptics.success();
    else Haptics.selection();
    toast(
      kind === 'friend' ? (accept ? t('network:toast.acceptedShort') : t('network:toast.declined')) : accept ? t('vault:tags.accepted') : t('vault:tags.declined'),
      accept ? 'success' : 'neutral',
    );
    await onChanged();
  };
  const buttons = (kind: 'friend' | 'tag', id: string, name: string) => (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <IconButton testID={`inbox.request.${id}.decline`} icon="X" weight="bold" variant="tonal" color="dangerText" label={t('network:declineA11y', { name })} disabled={act.busy} onPress={() => void run(kind, id, false)} />
      <IconButton testID={`inbox.request.${id}.accept`} icon="Check" weight="bold" variant="filled" label={t('network:acceptA11y', { name })} disabled={act.busy} onPress={() => void run(kind, id, true)} />
    </View>
  );
  const rows: ReactNode[] = [
    ...friends.map((c) => (
      <RequestRow
        key={`f-${c.user.id}`}
        testID={`inbox.request.${c.user.id}`}
        leading={<ReliabilityAvatar name={c.user.displayName} uri={c.user.avatarUrl} status={c.user.reliabilityStatus} score={c.user.reliabilityScore} />}
        title={t('network:request.friendTitle', { name: isolate(c.user.displayName) })}
        body={c.gamesTogether ? t('network:request.friendBody', { count: c.gamesTogether }) : t('network:row.notPlayed')}
        actions={buttons('friend', c.user.id, c.user.displayName)}
      />
    )),
    ...tags.map(({ tag, media, tagger }) => (
      <RequestRow
        key={`t-${tag.mediaId}`}
        testID={`inbox.request.${tag.mediaId}`}
        leading={<MediaImage uri={media?.thumbnailUrl ?? media?.url} width={48} height={48} radius={12} />}
        title={t('vault:tags.requestTitle', { name: isolate(tagger?.displayName ?? t('vault:viewer.someone')) })}
        body={t('vault:tags.requestBody')}
        actions={buttons('tag', tag.mediaId, tagger?.displayName ?? '')}
      />
    )),
  ];
  return (
    <View style={{ gap: spacing.sm }} testID="inbox.requests">
      <Row gap="xs" style={{ paddingStart: spacing.lg }}>
        <Text variant="overline" color="primaryText" role="heading">
          {t('network:request.section', { count: rows.length })}
        </Text>
      </Row>
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1.5, borderColor: theme.colors.primary, ...theme.elevation(1) }}>
        {rows.map((r, i) => (
          <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: theme.colors.border }}>
            {r}
          </View>
        ))}
      </View>
      <InlineError error={act.error} />
    </View>
  );
}

function RequestRow({ leading, title, body, actions, testID }: { leading: ReactNode; title: string; body: string; actions: ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, paddingStart: spacing.lg, backgroundColor: theme.colors.surface }}>
      {leading}
      <Stack gap="xxs" style={{ flex: 1 }}>
        <Text variant="callout" weight="semibold" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="footnote" color="textSecondary" numberOfLines={2}>
          {body}
        </Text>
      </Stack>
      {actions}
    </View>
  );
}
