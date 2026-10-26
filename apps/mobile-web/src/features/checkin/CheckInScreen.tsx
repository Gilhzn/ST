/**
 * Check-in (design §13.7, architecture §5.2): stage-2 foreground GPS (2–3 spaced
 * samples, accuracy shown, verified server side) with "other ways" always
 * visible — host QR (camera or manual code) and teammates (peer confirmation).
 * Rejections never accuse: each reason has gentle copy and lists the fallbacks
 * the server offers. Spoofing signals only route to another way.
 */
import { DEFAULT_TRUST_CONFIG, isCheckInOpen, type CheckInMethod, type CheckInVerdict, type GpsSample, type ParticipantView } from '@st/domain';
import { BidiText, Button, Divider, isolate, Row, Stack, Text, TextField } from '@st/ui';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { Card } from '@/components/CardView';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Banner, ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useGame } from '@/features/game/useGame';
import { useAction } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatDistance, formatTime } from '@/lib/format';
import { collectGpsSamples, getLocationPermission, requestLocationPermission, type LocationPermission } from '@/platform/location';

import { ProgressRing } from './ProgressRing';
import { QrScanner } from './QrScanner';

const SAMPLE_COUNT = 3;
const SAMPLE_SPACING_MS = (DEFAULT_TRUST_CONFIG.gpsMinSampleSpacingSeconds + 0.5) * 1000;

type GpsPhase = 'idle' | 'disclosure' | 'sampling' | 'submitting' | 'denied';

