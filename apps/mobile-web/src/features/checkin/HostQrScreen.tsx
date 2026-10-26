/**
 * Host QR (design v2 §15.9): a night-stadium band (always dark) with the QR on a white
 * radius-28 card (dark modules on white, so any scanner reads it — also in dark mode),
 * a countdown ring to the next rotation, the code as text with Copy for manual entry,
 * the "7 of 10 checked in" counter with faces, a keep-the-screen-on hint, a "New code"
 * action (rotates the secret so screenshots die) and manual marking as a ListGroup.
 */
import { DEFAULT_TRUST_CONFIG, type QrToken } from '@st/domain';
import {
  Avatar,
  AvatarStack,
  BidiText,
  Button,
  Gradient,
  Haptics,
  Icon,
  IconButton,
  isolate,
  ListGroup,
  ListItem,
  palette,
  ProgressRing,
  radius,
  Row,
  Skeleton,
  spacing,
  Stack,
  StatusPill,
  Text,
  useTheme,
} from '@st/ui';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { goBack, Screen } from '@/components/Screen';
import { ErrorView, InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { Notice } from '@/features/kit/Notice';
import { useGame } from '@/features/game/useGame';
import { useAction } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatClock } from '@/lib/format';

import { useKeepScreenOn } from './useKeepScreenOn';

const ON_MEDIA_MUTED = 'rgba(255, 255, 255, 0.74)';

