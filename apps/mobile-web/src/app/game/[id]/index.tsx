/**
 * Game details (design v2 §15.4): sport-gradient hero (back/share, sport, title, big tabular
 * time, day · relative), an overlapping facts strip (players ring, starts, duration + deposit /
 * waitlist / women-only / private pills), the venue with a mini map chip, the host card with a
 * reliability ring, and players (AvatarStack that expands). Hosts also see requests with quick
 * approve/reject and the waitlist. A blurred sticky footer carries the one primary action for the
 * viewer's state plus labelled secondary actions (chat, directions, share, teams, QR…).
 */
import {
  DEFAULT_TRUST_CONFIG,
  canSubmitResult,
  isCheckInOpen,
  isLateCancel,
  type GameDetail,
} from '@st/domain';
import { BidiText, Button, Card, Haptics, Icon, isolate, spacing, Text, useTheme, type IconName, type PillTone } from '@st/ui';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Linking, Platform, Share, View } from 'react-native';

import { ActionTile } from '@/components/ActionTile';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { gameTiming } from '@/components/GameCard';
import { Screen } from '@/components/Screen';
import { Banner, ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { FactsStrip, GameHero, HostCard, PlayersSection, RequestsSection, VenueCardRow, WaitlistSection } from '@/features/game/DetailsParts';
import { hasActiveOffer, WaitlistOffer } from '@/features/game/WaitlistOffer';
import { directionsUrl } from '@/features/map/VenueDetails';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatDateTime, formatMoney, formatTime } from '@/lib/format';

const ORIGIN = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://sporttalent.app';