export function CheckInScreen({ gameId }: { gameId: string }) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const now = useNow(15_000);
  const { game, participants, refresh } = useGame(gameId, { pollMs: 10_000 });
  const [verdict, setVerdict] = useState<CheckInVerdict | null>(null);
  const [phase, setPhase] = useState<GpsPhase>('idle');
  const [samples, setSamples] = useState<GpsSample[]>([]);
  const [permission, setPermission] = useState<LocationPermission | null>(null);
  const [qrMode, setQrMode] = useState<'none' | 'camera' | 'manual'>('none');
  const [code, setCode] = useState('');
  const [askedPeers, setAskedPeers] = useState(false);
  const abort = useRef({ aborted: false });

  const submit = useAction(async (request: Parameters<typeof port.submitCheckIn>[1]) => port.submitCheckIn(gameId, request));
  const confirm = useAction(async (userId: string) => port.peerConfirm(gameId, userId));

  useEffect(() => {
    void getLocationPermission().then(setPermission);
    const a = abort.current;
    return () => {
      a.aborted = true;
    };
  }, []);

  const announce = (v: CheckInVerdict) => {
    AccessibilityInfo.announceForAccessibility?.(
      v.outcome === 'verified' ? t('checkin:success.title') : t(`checkin:reject.${v.reason}`, { minutes: DEFAULT_TRUST_CONFIG.checkInOpensMinutesBeforeStart }),
    );
  };

  const runGps = async () => {
    let p = permission ?? (await getLocationPermission());
    if (p === 'undetermined' && phase !== 'disclosure') {
      setPhase('disclosure');
      return;
    }
    if (p === 'undetermined') p = await requestLocationPermission();
    setPermission(p);
    if (p !== 'granted') {
      setPhase('denied');
      return;
    }
    setVerdict(null);
    setSamples([]);
    setPhase('sampling');
    const collected = await collectGpsSamples({
      count: SAMPLE_COUNT,
      spacingMs: SAMPLE_SPACING_MS,
      signal: abort.current,
      onSample: (s) => setSamples((prev) => [...prev, s]),
    });
    if (abort.current.aborted) return;
    setPhase('submitting');
    const v = await submit.run({ method: 'gps', samples: collected });
    setPhase('idle');
    if (v) {
      setVerdict(v);
      announce(v);
      if (v.outcome === 'verified') void refresh();
    }
  };

  const submitQr = async (token: string) => {
    const clean = token.trim();
    if (!clean) return;
    const v = await submit.run({ method: 'qr', token: clean });
    if (v) {
      setVerdict(v);
      announce(v);
      if (v.outcome === 'verified') {
        setQrMode('none');
        void refresh();
      }
    }
  };

  if (game.loading && !game.data) {
    return (
      <Screen testID="screen.game.checkin" title={t('checkin:title')}>
        <Skeleton rows={3} />
      </Screen>
    );
  }
  if (!game.data) {
    return (
      <Screen testID="screen.game.checkin" title={t('checkin:title')}>
        <ErrorView error={game.error} onRetry={() => void game.reload()} />
      </Screen>
    );
  }

  const g = game.data;
  const me = g.myParticipation;
  const verified = me?.attendance === 'verified' || verdict?.outcome === 'verified';
  const open = isCheckInOpen(g, now, DEFAULT_TRUST_CONFIG);
  const opensAt = new Date(Date.parse(g.startsAt) - DEFAULT_TRUST_CONFIG.checkInOpensMinutesBeforeStart * 60_000).toISOString();
  const approved = me?.status === 'approved';
  const bestAccuracy = samples.length ? Math.min(...samples.map((s) => s.accuracyM)) : null;
  const fallbacks: readonly CheckInMethod[] = verdict?.outcome === 'rejected' ? verdict.fallbacks : [];
  const teammates: ParticipantView[] = (participants.data ?? []).filter((p) => p.status === 'approved' && p.attendance !== 'verified' && p.userId !== me?.userId);

  const status = verified ? (
    <Card testID="checkin.status" accessibilityLiveRegion="polite" accentEdge>
      <Row gap="md">
        <ProgressRing progress={1} size={64} stroke={6} tone="success">
          <Icon name="check" color="successText" size={28} />
        </ProgressRing>
        <Stack gap="xxs" style={{ flex: 1 }}>
          <Text variant="title3" color="successText">
            {t('checkin:success.title')}
          </Text>
          <Text variant="callout" color="textSecondary">
            {t('checkin:success.method', { method: verdict?.method ?? me?.checkInMethod ?? 'other' })}
          </Text>
        </Stack>
      </Row>
    </Card>
  ) : verdict?.outcome === 'rejected' ? (
    <Card testID="checkin.status" outlined accessibilityLiveRegion="polite">
      <Stack gap="xs">
        <Text variant="bodyStrong" testID={`checkin.reject.${verdict.reason}`}>
          {verdict.method === 'gps' && verdict.reason !== 'outside_window' ? t('checkin:unconfirmed.title') : t(`checkin:reject.${verdict.reason}`, { minutes: DEFAULT_TRUST_CONFIG.checkInOpensMinutesBeforeStart })}
        </Text>
        {verdict.method === 'gps' && verdict.reason !== 'outside_window' ? (
          <Text variant="callout" color="textSecondary">
            {t(`checkin:reject.${verdict.reason}`, { minutes: DEFAULT_TRUST_CONFIG.checkInOpensMinutesBeforeStart })}
          </Text>
        ) : null}
        {fallbacks.length ? (
          <Text variant="caption" color="textTertiary">
            {t('checkin:fallbacks', { count: fallbacks.length })}
          </Text>
        ) : null}
      </Stack>
    </Card>
  ) : null;

  return (
    <Screen testID="screen.game.checkin" title={t('checkin:title')} backFallback={`/game/${gameId}`}>
      <BidiText variant="callout" color="textSecondary">
        {g.title}
      </BidiText>
      {!approved ? <Banner tone="warning" testID="checkin.notParticipant" text={t('checkin:reject.not_participant')} /> : null}
      {approved && !open && !verified ? (
        <Banner
          testID="checkin.window"
          tone="info"
          text={Date.parse(g.endsAt) <= now ? t('checkin:closed') : t('checkin:opensAt', { time: isolate(formatTime(opensAt, locale), 'ltr') })}
        />
      ) : null}
      {status}
      <InlineError error={submit.error ?? confirm.error} />

      {approved && open && !verified ? (
        <Stack gap="lg">
          {/* Stage 2: GPS */}
          <Card testID="checkin.gps">
            <Stack gap="md" align="center">
              <Text variant="title3" style={{ alignSelf: 'stretch' }}>
                {t('checkin:gps.title')}
              </Text>
              {phase === 'disclosure' ? (
                <Stack gap="sm" style={{ alignSelf: 'stretch' }} testID="checkin.location.disclosure">
                  <Text variant="bodyStrong">{t('checkin:permission.location.title')}</Text>
                  <Text variant="body" color="textSecondary">
                    {t('checkin:permission.location.body')}
                  </Text>
                  <Row gap="sm" wrap>
                    <Button testID="checkin.location.allow" label={t('checkin:permission.location.allow')} onPress={() => void runGps()} />
                    <Button variant="ghost" label={t('common:actions.notNow')} onPress={() => setPhase('idle')} />
                  </Row>
                </Stack>
              ) : (
                <>
                  <ProgressRing progress={samples.length / SAMPLE_COUNT}>
                    <Text variant="numeric" accessibilityElementsHidden>
                      {isolate(`${samples.length}/${SAMPLE_COUNT}`, 'ltr')}
                    </Text>
                  </ProgressRing>
                  <Row gap="xs" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {Array.from({ length: SAMPLE_COUNT }, (_, i) => (
                      <Icon key={i} name={i < samples.length ? 'circle' : 'circle-outline'} size={12} color={i < samples.length ? 'primary' : 'textTertiary'} />
                    ))}
                  </Row>
                  <Text variant="callout" color="textSecondary" accessibilityLiveRegion="polite" testID="checkin.gps.progress">
                    {phase === 'sampling' || phase === 'submitting'
                      ? t('checkin:gps.progress', { done: samples.length, total: SAMPLE_COUNT })
                      : t('checkin:gps.intro')}
                  </Text>
                  {bestAccuracy !== null ? (
                    <Text variant="caption" color="textTertiary" testID="checkin.gps.accuracy">
                      {t('checkin:gps.accuracy', { accuracy: isolate(`±${formatDistance(bestAccuracy, locale)}`, 'ltr') })}
                    </Text>
                  ) : null}
                  {phase === 'denied' || permission === 'denied' || permission === 'unavailable' ? (
                    <Text variant="callout" color="warningText" testID="checkin.location.denied">
                      {t('checkin:permission.location.denied')}
                    </Text>
                  ) : (
                    <Button
                      testID="checkin.gps.start"
                      label={verdict?.method === 'gps' ? t('checkin:gps.retry') : t('checkin:gps.start')}
                      loading={phase === 'sampling' || phase === 'submitting'}
                      loadingLabel={t('checkin:gps.progress', { done: samples.length, total: SAMPLE_COUNT })}
                      onPress={() => void runGps()}
                    />
                  )}
                </>
              )}
            </Stack>
          </Card>

          {/* Fallbacks are always visible, not hidden behind failure. */}
          <Stack gap="md">
            <Text variant="title3">{t('checkin:other.title')}</Text>
            <Card outlined testID="checkin.qr">
              <Stack gap="sm">
                <Row gap="sm">
                  <Icon name="qrcode-scan" />
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {t('checkin:qr.scan')}
                  </Text>
                </Row>
                {qrMode === 'camera' ? <QrScanner onCode={(c) => void submitQr(c)} /> : null}
                {qrMode === 'manual' ? (
                  <Stack gap="sm">
                    <TextField
                      testID="checkin.qr.input"
                      label={t('checkin:qr.tokenLabel')}
                      helperText={t('checkin:qr.tokenHint')}
                      value={code}
                      onChangeText={setCode}
                      inputDirection="ltr"
                      autoCapitalize="none"
                      autoCorrect={false}
                      onSubmitEditing={() => void submitQr(code)}
                    />
                    <Button testID="checkin.qr.submit" label={t('checkin:qr.submit')} loading={submit.busy} disabled={!code.trim()} onPress={() => void submitQr(code)} />
                  </Stack>
                ) : null}
                <Row gap="sm" wrap>
                  {qrMode !== 'camera' ? (
                    <Button testID="checkin.qr.camera" variant="secondary" size="sm" label={t('checkin:qr.scan')} onPress={() => setQrMode('camera')} />
                  ) : null}
                  {qrMode !== 'manual' ? (
                    <Button testID="checkin.qr.enter" variant="ghost" size="sm" label={t('checkin:qr.enterCode')} onPress={() => setQrMode('manual')} />
                  ) : null}
                </Row>
              </Stack>
            </Card>
            <Card outlined testID="checkin.peer">
              <Stack gap="sm">
                <Row gap="sm">
                  <Icon name="account-group" />
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {t('checkin:peer.ask')}
                  </Text>
                </Row>
                <Text variant="callout" color="textSecondary">
                  {t('checkin:peer.hint')}
                </Text>
                {askedPeers ? (
                  <Text variant="callout" accessibilityLiveRegion="polite" testID="checkin.peer.waiting">
                    {t('checkin:peer.waitingNeeded', { needed: DEFAULT_TRUST_CONFIG.peerMinConfirmations })}
                  </Text>
                ) : (
                  <Button
                    testID="checkin.peer.ask"
                    variant="secondary"
                    size="sm"
                    label={t('checkin:peer.ask')}
                    onPress={() => {
                      setAskedPeers(true);
                      toast(t('checkin:peer.sent'));
                    }}
                  />
                )}
              </Stack>
            </Card>
          </Stack>
        </Stack>
      ) : null}

      {/* Verified players vouch for teammates (peer fallback, ≥ 2 confirmations). */}
      {verified && open && teammates.length ? (
        <Stack gap="sm" testID="checkin.confirmTeammates">
          <Divider />
          <Text variant="title3">{t('checkin:peer.confirmTitle')}</Text>
          <Text variant="caption" color="textSecondary">
            {t('checkin:peer.confirmHint')}
          </Text>
          {teammates.map((p) => (
            <Row key={p.userId} gap="md" style={{ minHeight: 56 }}>
              <BidiText variant="callout" style={{ flex: 1 }}>
                {p.profile.displayName}
              </BidiText>
              <Button
                testID={`checkin.peer.confirm.${p.userId}`}
                size="sm"
                variant="secondary"
                label={t('checkin:peer.confirm')}
                accessibilityLabel={t('checkin:peer.confirmA11y', { name: p.profile.displayName })}
                onPress={async () => {
                  const r = await confirm.run(p.userId);
                  if (r) {
                    toast(t('checkin:peer.confirmed', { count: r.confirmations }));
                    void refresh();
                  }
                }}
              />
            </Row>
          ))}
        </Stack>
      ) : null}
    </Screen>
  );
}
