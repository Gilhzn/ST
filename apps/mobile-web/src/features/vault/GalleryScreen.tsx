/**
 * Game gallery (Media Vault, VAULT-001..009): the upload window as a live countdown ("Gallery
 * locks in 1:23:10"), "Add photos" for checked-in players (web file input; native needs
 * expo-image-picker), a 3-column grid with public / pending-consent badges, and a viewer with
 * tagging (requests, invisible until accepted), the "Make public in venue vault" switch (only
 * once every tag is accepted), untag, report and delete.
 */
import {
  DEFAULT_PHASE15_CONFIG,
  DEFAULT_TRUST_CONFIG,
  isStError,
  mediaUploadWindow,
  type MediaItemView,
  type ParticipantView,
  type UserId,
} from '@st/domain';
import { Avatar, AvatarStack, BidiText, Button, EmptyState, Haptics, Icon, isolate, ProgressRing, radius, Segmented, spacing, StatusPill, Text, useTheme } from '@st/ui';
import { useMemo, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { focusVisible } from '@/components/focusVisible';
import { MediaImage } from '@/components/MediaImage';
import { Screen } from '@/components/Screen';
import { ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { MEDIA_REPORT_REASONS, reportMedia, uploadPickedMedia, type MediaReportReason } from '@/data/extensions';
import { SheetModal } from '@/features/kit/SheetModal';
import { SwitchRow } from '@/features/settings/SwitchRow';
import { useAction, useAsync } from '@/hooks/useAsync';
import { clockLabel, useCountdown } from '@/hooks/useCountdown';
import { useT } from '@/i18n';
import { formatRelative, formatTime } from '@/lib/format';
import { pickMedia } from '@/platform/pick';
import { useSession } from '@/state/session';

type GalleryItem = MediaItemView & { pendingUserIds?: readonly UserId[] };

const CFG = { ...DEFAULT_TRUST_CONFIG, ...DEFAULT_PHASE15_CONFIG };

export function GalleryScreen({ gameId }: { gameId: string }) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const theme = useTheme();
  const { profile } = useSession();
  const me = profile?.id ?? '';
  const { width } = useWindowDimensions();
  const game = useAsync(() => port.getGame(gameId), [port, gameId]);
  const media = useAsync(() => port.listGameMedia(gameId) as Promise<GalleryItem[]>, [port, gameId]);
  const people = useAsync(() => port.listParticipants(gameId), [port, gameId]);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const upload = useAction(async () => {
    const res = await pickMedia();
    if (res.status === 'unavailable') {
      toast(t('vault:upload.nativeSoon'));
      return null;
    }
    if (res.status === 'cancelled') return null;
    return uploadPickedMedia(port, gameId, res.file);
  });
  const g = game.data;
  const uploadWindow = g ? mediaUploadWindow(g, CFG) : null;
  const closesAt = uploadWindow ? Date.parse(uploadWindow.closesAt) : null;
  const left = useCountdown(closesAt);

  const byId = useMemo(() => new Map((people.data ?? []).map((p) => [p.userId, p])), [people.data]);
  if ((game.loading && !g) || (media.loading && !media.data)) {
    return (
      <Screen testID="screen.game.gallery" title={t('vault:gallery.title')} backFallback={`/game/${gameId}`}>
        <Skeleton kind="block" rows={3} height={120} />
      </Screen>
    );
  }
  if (!g || !media.data) {
    return (
      <Screen testID="screen.game.gallery" title={t('vault:gallery.title')} backFallback={`/game/${gameId}`}>
        <ErrorView error={game.error ?? media.error} onRetry={() => void Promise.all([game.reload(), media.reload()])} />
      </Screen>
    );
  }

  const now = Date.now();
  const started = now >= Date.parse(g.startsAt);
  const openNow = started && left > 0;
  const verified = g.myParticipation?.status === 'approved' && g.myParticipation.attendance === 'verified';
  const items = media.data.filter((m) => filter === 'all' || m.uploaderId === me);
  const mine = media.data.filter((m) => m.uploaderId === me).length;
  const cols = width >= 768 ? 4 : 3;
  const gutter = width >= 768 ? spacing.xl : spacing.lg;
  const tile = Math.floor((Math.min(width, 720 + 2 * gutter) - 2 * gutter - (cols - 1) * 4) / cols);
  const selected = media.data.find((m) => m.id === open) ?? null;
  const windowMs = (Date.parse(g.endsAt) - Date.parse(g.startsAt)) + CFG.mediaUploadAfterEndHours * 3_600_000;
  const uploadError = upload.error ? (isStError(upload.error) && upload.error.details?.reason ? t(`vault:reject.${String(upload.error.details.reason)}`) : null) : null;

  const onUpload = async () => {
    const id = await upload.run();
    if (id) {
      Haptics.success();
      toast(t('vault:upload.done'), 'success');
      await media.reload();
      setOpen(id);
    }
  };

  return (
    <Screen
      testID="screen.game.gallery"
      large
      title={t('vault:gallery.title')}
      eyebrow={g.title}
      backFallback={`/game/${gameId}`}
      contentStyle={{ gap: spacing.lg }}
      footer={
        openNow ? (
          <>
            {uploadError ? (
              <Text variant="footnote" color="dangerText" testID="gallery.upload.error" aria-live="polite">
                {uploadError}
              </Text>
            ) : (
              <InlineError error={upload.error} />
            )}
            <Button
              testID="gallery.upload"
              size="lg"
              fullWidth
              icon="UploadSimple"
              label={t('vault:upload.cta')}
              loading={upload.busy}
              loadingLabel={t('vault:upload.uploading')}
              disabled={!verified}
              onPress={() => void onUpload()}
            />
            {!verified ? (
              <Text variant="footnote" color="textSecondary" align="center" testID="gallery.upload.gate">
                {t('vault:upload.checkInFirst')}
              </Text>
            ) : null}
          </>
        ) : undefined
      }
    >
      <View
        testID="gallery.window"
        aria-live="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.md,
          paddingEnd: spacing.lg,
          borderRadius: radius.lg,
          backgroundColor: openNow ? theme.colors.primarySubtle : theme.colors.surfaceSunken,
        }}
      >
        <ProgressRing progress={openNow ? left / Math.max(1, windowMs) : 0} size={48} thickness={5} color={openNow ? 'primary' : 'textTertiary'} trackColor={theme.colors.surface} animated={false}>
          <Icon name={openNow ? 'ClockCountdown' : 'LockSimple'} size={20} weight="fill" color={openNow ? 'primary' : 'textTertiary'} />
        </ProgressRing>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline" color={openNow ? 'onPrimarySubtle' : 'text'} testID="gallery.countdown">
            {!started
              ? t('vault:gallery.opensAt', { time: isolate(formatTime(g.startsAt, locale), 'ltr') })
              : openNow
                ? t('vault:gallery.locksIn', { time: isolate(clockLabel(left), 'ltr') })
                : t('vault:gallery.locked')}
          </Text>
          <Text variant="footnote" color="textSecondary">
            {openNow ? t('vault:gallery.windowHelp', { hours: CFG.mediaUploadAfterEndHours }) : t('vault:gallery.retention', { months: CFG.mediaRetentionMonths })}
          </Text>
        </View>
      </View>

      {media.data.length ? (
        <Segmented
          testID="gallery.filter"
          label={t('vault:gallery.filterA11y')}
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('vault:gallery.all'), count: media.data.length, testID: 'gallery.filter.all' },
            { value: 'mine', label: t('vault:gallery.mine'), count: mine, testID: 'gallery.filter.mine' },
          ]}
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          testID="gallery.empty"
          illustration="success"
          title={filter === 'mine' ? t('vault:gallery.emptyMineTitle') : t('vault:gallery.emptyTitle')}
          body={openNow ? t('vault:gallery.emptyBodyOpen') : t('vault:gallery.emptyBodyClosed')}
        />
      ) : (
        <View testID="gallery.grid" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {items.map((m, i) => (
            <Tile key={m.id} item={m} size={tile} index={i} me={me} uploader={byId.get(m.uploaderId)?.profile.displayName ?? ''} onPress={() => setOpen(m.id)} />
          ))}
        </View>
      )}

      {selected ? (
        <MediaViewer
          item={selected}
          me={me}
          isHost={g.isHost}
          participants={people.data ?? []}
          onClose={() => setOpen(null)}
          onChanged={async () => {
            await media.reload();
          }}
          onDeleted={async () => {
            setOpen(null);
            await media.reload();
          }}
        />
      ) : null}
    </Screen>
  );
}

