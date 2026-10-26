/**
 * Game details (design §13.6): header (sport, title, time, venue or hidden
 * location, host), facts, participants (host also sees requests and waitlist
 * with approve/reject), and a sticky primary action that follows the viewer's
 * state: request / waitlist / waiting / check in + chat + can't make it / host tools.
 */
import {
  DEFAULT_TRUST_CONFIG,
  canSubmitResult,
  isCheckInOpen,
  isLateCancel,
  type GameDetail,
  type ParticipantView,
} from '@st/domain';
import { Avatar, BidiText, Button, Card, Divider, isolate, Row, SportDot, Stack, Text, useTheme } from '@st/ui';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Linking, Platform, View } from 'react-native';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { gameTiming } from '@/components/GameCard';
import { Icon } from '@/components/Icon';
import { ParticipantRow } from '@/components/ParticipantRow';
import { ReliabilityBadge } from '@/components/ReliabilityBadge';
import { Screen } from '@/components/Screen';
import { Banner, ErrorView, InlineError, Skeleton } from '@/components/States';
import { Tag } from '@/components/Tag';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { hasActiveOffer, WaitlistOffer } from '@/features/game/WaitlistOffer';
import { directionsUrl } from '@/features/map/VenueDetails';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatDateTime, formatMoney, formatRelative, formatTime } from '@/lib/format';