export default function GameDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const gameId = String(id);
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const now = useNow(30_000);
  const { colors } = useTheme();

  const game = useAsync(() => port.getGame(gameId), [port, gameId]);
  const participants = useAsync(() => port.listParticipants(gameId), [port, gameId], !!game.data);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmCancelGame, setConfirmCancelGame] = useState(false);
  const [deposit, setDeposit] = useState<{ amount: string } | null>(null);

  const reloadGame = game.reload;
  const reloadParticipants = participants.reload;
  const refresh = useCallback(async () => {
    await Promise.all([reloadGame(), reloadParticipants()]);
  }, [reloadGame, reloadParticipants]);

  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focused.current) {
        focused.current = true;
        return;
      }
      void refresh();
    }, [refresh]),
  );

  const join = useAction(async (g: GameDetail) => port.requestJoin(g.id));
  const cancel = useAction(async () => port.cancelParticipation(gameId));
  const decide = useAction(async (userId: string, decision: 'approve' | 'reject') => port.decideJoin(gameId, userId, decision));
  const cancelGame = useAction(async () => port.cancelGame(gameId));

  if (game.loading && !game.data) {
    return (
      <Screen testID="screen.game" backFallback="/map">
        <Skeleton kind="hero" />
      </Screen>
    );
  }
  if (game.error || !game.data) {
    return (
      <Screen testID="screen.game" backFallback="/map">
        {game.error ? (
          <ErrorView error={game.error} onRetry={() => void game.reload()} />
        ) : (
          <Banner testID="game.notFound" text={t('errors:not_found')} tone="warning" />
        )}
      </Screen>
    );
  }

  const g = game.data;
  const me = g.myParticipation;
  const { live } = gameTiming(g, now);
  const ended = Date.parse(g.endsAt) <= now;
  const cancelled = g.status === 'cancelled';
  const full = g.approvedCount >= g.capacity;
  const depositAmount = g.depositMinor > 0 ? formatMoney(g.depositMinor, g.currency, locale) : null;
  const list = participants.data ?? [];
  const approved = list.filter((p) => p.status === 'approved');
  const requested = list.filter((p) => p.status === 'requested');
  const waitlisted = list.filter((p) => p.status === 'waitlisted').sort((a, b) => (a.waitlistRank ?? 0) - (b.waitlistRank ?? 0));
  const checkInOpen = isCheckInOpen(g, now, DEFAULT_TRUST_CONFIG);
  const lateNow = isLateCancel(g.startsAt, new Date(now).toISOString(), DEFAULT_TRUST_CONFIG);
  const freeUntil = new Date(Date.parse(g.startsAt) - DEFAULT_TRUST_CONFIG.lateCancelWindowHours * 3600_000).toISOString();
  const location = g.location ?? g.approxLocation;
  const inviteUrl = g.inviteToken ? `${ORIGIN}/invite/${g.inviteToken}` : null;
  const shareUrl = inviteUrl ?? `${ORIGIN}/game/${g.id}`;
  const offer = me?.status === 'waitlisted' && hasActiveOffer(me, now);

  const openDirections = () => void Linking.openURL(directionsUrl(location.lat, location.lng, g.venue?.name ?? g.title));
  const share = async () => {
    const message = `${g.title} · ${formatDateTime(g.startsAt, locale)}`;
    if (Platform.OS !== 'web') {
      await Share.share({ message: `${message}\n${shareUrl}`, url: shareUrl }).catch(() => undefined);
      return;
    }
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : null;
    if (nav?.share) {
      await nav.share({ title: g.title, text: message, url: shareUrl }).catch(() => undefined);
      return;
    }
    await Clipboard.setStringAsync(shareUrl);
    toast(t('games:wizard.published.linkCopied'), 'success');
  };

  const onJoin = async () => {
    const res = await join.run(g);
    if (!res) return;
    toast(t('games:details.outcome.requestSent'), 'success');
    if (res.deposit) setDeposit({ amount: formatMoney(res.deposit.amount.amountMinor, res.deposit.amount.currency, locale) });
    await refresh();
  };

  const onCancelSpot = async () => {
    const res = await cancel.run();
    setConfirmCancel(false);
    if (!res) return;
    toast(res.participant.lateCancel ? t('games:details.cancel.lateRecorded') : t('games:details.cancel.done'));
    await refresh();
  };

  const onDecide = async (userId: string, decision: 'approve' | 'reject') => {
    const res = await decide.run(userId, decision);
    if (res) {
      if (decision === 'approve') Haptics.success();
      else Haptics.selection();
      toast(
        decision === 'reject'
          ? t('games:details.host.rejected')
          : res.status === 'waitlisted'
            ? t('games:details.host.waitlisted')
            : t('games:details.host.approved'),
        decision === 'approve' ? 'success' : 'neutral',
      );
      await refresh();
    }
  };

  const onCancelGame = async () => {
    const res = await cancelGame.run();
    setConfirmCancelGame(false);
    if (res) {
      toast(t('games:details.banner.cancelledNoReason'));
      await refresh();
    }
  };

  const actionError = join.error ?? cancel.error ?? decide.error ?? cancelGame.error;

  // ------------------------------------------------------------------ hero status pill
  const heroStatus: { label: string; tone?: PillTone; icon?: IconName } | null = cancelled
    ? { label: t('games:my.state.cancelled'), icon: 'XCircle' }
    : live
      ? { label: t('map:card.live'), tone: 'live' }
      : ended
        ? { label: t('games:details.facts.over'), icon: 'Flag' }
        : g.isHost
          ? { label: t('games:my.state.hosting'), icon: 'Strategy' }
          : me?.status === 'approved'
            ? { label: t('games:my.state.going'), icon: 'CheckCircle' }
            : full
              ? { label: t('map:card.badge.full'), icon: 'LockSimple' }
              : null;

  // ------------------------------------------------------------------ sticky footer
  const actionsRow = (children: ReactNode) => <View style={{ flexDirection: 'row', justifyContent: 'space-around', gap: spacing.xs }}>{children}</View>;
  const statusLine = (icon: IconName, text: string, testID: string, action: ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySubtle }}>
        <Icon name={icon} size={22} weight="duotone" color="onPrimarySubtle" />
      </View>
      <Text variant="headline" style={{ flex: 1 }} testID={testID} aria-live="polite">
        {text}
      </Text>
      {action}
    </View>
  );

  let footer: ReactNode = null;
  if (!cancelled && !ended) {
    if (g.isHost) {
      footer = (
        <>
          <Button testID="game.host.qr" size="lg" fullWidth icon="QrCode" label={t('games:details.host.showQr')} onPress={() => router.push(`/game/${g.id}/qr`)} />
          {actionsRow(
            <>
              <ActionTile testID="game.host.teams" icon="UsersThree" label={t('games:details.host.teams')} onPress={() => router.push(`/game/${g.id}/teams`)} />
              <ActionTile testID="game.chat" icon="ChatsCircle" label={t('games:details.action.chat')} onPress={() => router.push(`/game/${g.id}/chat`)} />
              <ActionTile testID="game.footer.share" icon="ShareNetwork" label={t('common:actions.share')} onPress={() => void share()} />
              <ActionTile testID="game.directions" icon="NavigationArrow" label={t('games:details.action.directions')} onPress={openDirections} />
            </>,
          )}
        </>
      );
    } else if (!me || me.status === 'cancelled') {
      footer = (
        <>
          {depositAmount ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs }}>
              <Icon name="Coins" size={16} weight="fill" color="warningText" />
              <Text variant="footnote" color="textSecondary" testID="game.deposit.disclosure">
                {t('games:details.deposit.disclosure', { amount: depositAmount })}
              </Text>
            </View>
          ) : null}
          <Button
            testID="game.join"
            size="lg"
            fullWidth
            icon={full ? 'Hourglass' : 'Lightning'}
            haptic="joinGame"
            loading={join.busy}
            label={full ? t('games:details.action.joinWaitlist', { position: g.waitlistCount + 1 }) : t('games:details.action.request')}
            accessibilityHint={t('games:details.action.requestHint')}
            onPress={() => void onJoin()}
            disabled={live}
          />
        </>
      );
    } else if (me.status === 'requested') {
      footer = statusLine(
        'Hourglass',
        t('games:details.action.waitingForHost'),
        'game.status.requested',
        <Button testID="game.cancelRequest" variant="outline" label={t('games:details.action.cancelRequest')} loading={cancel.busy} onPress={() => void onCancelSpot()} />,
      );
    } else if (me.status === 'waitlisted') {
      footer = offer ? (
        <Button testID="game.leaveWaitlist" variant="ghost" fullWidth label={t('games:details.action.leaveWaitlist')} loading={cancel.busy} onPress={() => void onCancelSpot()} />
      ) : (
        statusLine(
          'Hourglass',
          t('games:details.action.waitlistPosition', { position: me.waitlistRank ?? 1 }),
          'game.waitlist.position',
          <Button testID="game.leaveWaitlist" variant="outline" label={t('games:details.action.leaveWaitlist')} loading={cancel.busy} onPress={() => void onCancelSpot()} />,
        )
      );
    } else if (me.status === 'approved') {
      const checkedIn = me.attendance === 'verified';
      footer = (
        <>
          <Button
            testID="game.checkin"
            size="lg"
            fullWidth
            variant={live && checkInOpen && !checkedIn ? 'accent' : 'primary'}
            icon={checkedIn ? 'CheckCircle' : 'MapPin'}
            label={
              checkedIn
                ? t('games:details.checkedIn')
                : checkInOpen
                  ? t('games:details.action.checkIn')
                  : t('games:details.action.checkInOpens', { time: isolate(formatTime(new Date(Date.parse(g.startsAt) - DEFAULT_TRUST_CONFIG.checkInOpensMinutesBeforeStart * 60_000).toISOString(), locale), 'ltr') })
            }
            disabled={!checkInOpen || checkedIn}
            onPress={() => router.push(`/game/${g.id}/checkin`)}
          />
          {actionsRow(
            <>
              <ActionTile testID="game.chat" icon="ChatsCircle" label={t('games:details.action.chat')} onPress={() => router.push(`/game/${g.id}/chat`)} />
              <ActionTile testID="game.directions" icon="NavigationArrow" label={t('games:details.action.directions')} onPress={openDirections} />
              <ActionTile testID="game.footer.share" icon="ShareNetwork" label={t('common:actions.share')} onPress={() => void share()} />
              <ActionTile testID="game.cantMakeIt" icon="SignOut" tone="danger" label={t('games:details.action.cantMakeIt')} onPress={() => setConfirmCancel(true)} />
            </>,
          )}
        </>
      );
    }
  } else if (ended && !cancelled && (g.isHost || me?.status === 'approved') && canSubmitResult(g, now, DEFAULT_TRUST_CONFIG)) {
    footer = <Button testID="game.result" size="lg" fullWidth icon="Trophy" label={t('games:details.host.enterResult')} onPress={() => router.push(`/game/${g.id}/result`)} />;
  }

  return (
    <Screen
      testID="screen.game"
      backFallback="/map"
      footer={footer}
      hero={<GameHero game={g} now={now} live={live} status={heroStatus} onShare={() => void share()} />}
      contentStyle={{ gap: spacing.xl, marginTop: -(spacing.xxl + spacing.xs) }}
    >
      <FactsStrip game={g} now={now} live={live} depositAmount={depositAmount} />

      {cancelled ? <Banner testID="game.banner.cancelled" tone="danger" icon="CalendarX" text={t('games:details.banner.cancelledNoReason')} /> : null}
      {ended && !cancelled ? <Banner testID="game.banner.ended" icon="Flag" text={t('games:details.banner.ended')} /> : null}
      {offer && me ? <WaitlistOffer gameId={g.id} participant={me} onAccepted={() => void refresh()} /> : null}
      {g.isHost && requested.length ? (
        <Banner testID="game.host.pending" tone="brand" icon="UserPlus" text={t('games:details.host.pendingCount', { count: requested.length })} />
      ) : null}
      <InlineError error={actionError} />

      <VenueCardRow game={g} onDirections={openDirections} />
      <HostCard game={g} />

      {g.notes ? (
        <Card variant="filled" padding="lg">
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Icon name="ChatCircleText" size={20} weight="duotone" color="textSecondary" />
            <BidiText variant="callout" mode="block" style={{ flex: 1 }}>
              {g.notes}
            </BidiText>
          </View>
        </Card>
      ) : null}

      {g.isHost && inviteUrl ? (
        <Card padding="lg">
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySubtle }}>
                <Icon name="LinkSimple" size={22} weight="bold" color="onPrimarySubtle" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="headline">{t('games:wizard.published.shareTitle')}</Text>
                <BidiText variant="footnote" color="textSecondary" direction="ltr" numberOfLines={1} testID="game.invite.url">
                  {inviteUrl}
                </BidiText>
              </View>
            </View>
            <Button
              testID="game.invite.copy"
              variant="secondary"
              icon="Copy"
              fullWidth
              label={t('games:wizard.published.copyLink')}
              onPress={async () => {
                await Clipboard.setStringAsync(inviteUrl);
                Haptics.selection();
                toast(t('games:wizard.published.linkCopied'), 'success');
              }}
            />
          </View>
        </Card>
      ) : null}

      {participants.loading && !participants.data ? (
        <Skeleton kind="row" rows={3} />
      ) : (
        <View style={{ gap: spacing.xl }}>
          {g.isHost ? <RequestsSection requests={requested} busy={decide.busy} onDecide={(u, d) => void onDecide(u, d)} /> : null}
          <PlayersSection
            game={g}
            players={approved}
            hint={!g.isHost && me?.status !== 'approved' && approved.length <= 1 ? t('games:details.playersAfterJoin') : null}
          />
          <WaitlistSection waitlist={waitlisted} />
        </View>
      )}

      {g.isHost && !cancelled && !ended ? (
        <Button testID="game.host.cancel" variant="ghost" icon="CalendarX" fullWidth label={t('games:details.host.cancelGame')} onPress={() => setConfirmCancelGame(true)} />
      ) : null}

      <ConfirmDialog
        testID="game.cancelDialog"
        visible={confirmCancel}
        title={t('games:details.cancel.title')}
        body={
          lateNow
            ? t('games:details.cancel.lateWarning', { hours: DEFAULT_TRUST_CONFIG.lateCancelWindowHours })
            : t('games:details.cancel.freeUntil', { time: isolate(formatDateTime(freeUntil, locale), 'ltr') })
        }
        confirmLabel={t('games:details.cancel.confirm')}
        cancelLabel={t('games:details.cancel.keep')}
        destructive
        busy={cancel.busy}
        onConfirm={() => void onCancelSpot()}
        onCancel={() => setConfirmCancel(false)}
      />
      <ConfirmDialog
        testID="game.cancelGameDialog"
        visible={confirmCancelGame}
        title={t('games:details.host.cancelConfirm')}
        body={t('games:details.host.cancelHelp')}
        confirmLabel={t('games:details.host.cancelConfirm')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        icon="CalendarX"
        busy={cancelGame.busy}
        onConfirm={() => void onCancelGame()}
        onCancel={() => setConfirmCancelGame(false)}
      />
      <ConfirmDialog
        testID="payment.deposit"
        visible={!!deposit}
        icon="Coins"
        title={t('games:details.deposit.sheetTitle')}
        body={deposit ? t('games:details.deposit.body', { amount: deposit.amount, time: isolate(formatDateTime(new Date(Date.parse(g.startsAt) - DEFAULT_TRUST_CONFIG.depositHoldLeadHours * 3600_000).toISOString(), locale), 'ltr') }) : undefined}
        confirmLabel={t('games:details.deposit.continue')}
        cancelLabel={t('common:actions.notNow')}
        onConfirm={() => {
          setDeposit(null);
          toast(t('games:details.deposit.saved'), 'success');
        }}
        onCancel={() => setDeposit(null)}
      />
    </Screen>
  );
}