function Tile({ item, size, index, me, uploader, onPress }: { item: GalleryItem; size: number; index: number; me: string; uploader: string; onPress: () => void }) {
  const { t } = useT();
  const theme = useTheme();
  const pending = item.uploaderId === me && (item.pendingUserIds?.length ?? 0) > 0;
  const label = [t('vault:viewer.photoBy', { name: uploader }), item.visibility === 'venue_public' ? t('vault:badge.public') : null, pending ? t('vault:badge.pending') : null]
    .filter(Boolean)
    .join('. ');
  return (
    <Pressable
      testID={`gallery.item.${index}`}
      role="button"
      aria-label={label}
      onPress={() => {
        Haptics.selection();
        onPress();
      }}
      style={(st) => {
        const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
        return {
          width: size,
          height: size,
          borderRadius: 12,
          overflow: 'hidden',
          opacity: pressed ? 0.85 : 1,
          ...(focusVisible(focused) ? ({ outlineColor: theme.colors.focusRing, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 2 } as object) : null),
        };
      }}
    >
      <MediaImage uri={item.thumbnailUrl ?? item.url} width={size} height={size} />
      <View pointerEvents="none" style={{ position: 'absolute', top: 6, bottom: 6, start: 6, end: 6, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 4 }}>
          {item.uploaderId === me ? <Badge icon="User" /> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {item.visibility === 'venue_public' ? <Badge icon="GlobeHemisphereWest" /> : null}
          {pending ? <Badge icon="Hourglass" /> : null}
          {item.acceptedTags.length ? <Badge icon="Tag" count={item.acceptedTags.length} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function Badge({ icon, count }: { icon: 'User' | 'GlobeHemisphereWest' | 'Hourglass' | 'Tag'; count?: number }) {
  return (
    <View aria-hidden style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 22, minWidth: 22, paddingStart: 5, paddingEnd: count ? 6 : 5, borderRadius: 11, backgroundColor: 'rgba(11, 10, 28, 0.62)', justifyContent: 'center' }}>
      <Icon name={icon} size={12} weight="fill" color="#FFFFFF" />
      {count ? (
        <Text variant="caption" weight="bold" style={{ color: '#FFFFFF', fontSize: 11, lineHeight: 14 }}>
          {isolate(String(count), 'ltr')}
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ viewer */

function MediaViewer({
  item,
  me,
  isHost,
  participants,
  onClose,
  onChanged,
  onDeleted,
}: {
  item: GalleryItem;
  me: string;
  isHost: boolean;
  participants: ParticipantView[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [tagging, setTagging] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<MediaReportReason | null>(null);
  const [deleting, setDeleting] = useState(false);
  const mine = item.uploaderId === me;
  const byId = new Map(participants.map((p) => [p.userId, p]));
  const uploader = byId.get(item.uploaderId)?.profile;
  const pending = item.pendingUserIds ?? [];
  const taggedMe = item.acceptedTags.includes(me);
  const visibility = useAction((v: boolean) => port.setMediaVisibility(item.id, v ? 'venue_public' : 'participants'));
  const tag = useAction((ids: string[]) => port.tagMedia(item.id, ids));
  const untag = useAction(() => port.untagMe(item.id, true));
  const del = useAction(() => port.deleteMedia(item.id));
  const report = useAction((r: MediaReportReason) => reportMedia(port, item.id, r));
  const already = new Set([...item.acceptedTags, ...pending]);
  const candidates = participants.filter((p) => p.status === 'approved' && p.userId !== me && !already.has(p.userId));
  const name = (id: string) => byId.get(id)?.profile.displayName ?? t('vault:viewer.someone');
  const imageW = Math.min(width, 560) - 2 * spacing.lg;
  const error = visibility.error ?? tag.error ?? untag.error ?? del.error ?? (report.error && !(isStError(report.error) && report.error.code === 'already_reported') ? report.error : null);

  return (
    <SheetModal visible testID="gallery.viewer" title={t('vault:viewer.title')} onClose={onClose} closeLabel={t('common:actions.close')} start={<Button variant="ghost" size="sm" label={t('common:actions.done')} onPress={onClose} testID="gallery.viewer.close" />}>
      <MediaImage uri={item.url} width={imageW} height={Math.round((imageW * 3) / 4)} radius={radius.lg} label={t('vault:viewer.photoBy', { name: uploader?.displayName ?? '' })} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Avatar name={uploader?.displayName ?? '?'} uri={uploader?.avatarUrl} size="md" decorative />
        <View style={{ flex: 1, gap: 2 }}>
          <BidiText variant="headline" numberOfLines={1}>
            {uploader?.displayName ?? t('vault:viewer.someone')}
          </BidiText>
          <Text variant="footnote" color="textSecondary">
            {formatRelative(item.publishedAt ?? item.createdAt, locale)}
          </Text>
        </View>
        {item.visibility === 'venue_public' ? <StatusPill tone="info" icon="GlobeHemisphereWest" label={t('vault:badge.public')} /> : <StatusPill icon="UsersThree" label={t('vault:badge.participants')} />}
      </View>

      <View style={{ gap: spacing.sm }} testID="gallery.viewer.tags">
        <Text variant="overline" color="textTertiary">
          {t('vault:tags.title')}
        </Text>
        {item.acceptedTags.length || (mine && pending.length) ? (
          <View style={{ gap: spacing.sm }}>
            {item.acceptedTags.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <AvatarStack people={item.acceptedTags.map((id) => ({ name: name(id), uri: byId.get(id)?.profile.avatarUrl }))} size="sm" label={item.acceptedTags.map(name).join(', ')} />
                <Text variant="footnote" color="textSecondary" style={{ flex: 1 }} numberOfLines={2}>
                  {item.acceptedTags.map(name).join(', ')}
                </Text>
              </View>
            ) : null}
            {mine && pending.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} testID="gallery.viewer.pending">
                <Icon name="Hourglass" size={16} weight="fill" color="warningText" />
                <Text variant="footnote" color="warningText" style={{ flex: 1 }}>
                  {t('vault:tags.waiting', { names: pending.map(name).join(', '), count: pending.length })}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Text variant="footnote" color="textSecondary">
            {t('vault:tags.none')}
          </Text>
        )}
        {mine ? (
          tagging ? (
            <View style={{ gap: spacing.sm }} testID="gallery.tagger">
              {candidates.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {candidates.map((p) => (
                    <ChoiceChip
                      key={p.userId}
                      testID={`gallery.tag.${p.userId}`}
                      label={p.profile.displayName}
                      selected={picked.includes(p.userId)}
                      onToggle={() => setPicked((prev) => (prev.includes(p.userId) ? prev.filter((x) => x !== p.userId) : [...prev, p.userId]))}
                    />
                  ))}
                </View>
              ) : (
                <Text variant="footnote" color="textSecondary">
                  {t('vault:tags.everyoneTagged')}
                </Text>
              )}
              <Text variant="caption" color="textTertiary">
                {t('vault:tags.requestHelp')}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button
                  testID="gallery.tag.save"
                  icon="Tag"
                  label={t('vault:tags.send', { count: picked.length })}
                  disabled={!picked.length}
                  loading={tag.busy}
                  onPress={async () => {
                    const res = await tag.run(picked);
                    if (res) {
                      toast(t('vault:tags.sent', { count: res.length }), 'success');
                      setTagging(false);
                      setPicked([]);
                      await onChanged();
                    }
                  }}
                />
                <Button variant="ghost" label={t('common:actions.cancel')} onPress={() => setTagging(false)} />
              </View>
            </View>
          ) : (
            <Button testID="gallery.viewer.tag" variant="secondary" icon="Tag" label={t('vault:tags.add')} onPress={() => setTagging(true)} style={{ alignSelf: 'flex-start' }} />
          )
        ) : null}
      </View>

      {mine ? (
        <View style={{ gap: spacing.sm }}>
          <View style={{ borderRadius: radius.lg, overflow: 'hidden', ...theme.elevation(1) }}>
            <SwitchRow
              testID="gallery.viewer.public"
              icon="GlobeHemisphereWest"
              tone="info"
              label={t('vault:public.label')}
              help={pending.length ? t('vault:public.blocked', { count: pending.length }) : item.visibility === 'venue_public' ? t('vault:public.on') : t('vault:public.help')}
              value={item.visibility === 'venue_public'}
              disabled={visibility.busy || (pending.length > 0 && item.visibility !== 'venue_public')}
              onChange={async (v) => {
                const res = await visibility.run(v);
                if (res) {
                  toast(res.visibility === 'venue_public' ? t('vault:public.done') : t('vault:public.off'), 'success');
                  await onChanged();
                }
              }}
            />
          </View>
          {pending.length ? (
            <Text variant="caption" color="textTertiary" testID="gallery.viewer.public.why" style={{ paddingStart: spacing.lg }}>
              {t('vault:public.why')}
            </Text>
          ) : null}
        </View>
      ) : null}

      <InlineError error={error} />

      <View style={{ gap: spacing.sm }}>
        {taggedMe && !mine ? (
          <Button
            testID="gallery.viewer.untag"
            variant="outline"
            icon="UserMinus"
            label={t('vault:tags.untagMe')}
            loading={untag.busy}
            onPress={async () => {
              const res = await untag.run();
              if (res) {
                toast(t('vault:tags.untagged'));
                await onChanged();
              }
            }}
          />
        ) : null}
        {!mine ? (
          reporting ? (
            <View style={{ gap: spacing.sm }} testID="gallery.report.form">
              <Text variant="headline">{t('vault:report.title')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} role="radiogroup">
                {MEDIA_REPORT_REASONS.map((r) => (
                  <ChoiceChip key={r} testID={`gallery.report.reason.${r}`} selectionRole="radio" label={t(`vault:report.reason.${r}`)} selected={reason === r} onToggle={() => setReason(r)} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button
                  testID="gallery.report.submit"
                  variant="danger"
                  label={t('vault:report.submit')}
                  disabled={!reason}
                  loading={report.busy}
                  onPress={async () => {
                    if (!reason) return;
                    await report.run(reason);
                    setReporting(false);
                    toast(t('vault:report.thanks'), 'success');
                  }}
                />
                <Button variant="ghost" label={t('common:actions.cancel')} onPress={() => setReporting(false)} />
              </View>
            </View>
          ) : (
            <Button testID="gallery.viewer.report" variant="ghost" icon="Flag" label={t('vault:report.cta')} onPress={() => setReporting(true)} style={{ alignSelf: 'flex-start' }} />
          )
        ) : null}
        {mine || isHost ? (
          mine ? (
            <Button testID="gallery.viewer.delete" variant="ghost" icon="Trash" label={t('vault:viewer.delete')} onPress={() => setDeleting(true)} style={{ alignSelf: 'flex-start' }} />
          ) : null
        ) : null}
      </View>

      <ConfirmDialog
        testID="gallery.deleteDialog"
        visible={deleting}
        icon="Trash"
        title={t('vault:viewer.deleteTitle')}
        body={t('vault:viewer.deleteBody')}
        confirmLabel={t('vault:viewer.delete')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        busy={del.busy}
        onConfirm={async () => {
          await del.run();
          setDeleting(false);
          toast(t('vault:viewer.deleted'));
          await onDeleted();
        }}
        onCancel={() => setDeleting(false)}
      />
    </SheetModal>
  );
}