export function HostQrScreen({ gameId }: { gameId: string }) {
  const { t } = useT();
  const theme = useTheme();
  const port = useData();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow(1000);
  const { game, participants, refresh } = useGame(gameId, { pollMs: 10_000 });
  const [token, setToken] = useState<QrToken | null>(null);
  // The display rotates every step (20 s); a token stays accepted for one more step of drift,
  // so the countdown runs to the next step boundary, not to `expiresAt` (which read "37" next
  // to "refreshes every 20 seconds").
  const period = DEFAULT_TRUST_CONFIG.qrStepSeconds * 1000;
  const [manual, setManual] = useState(false);
  const load = useAction(async (rotate: boolean) => (rotate ? port.rotateQr(gameId) : port.getQrToken(gameId)));
  const mark = useAction(async (userId: string) => port.submitCheckIn(gameId, { method: 'host', targetUserId: userId }));
  const run = load.run;
  useKeepScreenOn(!!game.data?.isHost);

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
    const ms = Math.max(500, (token.step + 1) * period - Date.now());
    const id = setTimeout(() => void fetchToken(), ms);
    return () => clearTimeout(id);
  }, [token, fetchToken, period]);

  const g = game.data;
  if (!g || !g.isHost) {
    return (
      <Screen testID="screen.game.qr" title={t('checkin:host.title')} backFallback={`/game/${gameId}`}>
        {g ? (
          <Notice tone="warning" icon="LockSimple" text={t('checkin:reject.not_host')} />
        ) : game.loading ? (
          <Stack gap="lg" align="center" aria-busy>
            <Skeleton width={300} height={300} radius={radius.xl} />
            <Skeleton width="60%" height={18} />
          </Stack>
        ) : (
          <ErrorView error={game.error} onRetry={() => void game.reload()} />
        )}
      </Screen>
    );
  }

  const left = token ? Math.min(period, Math.max(0, (token.step + 1) * period - now)) : 0;
  const secondsLeft = Math.ceil(left / 1000);
  const approved = (participants.data ?? []).filter((p) => p.status === 'approved');
  const here = approved.filter((p) => p.attendance === 'verified');
  const qrSize = Math.max(220, Math.min(320, Math.round(width - 2 * spacing.lg - 2 * spacing.xl - 2 * spacing.lg)));
  const counter = t('checkin:host.counter', { checkedIn: here.length, total: approved.length });

  const copy = async () => {
    if (!token) return;
    try {
      await Clipboard.setStringAsync(token.token);
      Haptics.selection();
      toast(t('checkin:host.copied'));
    } catch {
      // Clipboard can be unavailable (permissions); the code stays selectable.
    }
  };

  return (
    <SafeAreaView testID="screen.game.qr" edges={['bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <Gradient name="brandNight" style={{ paddingTop: insets.top + spacing.xs, paddingBottom: spacing.xl, borderBottomStartRadius: radius.xl, borderBottomEndRadius: radius.xl }}>
          <View testID="checkin.qr.show" style={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingStart: spacing.sm, paddingEnd: spacing.lg, gap: spacing.lg }}>
            <Row gap="xs" style={{ minHeight: 52 }}>
              <IconButton testID="nav.back" icon="ArrowLeft" label={t('common:a11y.back')} color="#FFFFFF" onPress={() => goBack(`/game/${gameId}`)} />
              <Stack gap="xxs" style={{ flex: 1 }}>
                <Text variant="title3" color="textOnMedia" numberOfLines={1}>
                  {t('checkin:host.title')}
                </Text>
                <BidiText variant="footnote" numberOfLines={1} style={{ color: ON_MEDIA_MUTED }}>
                  {g.title}
                </BidiText>
              </Stack>
            </Row>

            <View style={{ alignItems: 'center', gap: spacing.lg, paddingStart: spacing.sm }}>
              <View
                accessible
                role="img"
                aria-label={t('checkin:host.qrA11y')}
                style={{ padding: spacing.lg, backgroundColor: '#FFFFFF', borderRadius: radius.xl, boxShadow: '0px 18px 44px rgba(0, 0, 0, 0.45)' }}
              >
                {token ? (
                  <QRCode value={token.token} size={qrSize} color="#0B0A1C" backgroundColor="#FFFFFF" ecl="M" />
                ) : (
                  <View style={{ width: qrSize, height: qrSize, borderRadius: radius.md, backgroundColor: '#EFEEF6' }} />
                )}
              </View>

              <Row gap="md" accessible aria-label={t('checkin:host.countdown', { time: formatClock(secondsLeft) })}>
                <ProgressRing progress={left / period} size={40} thickness={4} color={palette.volt400} trackColor="rgba(255, 255, 255, 0.16)" animated={false}>
                  <Text variant="caption" weight="bold" color="textOnMedia" allowFontScaling={false} style={{ fontVariant: ['tabular-nums'] }}>
                    {isolate(String(secondsLeft), 'ltr')}
                  </Text>
                </ProgressRing>
                <Text variant="callout" style={{ color: ON_MEDIA_MUTED, flexShrink: 1 }}>
                  {t('checkin:host.instruction', { seconds: DEFAULT_TRUST_CONFIG.qrStepSeconds })}
                </Text>
              </Row>

              <View
                style={{
                  alignSelf: 'stretch',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  paddingStart: spacing.lg,
                  paddingEnd: spacing.xs,
                  paddingTop: spacing.sm,
                  paddingBottom: spacing.sm,
                  borderRadius: radius.lg,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.14)',
                }}
              >
                <Stack gap="xxs" style={{ flex: 1 }}>
                  <Text variant="caption" style={{ color: ON_MEDIA_MUTED }}>
                    {t('checkin:host.fallbackCode')}
                  </Text>
                  <Text
                    variant="footnote"
                    weight="semibold"
                    color="textOnMedia"
                    selectable
                    numberOfLines={1}
                    ellipsizeMode="middle"
                    // The code is LTR data: keep its paragraph LTR so it truncates at the end in RTL UIs too.
                    {...({ dir: 'ltr' } as object)}
                    testID="checkin.qr.code"
                    style={{ fontFamily: 'monospace', fontVariant: ['tabular-nums'], letterSpacing: 0.5 }}
                  >
                    {token ? isolate(token.token, 'ltr') : '—'}
                  </Text>
                </Stack>
                <IconButton testID="checkin.qr.copy" icon="Copy" label={t('checkin:host.copy')} color="#FFFFFF" disabled={!token} onPress={() => void copy()} />
              </View>
            </View>
          </View>
        </Gradient>

        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingTop: spacing.xl, gap: spacing.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, ...theme.elevation(1) }}>
            <ProgressRing progress={approved.length ? here.length / approved.length : 0} size={56} thickness={6} color="success">
              <Text variant="label" weight="bold" allowFontScaling={false} style={{ fontVariant: ['tabular-nums'] }}>
                {isolate(`${here.length}/${approved.length}`, 'ltr')}
              </Text>
            </ProgressRing>
            <Stack gap="xs" style={{ flex: 1 }}>
              <Text variant="headline" aria-live="polite" testID="checkin.qr.counter">
                {counter}
              </Text>
              {here.length ? (
                <AvatarStack size="xs" max={6} label={counter} people={here.map((p) => ({ name: p.profile.displayName, uri: p.profile.avatarUrl }))} />
              ) : null}
            </Stack>
          </View>

          <Notice tone="neutral" icon="Sun" text={t('checkin:host.screenOn')} live="off" />
          <InlineError error={load.error ?? mark.error} />

          <View testID={manual ? 'checkin.manual' : undefined}>
          <ListGroup title={t('checkin:host.playersTitle')}>
            {[
              <ListItem
                key="toggle"
                testID="checkin.qr.manual"
                icon="UsersThree"
                title={t('checkin:host.markManually')}
                aria-expanded={manual}
                trailing={<IconChevron open={manual} />}
                onPress={() => setManual((m) => !m)}
              />,
              ...(manual
                ? approved.map((p) => {
                    const isHere = p.attendance === 'verified';
                    return (
                      <ListItem
                        key={p.userId}
                        title={p.profile.displayName}
                        leading={<Avatar name={p.profile.displayName} uri={p.profile.avatarUrl} size="sm" decorative />}
                        trailing={
                          isHere ? (
                            <StatusPill tone="success" icon="CheckCircle" label={t('checkin:host.present')} />
                          ) : (
                            <Button
                              testID={`checkin.manual.mark.${p.userId}`}
                              size="sm"
                              variant="secondary"
                              label={t('checkin:host.present')}
                              aria-label={t('checkin:host.markPresent', { name: p.profile.displayName })}
                              loading={mark.busy}
                              onPress={async () => {
                                const v = await mark.run(p.userId);
                                if (v?.outcome === 'verified') {
                                  Haptics.selection();
                                  toast(t('checkin:success.method', { method: 'host' }));
                                } else if (v) toast(t(`checkin:reject.${v.reason}`, { minutes: DEFAULT_TRUST_CONFIG.checkInOpensMinutesBeforeStart }));
                                void refresh();
                              }}
                            />
                          )
                        }
                      />
                    );
                  })
                : []),
            ]}
          </ListGroup>
          </View>

          <Button testID="checkin.qr.rotate" variant="outline" size="lg" fullWidth icon="ArrowClockwise" label={t('checkin:host.newCode')} loading={load.busy} onPress={() => void fetchToken(true)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return <Icon name={open ? 'CaretUp' : 'CaretDown'} size={18} weight="bold" color="textTertiary" />;
}
