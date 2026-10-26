/**
 * "Invite your WhatsApp group" (PRD §5.4, GAME-030/031). WhatsApp has no API for group members,
 * so the move is link based: the host previews the rich message exactly as the group will see it
 * (a chat bubble with the link card), then shares it to WhatsApp (wa.me), copies the link, uses
 * the system share sheet or shows a QR. Series show how many moved so far; the link can be reset.
 */
import { waMeUrl, type InviteTarget } from '@st/domain';
import { BidiText, Button, Card, Gradient, Haptics, Icon, isolate, radius, spacing, sportColors, Text, useTheme } from '@st/ui';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Linking, Platform, Share, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Screen } from '@/components/Screen';
import { ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { formatNumber, formatTime } from '@/lib/format';

import { cadenceLabel, dayLabel, timeIn } from '@/features/series/format';

import { linkFor, renderShareMessage } from './shareText';

const WA_GREEN = '#25D366';

export function InviteGroupScreen({ target }: { target: InviteTarget }) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const theme = useTheme();
  const [showQr, setShowQr] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const key = target.kind === 'game' ? target.gameId : target.seriesId;
  const link = useAsync(() => port.getInviteLink(target), [port, key]);
  const message = useAsync(() => port.getShareMessage(target, locale), [port, key, locale, link.data?.token]);
  const stats = useAsync(() => port.getMigrationStats(target), [port, key], target.kind === 'series');
  const rotate = useAction(() => port.rotateInviteLink(target));

  const back = target.kind === 'game' ? (`/game/${target.gameId}` as const) : (`/series/${target.seriesId}` as const);
  const title = t('invite:group.title');

  if ((link.loading && !link.data) || (message.loading && !message.data)) {
    return (
      <Screen testID="screen.invite.group" title={title} backFallback={back}>
        <Skeleton kind="block" rows={3} height={140} />
      </Screen>
    );
  }
  const error = link.error ?? message.error;
  if (error || !link.data || !message.data) {
    return (
      <Screen testID="screen.invite.group" title={title} backFallback={back}>
        <ErrorView error={error} onRetry={() => void Promise.all([link.reload(), message.reload()])} />
      </Screen>
    );
  }

  const url = linkFor(target, link.data.token);
  const text = renderShareMessage(message.data, t, locale, url);
  const preview = link.data.preview;

  const openWhatsApp = async () => {
    Haptics.light();
    const wa = waMeUrl(text);
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(wa, '_blank', 'noopener');
    else await Linking.openURL(wa).catch(() => toast(t('invite:group.noWhatsApp'), 'error'));
  };
  const copy = async () => {
    await Clipboard.setStringAsync(url);
    Haptics.selection();
    toast(t('invite:group.copied'), 'success');
  };
  const more = async () => {
    if (Platform.OS !== 'web') {
      await Share.share({ message: text, url }).catch(() => undefined);
      return;
    }
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : null;
    if (nav?.share) await nav.share({ title: preview.title, text, url }).catch(() => undefined);
    else {
      await Clipboard.setStringAsync(text);
      toast(t('invite:group.messageCopied'), 'success');
    }
  };

  const when = preview.recurrence
    ? cadenceLabel({ recurrence: preview.recurrence, weekday: preview.weekday ?? 1, startTime: preview.localStartTime ?? '00:00' }, t, locale)
    : preview.startsAt
      ? `${dayLabel(preview.startsAt, locale, preview.timeZone ?? undefined)} · ${timeIn(preview.startsAt, locale, preview.timeZone ?? undefined)}`
      : '';

  return (
    <Screen
      testID="screen.invite.group"
      title={title}
      backFallback={back}
      contentStyle={{ gap: spacing.xl }}
      footer={
        <>
          <Button testID="invite.whatsapp" size="lg" fullWidth icon="WhatsappLogo" label={t('invite:group.whatsapp')} onPress={() => void openWhatsApp()} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button testID="invite.copy" variant="secondary" fullWidth icon="Copy" label={t('invite:group.copy')} onPress={() => void copy()} />
            </View>
            <View style={{ flex: 1 }}>
              <Button testID="invite.more" variant="secondary" fullWidth icon="ShareNetwork" label={t('invite:group.more')} onPress={() => void more()} />
            </View>
          </View>
        </>
      }
    >
      <View style={{ gap: spacing.sm }}>
        <Text variant="title1" role="heading" aria-level={1}>
          {t('invite:group.heading')}
        </Text>
        <Text variant="callout" color="textSecondary">
          {target.kind === 'series' ? t('invite:group.bodySeries') : t('invite:group.bodyGame')}
        </Text>
      </View>

      {target.kind === 'series' && stats.data ? (
        <View testID="invite.stats" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, paddingEnd: spacing.lg, borderRadius: radius.lg, backgroundColor: theme.colors.successSubtle }}>
          <View aria-hidden style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: WA_GREEN }}>
            <Icon name="UsersThree" size={20} weight="fill" color="#FFFFFF" />
          </View>
          <Text variant="callout" weight="semibold" color="successText" style={{ flex: 1 }}>
            {stats.data.joinedFromLink
              ? t('series:migration.joined', { count: stats.data.joinedFromLink })
              : t('invite:group.statsNone')}
          </Text>
          <Text variant="statSmall" color="successText">
            {isolate(formatNumber(stats.data.joinedFromLink, locale), 'ltr')}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <Text variant="overline" color="textTertiary" style={{ paddingStart: spacing.lg }}>
          {t('invite:group.previewTitle')}
        </Text>
        <WhatsAppPreview sport={preview.sport} title={preview.title} when={when} area={preview.areaLabel} text={text} url={url} />
      </View>

      <Card padding="lg" testID="invite.link">
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View aria-hidden style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primarySubtle }}>
              <Icon name="LinkSimple" size={22} weight="bold" color="onPrimarySubtle" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="headline">{t('invite:group.linkTitle')}</Text>
              <BidiText variant="footnote" color="textSecondary" direction="ltr" numberOfLines={1} testID="invite.url">
                {url}
              </BidiText>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button testID="invite.qr" variant="outline" fullWidth icon="QrCode" label={showQr ? t('invite:group.hideQr') : t('invite:group.showQr')} onPress={() => setShowQr((v) => !v)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button testID="invite.rotate" variant="ghost" fullWidth icon="ArrowClockwise" label={t('invite:group.rotate')} onPress={() => setConfirmRotate(true)} />
            </View>
          </View>
          {showQr ? (
            <View testID="invite.qr.code" style={{ alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm }}>
              <View style={{ padding: spacing.lg, borderRadius: radius.xl, backgroundColor: '#FFFFFF', ...theme.elevation(2) }}>
                <QRCode value={url} size={200} color="#0B0A1C" backgroundColor="#FFFFFF" ecl="M" />
              </View>
              <Text variant="footnote" color="textSecondary" align="center">
                {t('invite:group.qrHelp')}
              </Text>
            </View>
          ) : null}
          <InlineError error={rotate.error} />
        </View>
      </Card>

      <View style={{ gap: spacing.sm, paddingStart: spacing.sm, paddingEnd: spacing.sm }}>
        {(['step1', 'step2', 'step3'] as const).map((k, i) => (
          <View key={k} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <View aria-hidden style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken }}>
              <Text variant="caption" weight="bold" color="textSecondary">
                {isolate(String(i + 1), 'ltr')}
              </Text>
            </View>
            <Text variant="callout" color="textSecondary" style={{ flex: 1, paddingTop: 2 }}>
              {t(`invite:group.${k}`)}
            </Text>
          </View>
        ))}
      </View>

      <ConfirmDialog
        testID="invite.rotateDialog"
        visible={confirmRotate}
        icon="ArrowClockwise"
        title={t('invite:group.rotateTitle')}
        body={t('invite:group.rotateBody')}
        confirmLabel={t('invite:group.rotateConfirm')}
        cancelLabel={t('common:actions.cancel')}
        busy={rotate.busy}
        onConfirm={async () => {
          const res = await rotate.run();
          setConfirmRotate(false);
          if (res) {
            link.setData(res);
            toast(t('invite:group.rotated'), 'success');
          }
        }}
        onCancel={() => setConfirmRotate(false)}
      />
    </Screen>
  );
}

