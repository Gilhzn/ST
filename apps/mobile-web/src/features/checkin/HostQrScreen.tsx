/**
 * Host QR display (design §13.8): a large QR on white (always light, for
 * scanners) that rotates every 30 s with a mirrored countdown bar, the code in
 * text for manual entry, a polite "7 of 10 checked in" counter, a "new code"
 * action (rotates the secret so screenshots die), and manual marking (host check-in).
 */
import { DEFAULT_TRUST_CONFIG, type QrToken } from '@st/domain';
import { BidiText, Button, Card, isolate, radius, Row, Stack, Text, useTheme } from '@st/ui';
import { useCallback, useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Screen } from '@/components/Screen';
import { Banner, ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useGame } from '@/features/game/useGame';
import { useAction } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';

export function HostQrScreen({ gameId }: { gameId: string }) {
  const { t } = useT();
  const theme = useTheme();
  const port = useData();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const now = useNow(1000);
  const { game, participants, refresh } = useGame(gameId, { pollMs: 10_000 });
  const [token, setToken] = useState<QrToken | null>(null);
  const [manual, setManual] = useState(false);
  const load = useAction(async (rotate: boolean) => (rotate ? port.rotateQr(gameId) : port.getQrToken(gameId)));
  const mark = useAction(async (userId: string) => port.submitCheckIn(gameId, { method: 'host', targetUserId: userId }));
  const run = load.run;

  const fetchToken = useCallback(
    async (rotate = false) => {
      const next = await run(rotate);
      if (next) setToken(next);
    },
    [run],
  );

  useEffect(() => {
    void fetchToken();
  }, [fetchToken]);

  // Swap the code as soon as it expires (instant swap; also with reduced motion).
  useEffect(() => {
    if (!token) return;
    const ms = Math.max(500, Date.parse(token.expiresAt) - Date.now());
    const id = setTimeout(() => void fetchToken(), ms);
    return () => clearTimeout(id);
  }, [token, fetchToken]);

  const g = game.data;
  if (game.loading && !g) {
    return (
      <Screen testID="screen.game.qr" title={t('checkin:host.title')}>
        <Skeleton rows={2} height={240} />
      </Screen>
    );
  }
  if (!g || !g.isHost) {
    return (
      <Screen testID="screen.game.qr" title={t('checkin:host.title')}>
        {g ? <Banner tone="warning" text={t('checkin:reject.not_host')} /> : <ErrorView error={game.error} onRetry={() => void game.reload()} />}
      </Screen>
    );
  }

  const step = DEFAULT_TRUST_CONFIG.qrStepSeconds * 1000;
  const left = token ? Math.max(0, Date.parse(token.expiresAt) - now) : 0;
  const approved = (participants.data ?? []).filter((p) => p.status === 'approved');
  const checkedIn = approved.filter((p) => p.attendance === 'verified').length;
  const qrSize = Math.max(240, Math.min(360, Math.round(width * 0.6)));

  return (
    <Screen testID="screen.game.qr" title={t('checkin:host.title')} backFallback={`/game/${gameId}`}>
      <Stack gap="lg" align="center" testID="checkin.qr.show">
        <BidiText variant="callout" color="textSecondary">
          {g.title}
        </BidiText>
        {/* Always white with dark modules so any scanner can read it, also in dark mode. */}
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('checkin:host.qrA11y')}
          style={{ padding: 16, backgroundColor: '#FFFFFF', borderRadius: radius.lg, ...theme.elevation(2) }}
        >
          {token ? <QRCode value={token.token} size={qrSize} color="#000000" backgroundColor="#FFFFFF" ecl="M" /> : <View style={{ width: qrSize, height: qrSize }} />}
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: qrSize + 32, height: 6, borderRadius: radius.pill, backgroundColor: theme.colors.surfaceSunken, flexDirection: 'row', overflow: 'hidden' }}
        >
          <View style={{ width: `${Math.min(100, (left / step) * 100)}%`, backgroundColor: theme.colors.primary }} />
        </View>
        <Text variant="callout" color="textSecondary" align="center">
          {t('checkin:host.instruction', { seconds: DEFAULT_TRUST_CONFIG.qrStepSeconds })}
        </Text>
        <Stack gap="xxs" align="center">
          <Text variant="caption" color="textSecondary">
            {t('checkin:host.fallbackCode')}
          </Text>
          <Text variant="bodyStrong" selectable testID="checkin.qr.code" style={{ fontVariant: ['tabular-nums'], fontFamily: 'monospace' }}>
            {token ? isolate(token.token, 'ltr') : '—'}
          </Text>
        </Stack>
        <Text variant="title3" accessibilityLiveRegion="polite" testID="checkin.qr.counter">
          {t('checkin:host.counter', { checkedIn, total: approved.length })}
        </Text>
        <InlineError error={load.error ?? mark.error} />
        <Row gap="sm" wrap justify="center">
          <Button testID="checkin.qr.rotate" variant="secondary" label={t('checkin:host.newCode')} loading={load.busy} onPress={() => void fetchToken(true)} />
          <Button testID="checkin.qr.manual" variant="ghost" label={t('checkin:host.markManually')} onPress={() => setManual((m) => !m)} />
        </Row>
      </Stack>

      {manual ? (
        <Card outlined testID="checkin.manual">
          <Stack gap="sm">
            <Text variant="title3">{t('checkin:host.manualTitle')}</Text>
            {approved.map((p) => {
              const here = p.attendance === 'verified';
              return (
                <Row key={p.userId} gap="md" style={{ minHeight: 56 }}>
                  <BidiText variant="callout" style={{ flex: 1 }}>
                    {p.profile.displayName}
                  </BidiText>
                  {here ? (
                    <Text variant="label" color="successText">
                      {t('checkin:host.present')}
                    </Text>
                  ) : (
                    <Button
                      testID={`checkin.manual.mark.${p.userId}`}
                      size="sm"
                      label={t('checkin:host.present')}
                      accessibilityLabel={t('checkin:host.markPresent', { name: p.profile.displayName })}
                      onPress={async () => {
                        const v = await mark.run(p.userId);
                        if (v?.outcome === 'verified') toast(t('checkin:success.method', { method: 'host' }));
                        else if (v) toast(t(`checkin:reject.${v.reason}`, { minutes: DEFAULT_TRUST_CONFIG.checkInOpensMinutesBeforeStart }));
                        void refresh();
                      }}
                    />
                  )}
                </Row>
              );
            })}
          </Stack>
        </Card>
      ) : null}
    </Screen>
  );
}