export default function GameDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const gameId = String(id);
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const now = useNow(30_000);
  const theme = useTheme();

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
        <Skeleton rows={4} />
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
  const sport = t(`common:sports.${g.sport}`);
  const depositAmount = g.depositMinor > 0 ? formatMoney(g.depositMinor, g.currency, locale) : null;
  const list = participants.data ?? [];
  const approved = list.filter((p) => p.status === 'approved');
  const requested = list.filter((p) => p.status === 'requested');
  const waitlisted = list.filter((p) => p.status === 'waitlisted').sort((a, b) => (a.waitlistRank ?? 0) - (b.waitlistRank ?? 0));
  const checkInOpen = isCheckInOpen(g, now, DEFAULT_TRUST_CONFIG);
  const lateNow = isLateCancel(g.startsAt, new Date(now).toISOString(), DEFAULT_TRUST_CONFIG);
  const freeUntil = new Date(Date.parse(g.startsAt) - DEFAULT_TRUST_CONFIG.lateCancelWindowHours * 3600_000).toISOString();
  const location = g.location ?? g.approxLocation;
  const inviteUrl = g.inviteToken
    ? `${Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://sporttalent.app'}/invite/${g.inviteToken}`
    : null;

  const onJoin = async () => {
    const res = await join.run(g);
    if (!res) return;
    toast(t('games:details.outcome.requestSent'));
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
      toast(
        decision === 'reject'
          ? t('games:details.host.rejected')
          : res.status === 'waitlisted'
            ? t('games:details.host.waitlisted')
            : t('games:details.host.approved'),
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

  // ------------------------------------------------------------------ primary action
  let footer: ReactNode = null;
  if (!cancelled && !ended) {
    if (g.isHost) {
      footer = (
        <Row gap="sm" wrap>
          <Button testID="game.host.qr" label={t('games:details.host.showQr')} startIcon={<Icon name="qrcode-scan" size={20} color="onPrimary" />} onPress={() => router.push(`/game/${g.id}/qr`)} />
          <Button testID="game.host.teams" variant="secondary" label={t('games:details.host.teams')} onPress={() => router.push(`/game/${g.id}/teams`)} />
          <Button testID="game.chat" variant="secondary" label={t('games:details.action.chat')} onPress={() => router.push(`/game/${g.id}/chat`)} />
        </Row>
      );
    } else if (!me || me.status === 'cancelled') {
      footer = (
        <Stack gap="xs">
          {depositAmount ? (
            <Text variant="caption" color="textSecondary" testID="game.deposit.disclosure">
              {t('games:details.deposit.disclosure', { amount: depositAmount })}
            </Text>
          ) : null}
          <Button
            testID="game.join"
            size="lg"
            fullWidth
            loading={join.busy}
            label={full ? t('games:details.action.joinWaitlist', { position: g.waitlistCount + 1 }) : t('games:details.action.request')}
            accessibilityHint={t('games:details.action.requestHint')}
            onPress={() => void onJoin()}
            disabled={live}
          />
        </Stack>
      );
    } else if (me.status === 'requested') {
      footer = (
        <Row gap="sm" align="center">
          <Text variant="bodyStrong" style={{ flex: 1 }} testID="game.status.requested" accessibilityLiveRegion="polite">
            {t('games:details.action.waitingForHost')}
          </Text>
          <Button testID="game.cancelRequest" variant="secondary" label={t('games:details.action.cancelRequest')} loading={cancel.busy} onPress={() => void onCancelSpot()} />
        </Row>
      );
    } else if (me.status === 'waitlisted' && hasActiveOffer(me, now)) {
      footer = <WaitlistOffer gameId={g.id} participant={me} onAccepted={() => void refresh()} />;
    } else if (me.status === 'waitlisted') {
      footer = (
        <Row gap="sm" align="center">
          <Text variant="bodyStrong" style={{ flex: 1 }} testID="game.waitlist.position" accessibilityLiveRegion="polite">
            {t('games:details.action.waitlistPosition', { position: me.waitlistRank ?? 1 })}
          </Text>
          <Button testID="game.leaveWaitlist" variant="secondary" label={t('games:details.action.leaveWaitlist')} loading={cancel.busy} onPress={() => void onCancelSpot()} />
        </Row>
      );
    } else if (me.status === 'approved') {
      footer = (
        <Stack gap="sm">
          <Button
            testID="game.checkin"
            size="lg"
            fullWidth
            variant={live ? 'accent' : 'primary'}
            label={checkInOpen ? t('games:details.action.checkIn') : t('games:details.action.checkInOpens', { time: isolate(formatTime(new Date(Date.parse(g.startsAt) - DEFAULT_TRUST_CONFIG.checkInOpensMinutesBeforeStart * 60_000).toISOString(), locale), 'ltr') })}
            disabled={!checkInOpen || me.attendance === 'verified'}
            startIcon={<Icon name="map-marker-check" size={20} color={checkInOpen ? (live ? 'onAccent' : 'onPrimary') : 'disabledText'} />}
            onPress={() => router.push(`/game/${g.id}/checkin`)}
          />
          <Row gap="sm" wrap>
            <Button testID="game.chat" variant="secondary" label={t('games:details.action.chat')} onPress={() => router.push(`/game/${g.id}/chat`)} />
            <Button testID="game.directions" variant="secondary" label={t('games:details.action.directions')} onPress={() => void Linking.openURL(directionsUrl(location.lat, location.lng, g.venue?.name ?? g.title))} />
            <Button testID="game.cantMakeIt" variant="ghost" label={t('games:details.action.cantMakeIt')} onPress={() => setConfirmCancel(true)} />
          </Row>
        </Stack>
      );
    }
  } else if (ended && !cancelled && (g.isHost || me?.status === 'approved') && canSubmitResult(g, now, DEFAULT_TRUST_CONFIG)) {
    footer = <Button testID="game.result" size="lg" fullWidth label={t('games:details.host.enterResult')} onPress={() => router.push(`/game/${g.id}/result`)} />;
  }

  const renderList = (title: string, items: ParticipantView[], testID: string, trailing?: (p: ParticipantView) => ReactNode) =>
    items.length ? (
      <Stack gap="xs" testID={testID}>
        <Text variant="title3">{title}</Text>
        {items.map((p, i) => (
          <View key={p.userId}>
            {i > 0 ? <Divider insetStart={52} /> : null}
            <ParticipantRow p={p} isHost={p.userId === g.hostId} trailing={trailing?.(p)} />
          </View>
        ))}
      </Stack>
    ) : null;

  return (
    <Screen testID="screen.game" backFallback="/map" footer={footer}>
      <Stack gap="lg">
        {cancelled ? <Banner testID="game.banner.cancelled" tone="warning" text={t('games:details.banner.cancelledNoReason')} /> : null}
        {ended && !cancelled ? <Banner testID="game.banner.ended" text={t('games:details.banner.ended')} /> : null}

        <Stack gap="sm">
          <Row gap="sm">
            <SportDot sport={g.sport} size={18} />
            <Text variant="label" color="textSecondary">
              {sport}
            </Text>
            {live ? <Tag label={t('map:card.live')} tone="info" icon="broadcast" /> : null}
          </Row>
          <BidiText variant="title1" accessibilityRole="header" testID="game.title">
            {g.title}
          </BidiText>
          <Text variant="body" color="textSecondary" testID="game.time">
            {t('games:details.when', { relative: formatRelative(g.startsAt, locale, now), absolute: isolate(formatDateTime(g.startsAt, locale), 'ltr') })}
          </Text>
          <Row gap="xs" align="start">
            <Icon name={g.location ? 'map-marker-radius' : 'lock-outline'} size={20} />
            {g.venue ? (
              <Stack gap="xxs" style={{ flex: 1 }}>
                <BidiText variant="callout">{g.venue.name}</BidiText>
                {g.venue.address ? (
                  <BidiText variant="caption" color="textSecondary">
                    {g.venue.address}
                  </BidiText>
                ) : null}
              </Stack>
            ) : (
              <Text variant="callout" color="textSecondary" style={{ flex: 1 }} testID="game.location.hidden">
                {t('games:details.hiddenLocation')}
              </Text>
            )}
          </Row>
        </Stack>

        <View testID="game.host">
        <Card outlined>
          <Row gap="md">
            <Avatar name={g.host.displayName} uri={g.host.avatarUrl} size="lg" decorative />
            <Stack gap="xs" style={{ flex: 1 }}>
              <Text variant="callout">
                {t('games:details.host.hostedBy', { name: isolate(g.host.displayName) })}
              </Text>
              <Row gap="xs" wrap>
                <ReliabilityBadge status={g.host.reliabilityStatus} score={g.host.reliabilityScore} />
                {g.host.verifiedHost ? <Tag icon="check-decagram" label={t('games:details.host.verified')} tone="info" /> : null}
              </Row>
            </Stack>
          </Row>
        </Card>
        </View>

        <Row gap="xs" wrap testID="game.facts">
          <Tag icon="account-group" label={t('games:details.facts.players', { joined: g.approvedCount, capacity: g.capacity })} />
          {g.waitlistCount ? <Tag icon="timer-sand" tone="warning" label={t('games:details.facts.waitlist', { count: g.waitlistCount })} /> : null}
          {depositAmount ? <Tag icon="shield-lock-outline" label={t('games:details.facts.deposit', { amount: depositAmount })} /> : null}
          {g.womenOnly ? <Tag icon="gender-female" label={t('games:details.facts.womenOnly')} /> : null}
          {g.visibility === 'private' ? <Tag icon="lock-outline" label={t('games:details.facts.private')} /> : null}
        </Row>

        {g.notes ? (
          <BidiText variant="body" mode="block">
            {g.notes}
          </BidiText>
        ) : null}

        {g.isHost && inviteUrl ? (
          <Card outlined>
            <Stack gap="sm">
              <Text variant="bodyStrong">{t('games:wizard.published.shareTitle')}</Text>
              <BidiText variant="caption" color="textSecondary" direction="ltr" testID="game.invite.url">
                {inviteUrl}
              </BidiText>
              <Button
                testID="game.invite.copy"
                variant="secondary"
                size="sm"
                label={t('games:wizard.published.copyLink')}
                onPress={async () => {
                  await Clipboard.setStringAsync(inviteUrl);
                  toast(t('games:wizard.published.linkCopied'));
                }}
              />
            </Stack>
          </Card>
        ) : null}

        <InlineError error={actionError} />

        {participants.loading && !participants.data ? (
          <Skeleton rows={2} height={56} />
        ) : (
          <Stack gap="lg">
            {g.isHost && requested.length ? (
              <Text variant="callout" color="primaryText" testID="game.host.pending" accessibilityLiveRegion="polite">
                {t('games:details.host.pendingCount', { count: requested.length })}
              </Text>
            ) : null}
            {g.isHost
              ? renderList(t('games:details.sections.requests'), requested, 'game.requests', (p) => (
                  <Row gap="xs">
                    <Button testID={`game.host.approve.${p.userId}`} size="sm" label={t('games:details.host.approve')} loading={decide.busy} onPress={() => void onDecide(p.userId, 'approve')} />
                    <Button testID={`game.host.reject.${p.userId}`} size="sm" variant="secondary" label={t('games:details.host.reject')} onPress={() => void onDecide(p.userId, 'reject')} />
                  </Row>
                ))
              : null}
            {renderList(t('games:details.sections.players'), approved, 'game.players')}
            {renderList(t('games:details.sections.waitlist'), waitlisted, 'game.waitlist')}
            {!g.isHost && me?.status !== 'approved' && approved.length <= 1 ? (
              <Text variant="caption" color="textTertiary">
                {t('games:details.playersAfterJoin')}
              </Text>
            ) : null}
          </Stack>
        )}

        {g.isHost && !cancelled && !ended ? (
          <Stack gap="sm">
            <Divider />
            <Button testID="game.host.cancel" variant="ghost" label={t('games:details.host.cancelGame')} onPress={() => setConfirmCancelGame(true)} />
          </Stack>
        ) : null}
        <View style={{ height: theme.tokens.spacing.lg }} />
      </Stack>

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
        busy={cancelGame.busy}
        onConfirm={() => void onCancelGame()}
        onCancel={() => setConfirmCancelGame(false)}
      />
      <ConfirmDialog
        testID="payment.deposit"
        visible={!!deposit}
        title={t('games:details.deposit.sheetTitle')}
        body={deposit ? t('games:details.deposit.body', { amount: deposit.amount, time: isolate(formatDateTime(new Date(Date.parse(g.startsAt) - DEFAULT_TRUST_CONFIG.depositHoldLeadHours * 3600_000).toISOString(), locale), 'ltr') }) : undefined}
        confirmLabel={t('games:details.deposit.continue')}
        cancelLabel={t('common:actions.notNow')}
        onConfirm={() => {
          setDeposit(null);
          toast(t('games:details.deposit.saved'));
        }}
        onCancel={() => setDeposit(null)}
      />
    </Screen>
  );
}