/** A WhatsApp-style outgoing bubble with the link card (OG image, title, host) above the text. */
function WhatsAppPreview({ sport, title, when, area, text, url }: { sport: string; title: string; when: string; area: string | null; text: string; url: string }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const wallpaper = dark ? '#0B141A' : '#EFE7DD';
  const bubble = dark ? '#005C4B' : '#D9FDD3';
  const ink = dark ? '#E9EDEF' : '#111B21';
  const meta = dark ? 'rgba(233,237,239,0.62)' : 'rgba(17,27,33,0.55)';
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return 'sporttalent.app';
    }
  })();
  const s = sportColors[sport as keyof typeof sportColors] ?? sportColors.football;
  return (
    <View testID="invite.preview" role="img" aria-label={`${t('invite:group.previewTitle')}: ${text}`} style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: wallpaper, padding: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.lg }}>
      <View aria-hidden style={{ alignSelf: 'center', paddingStart: spacing.md, paddingEnd: spacing.md, paddingTop: 4, paddingBottom: 4, borderRadius: radius.sm, backgroundColor: dark ? '#182229' : 'rgba(255,255,255,0.85)', marginBottom: spacing.md }}>
        <Text variant="caption" style={{ color: meta }}>
          {t('chat:day.today')}
        </Text>
      </View>
      <View aria-hidden style={{ alignSelf: 'flex-end', maxWidth: 330, width: '88%', backgroundColor: bubble, borderRadius: 14, borderTopEndRadius: 4, padding: 4, ...theme.elevation(1) }}>
        <View style={{ borderRadius: 10, overflow: 'hidden', backgroundColor: dark ? '#025144' : '#C6F2BD' }}>
          <Gradient name={sport as never} style={{ height: 118, padding: spacing.md, justifyContent: 'flex-end', overflow: 'hidden' }}>
            <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', opacity: 0.2 }}>
              <View style={{ marginEnd: -14 }}>
                <Icon name={s.phosphor} size={120} weight="fill" color="#FFFFFF" directional={false} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: '#5B3DF5', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#CCFF33' }} />
              </View>
              <Text variant="caption" weight="bold" color="textOnMedia">
                {t('common:app.name')}
              </Text>
            </View>
          </Gradient>
          <View style={{ padding: spacing.sm, paddingStart: spacing.md, paddingEnd: spacing.md, gap: 2 }}>
            <BidiText variant="label" weight="semibold" numberOfLines={2} style={{ color: ink }}>
              {t('invite:preview.title', { sport: t(`common:sports.${sport}`), title })}
            </BidiText>
            <Text variant="caption" numberOfLines={2} style={{ color: meta }}>
              {[when, area].filter(Boolean).join(' · ')}
            </Text>
            <Text variant="caption" numberOfLines={1} style={{ color: meta }}>
              {host}
            </Text>
          </View>
        </View>
        <BidiText variant="callout" mode="block" style={{ color: ink, paddingStart: 6, paddingEnd: 6, paddingTop: 6 }} testID="invite.preview.text">
          {text}
        </BidiText>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 3, paddingEnd: 6, paddingBottom: 2 }}>
          <Text variant="caption" style={{ color: meta, fontSize: 11 }}>
            {isolate(formatTime(new Date().toISOString(), locale), 'ltr')}
          </Text>
          <Icon name="Check" size={12} weight="bold" color="#53BDEB" />
        </View>
      </View>
    </View>
  );
}
