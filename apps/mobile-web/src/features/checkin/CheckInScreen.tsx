/**
 * Check-in (design v2 §15.8, architecture §5.2), a three-step flow:
 *  1. Choose a way — four method cards, always visible (GPS, scan QR, enter code, teammates).
 *  2. Confirm — the GPS radar takes 2–3 spaced readings (accuracy, sample dots and distance
 *     to the pin shown live; verified server side), or the QR / code / peer panel.
 *  3. Done — a short celebration with a success haptic, then vouching for teammates.
 * Rejections never accuse: each reason has gentle copy, and the methods the server offers as
 * fallbacks get a "Try this" badge. Spoofing signals only route to another way.
 */
import { DEFAULT_TRUST_CONFIG, isCheckInOpen, type CheckInMethod, type CheckInVerdict, type GpsSample, type ParticipantView } from '@st/domain';
import {
  Avatar,
  BidiText,
  Button,
  Haptics,
  Icon,
  Illustration,
  isolate,
  ListGroup,
  ListItem,
  ProgressRing,
  Skeleton,
  radius,
  Row,
  spacing,
  Stack,
  StatusPill,
  Text,
  TextField,
  useTheme,
  type IconName,
} from '@st/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Pressable, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { ErrorView, InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { Confetti } from '@/features/kit/Confetti';
import { Notice } from '@/features/kit/Notice';
import { StepBar } from '@/features/kit/StepBar';
import { useGame } from '@/features/game/useGame';
import { useAction } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatDistance, formatTime } from '@/lib/format';
import { collectGpsSamples, getLocationPermission, requestLocationPermission, type LocationPermission } from '@/platform/location';

import { distanceToPin, GpsRadar, SignalBars, signalQuality } from './GpsRadar';
import { QrScanner } from './QrScanner';

const SAMPLE_COUNT = 3;
const SAMPLE_SPACING_MS = (DEFAULT_TRUST_CONFIG.gpsMinSampleSpacingSeconds + 0.5) * 1000;

type GpsPhase = 'idle' | 'disclosure' | 'sampling' | 'submitting' | 'denied';
type Method = 'gps' | 'qr' | 'code' | 'peer';

const METHODS: { key: Method; icon: IconName; label: string; testID: string }[] = [
  { key: 'gps', icon: 'GpsFix', label: 'checkin:methods.gps', testID: 'checkin.method.gps' },
  { key: 'qr', icon: 'Scan', label: 'checkin:methods.qr', testID: 'checkin.qr.camera' },
  { key: 'code', icon: 'QrCode', label: 'checkin:methods.code', testID: 'checkin.qr.enter' },
  { key: 'peer', icon: 'UsersThree', label: 'checkin:methods.peer', testID: 'checkin.method.peer' },
];

function suggested(m: Method, fallbacks: readonly CheckInMethod[]): boolean {
  if (m === 'code') return fallbacks.includes('qr');
  if (m === 'qr' || m === 'gps' || m === 'peer') return fallbacks.includes(m);
  return false;
}

export function CheckInScreen({ gameId }: { gameId: string }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const port = useData();
  const toast = useToast();
  const now = useNow(15_000);
  const { game, participants, refresh } = useGame(gameId, { pollMs: 10_000 });
  const [verdict, setVerdict] = useState<CheckInVerdict | null>(null);
  const [phase, setPhase] = useState<GpsPhase>('idle');
  const [samples, setSamples] = useState<GpsSample[]>([]);
  const [permission, setPermission] = useState<LocationPermission | null>(null);
  const [method, setMethod] = useState<Method>('gps');
  const [code, setCode] = useState('');
  const [askedPeers, setAskedPeers] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
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

  const reasonText = (v: Extract<CheckInVerdict, { outcome: 'rejected' }>) =>
    t(`checkin:reject.${v.reason}`, { minutes: DEFAULT_TRUST_CONFIG.checkInOpensMinutesBeforeStart });

  const settle = (v: CheckInVerdict) => {
    setVerdict(v);
    if (v.outcome === 'verified') {
      Haptics.trigger('checkInSuccess');
      setCelebrate(true);
      AccessibilityInfo.announceForAccessibility?.(t('checkin:success.title'));
      void refresh();
    } else {
      Haptics.warning();
      AccessibilityInfo.announceForAccessibility?.(reasonText(v));
    }
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
    Haptics.light();
    const collected = await collectGpsSamples({
      count: SAMPLE_COUNT,
      spacingMs: SAMPLE_SPACING_MS,
      signal: abort.current,
      onSample: (s) => {
        Haptics.selection();
        setSamples((prev) => [...prev, s]);
      },
    });
    if (abort.current.aborted) return;
    setPhase('submitting');
    const v = await submit.run({ method: 'gps', samples: collected });
    setPhase('idle');
    if (v) settle(v);
  };

  const submitQr = async (token: string) => {
    const clean = token.trim();
    if (!clean) return;
    const v = await submit.run({ method: 'qr', token: clean });
    if (v) settle(v);
  };

  if (!game.data) {
    return (
      <Screen testID="screen.game.checkin" title={t('checkin:title')} backFallback={`/game/${gameId}`}>
        {game.loading ? <CheckInSkeleton /> : <ErrorView error={game.error} onRetry={() => void game.reload()} />}
      </Screen>
    );
  }

  const g = game.data;
  const me = g.myParticipation;
  const verified = me?.attendance === 'verified' || verdict?.outcome === 'verified';
  const open = isCheckInOpen(g, now, DEFAULT_TRUST_CONFIG);
  const opensAt = new Date(Date.parse(g.startsAt) - DEFAULT_TRUST_CONFIG.checkInOpensMinutesBeforeStart * 60_000).toISOString();
  const approved = me?.status === 'approved';
  const rejected = verdict?.outcome === 'rejected' ? verdict : null;
  // Badge the other ways the server offers, never the one that just failed.
  const fallbacks: readonly CheckInMethod[] = rejected ? rejected.fallbacks.filter((f) => f !== rejected.method) : [];
  const teammates: ParticipantView[] = (participants.data ?? []).filter((p) => p.status === 'approved' && p.attendance !== 'verified' && p.userId !== me?.userId);
  const busy = phase === 'sampling' || phase === 'submitting' || submit.busy;
  const step = verified ? 3 : busy || verdict || method !== 'gps' || phase === 'disclosure' ? 2 : 1;
  const stepLabel = t(step === 1 ? 'checkin:steps.choose' : step === 2 ? 'checkin:steps.verify' : 'checkin:steps.done');
  const verifiedMethod = (verdict?.outcome === 'verified' ? verdict.method : null) ?? me?.checkInMethod ?? 'other';

  return (
    <Screen testID="screen.game.checkin" title={t('checkin:title')} backFallback={`/game/${gameId}`}>
      <Stack gap="md">
        <BidiText variant="callout" color="textSecondary" numberOfLines={1} style={{ marginTop: -spacing.md }}>
          {g.title}
        </BidiText>
        {approved && (open || verified) ? (
          <StepBar total={3} current={step} caption={t('checkin:steps.progress', { current: step, total: 3, label: stepLabel })} testID="checkin.steps" />
        ) : null}
      </Stack>

      {!approved ? <Notice tone="warning" icon="Info" testID="checkin.notParticipant" text={t('checkin:reject.not_participant')} /> : null}
      {approved && !open && !verified ? (
        <Notice
          testID="checkin.window"
          tone="info"
          icon="ClockCountdown"
          text={Date.parse(g.endsAt) <= now ? t('checkin:closed') : t('checkin:opensAt', { time: isolate(formatTime(opensAt, locale), 'ltr') })}
        />
      ) : null}

      {verified ? <Success method={verifiedMethod} celebrate={celebrate} /> : null}

      {approved && open && !verified ? (
        <Stack gap="lg">
          <MethodGrid value={method} fallbacks={fallbacks} onChange={(m) => setMethod(m)} />

          {rejected ? (
            <Notice
              testID="checkin.status"
              tone="warning"
              icon={rejected.method === 'gps' ? 'MapPin' : 'QrCode'}
              titleTestID={`checkin.reject.${rejected.reason}`}
              title={rejected.method === 'gps' && rejected.reason !== 'outside_window' ? t('checkin:unconfirmed.title') : reasonText(rejected)}
              text={rejected.method === 'gps' && rejected.reason !== 'outside_window' ? reasonText(rejected) : undefined}
              live="assertive"
            >
              {fallbacks.length ? (
                <Text variant="footnote" color="textSecondary">
                  {t('checkin:fallbacks', { count: fallbacks.length })}
                </Text>
              ) : null}
            </Notice>
          ) : null}
          <InlineError error={submit.error ?? confirm.error} />

          {method === 'gps' ? (
            <GpsPanel
              phase={phase}
              samples={samples}
              permission={permission}
              pin={g.location ?? g.venue?.location ?? null}
              retry={verdict?.method === 'gps'}
              onStart={() => void runGps()}
              onNotNow={() => setPhase('idle')}
              onOtherWay={() => setMethod('code')}
            />
          ) : null}

          {method === 'qr' ? (
            <View testID="checkin.qr" style={panelStyle(theme)}>
              <QrScanner onCode={(c) => void submitQr(c)} />
              <Button variant="ghost" icon="QrCode" label={t('checkin:qr.enterCode')} onPress={() => setMethod('code')} />
            </View>
          ) : null}

          {method === 'code' ? (
            <View testID="checkin.qr" style={panelStyle(theme)}>
              <PanelHeader icon="QrCode" title={t('checkin:qr.tokenLabel')} body={t('checkin:qr.tokenHint')} />
              <TextField
                testID="checkin.qr.input"
                label={t('checkin:qr.tokenLabel')}
                value={code}
                onChangeText={setCode}
                inputDirection="ltr"
                autoCapitalize="none"
                autoCorrect={false}
                icon="QrCode"
                onSubmitEditing={() => void submitQr(code)}
              />
              <Button testID="checkin.qr.submit" size="lg" fullWidth icon="CheckCircle" label={t('checkin:qr.submit')} loading={submit.busy} disabled={!code.trim()} onPress={() => void submitQr(code)} />
            </View>
          ) : null}

          {method === 'peer' ? (
            <View testID="checkin.peer" style={panelStyle(theme)}>
              <PanelHeader icon="UsersThree" title={t('checkin:peer.ask')} body={t('checkin:peer.hint')} />
              {askedPeers ? (
                <Notice tone="info" icon="Hourglass" testID="checkin.peer.waiting" text={t('checkin:peer.waitingNeeded', { needed: DEFAULT_TRUST_CONFIG.peerMinConfirmations })} />
              ) : (
                <Button
                  testID="checkin.peer.ask"
                  size="lg"
                  fullWidth
                  icon="HandWaving"
                  label={t('checkin:peer.ask')}
                  onPress={() => {
                    setAskedPeers(true);
                    toast(t('checkin:peer.sent'));
                  }}
                />
              )}
            </View>
          ) : null}
        </Stack>
      ) : null}

      {/* Verified players vouch for teammates (peer fallback, ≥ 2 confirmations). */}
      {verified && open && teammates.length ? (
        <View testID="checkin.confirmTeammates">
          <ListGroup title={t('checkin:peer.confirmTitle')} footer={t('checkin:peer.confirmHint')}>
            {teammates.map((p) => (
              <ListItem
                key={p.userId}
                title={p.profile.displayName}
                leading={<Avatar name={p.profile.displayName} uri={p.profile.avatarUrl} size="md" decorative />}
                trailing={
                  <Button
                    testID={`checkin.peer.confirm.${p.userId}`}
                    size="sm"
                    variant="secondary"
                    icon="Check"
                    label={t('checkin:peer.confirm')}
                    aria-label={t('checkin:peer.confirmA11y', { name: p.profile.displayName })}
                    onPress={async () => {
                      const r = await confirm.run(p.userId);
                      if (r) {
                        Haptics.selection();
                        toast(t('checkin:peer.confirmed', { count: r.confirmations }));
                        void refresh();
                      }
                    }}
                  />
                }
              />
            ))}
          </ListGroup>
        </View>
      ) : null}
    </Screen>
  );
}

function panelStyle(theme: ReturnType<typeof useTheme>) {
  return { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.xl, ...theme.elevation(1) } as const;
}

function PanelHeader({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <Row gap="md" align="start">
      <View aria-hidden style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySubtle }}>
        <Icon name={icon} size={24} weight="duotone" color="onPrimarySubtle" />
      </View>
      <Stack gap="xxs" style={{ flex: 1 }}>
        <Text variant="title3">{title}</Text>
        <Text variant="callout" color="textSecondary">
          {body}
        </Text>
      </Stack>
    </Row>
  );
}

/** Four method cards (2 × 2), a radio group. Fallbacks offered by the server get a badge. */
function MethodGrid({ value, fallbacks, onChange }: { value: Method; fallbacks: readonly CheckInMethod[]; onChange: (m: Method) => void }) {
  const { t } = useT();
  const theme = useTheme();
  const c = theme.colors;
  return (
    <View role="radiogroup" aria-label={t('checkin:methods.title')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {METHODS.map((m) => {
        const sel = m.key === value;
        const hint = suggested(m.key, fallbacks) && !sel;
        return (
          <Pressable
            key={m.key}
            testID={m.testID}
            role="radio"
            aria-checked={sel}
            aria-label={hint ? `${t(m.label)}, ${t('checkin:methods.suggested')}` : t(m.label)}
            onPress={() => {
              if (!sel) Haptics.trigger('segmentChange');
              onChange(m.key);
            }}
            style={(st) => {
              const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
              return {
                flexBasis: '45%',
                flexGrow: 1,
                minHeight: 64,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingStart: spacing.md,
                paddingEnd: spacing.md,
                borderRadius: radius.lg,
                ...(sel ? null : theme.elevation(1)),
                borderWidth: 2,
                borderColor: sel ? c.primary : hint ? c.warning : theme.scheme === 'dark' ? c.border : 'transparent',
                backgroundColor: sel ? c.primarySubtle : pressed ? c.surfaceSunken : c.surface,
                ...(focused ? { outlineColor: c.focusRing, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 2 } : null),
              } as never;
            }}
          >
            <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? c.primary : c.surfaceSunken }}>
              <Icon name={m.icon} size={20} weight={sel ? 'fill' : 'regular'} color={sel ? 'onPrimary' : 'textSecondary'} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" weight={sel ? 'semibold' : 'medium'} color={sel ? 'onPrimarySubtle' : 'text'} numberOfLines={2}>
                {t(m.label)}
              </Text>
              {hint ? <StatusPill tone="warning" label={t('checkin:methods.suggested')} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function GpsPanel({
  phase,
  samples,
  permission,
  pin,
  retry,
  onStart,
  onNotNow,
  onOtherWay,
}: {
  phase: GpsPhase;
  samples: GpsSample[];
  permission: LocationPermission | null;
  pin: { lat: number; lng: number } | null;
  retry: boolean;
  onStart: () => void;
  onNotNow: () => void;
  onOtherWay: () => void;
}) {
  const { t, locale } = useT();
  const theme = useTheme();
  const best = samples.length ? Math.min(...samples.map((s) => s.accuracyM)) : null;
  const quality = signalQuality(best);
  const dist = distanceToPin(samples, pin);
  const sampling = phase === 'sampling' || phase === 'submitting';
  const denied = phase === 'denied' || permission === 'denied' || permission === 'unavailable';

  if (phase === 'disclosure') {
    return (
      <View testID="checkin.gps" style={panelStyle(theme)}>
        <Stack gap="md" align="center" testID="checkin.location.disclosure">
          <Illustration name="location" size={128} />
          <Text variant="title3" align="center">
            {t('checkin:permission.location.title')}
          </Text>
          <Text variant="callout" color="textSecondary" align="center">
            {t('checkin:permission.location.body')}
          </Text>
          <Stack gap="xs" style={{ alignSelf: 'stretch' }}>
            <Button testID="checkin.location.allow" size="lg" fullWidth icon="GpsFix" label={t('checkin:permission.location.allow')} onPress={onStart} />
            <Button variant="ghost" label={t('common:actions.notNow')} onPress={onNotNow} />
          </Stack>
        </Stack>
      </View>
    );
  }

  return (
    <View testID="checkin.gps" style={[panelStyle(theme), { alignItems: 'center' }]}>
      <GpsRadar samples={samples} total={SAMPLE_COUNT} pin={pin} active={sampling} />
      <Stack gap="xxs" align="center">
        <Text variant="title3" align="center">
          {t('checkin:gps.title')}
        </Text>
        <Text variant="callout" color="textSecondary" align="center" aria-live="polite" testID="checkin.gps.progress">
          {sampling ? t('checkin:gps.progress', { done: samples.length, total: SAMPLE_COUNT }) : t('checkin:gps.intro')}
        </Text>
      </Stack>

      <View style={{ flexDirection: 'row', alignSelf: 'stretch', borderRadius: radius.md, backgroundColor: theme.colors.surfaceSunken, paddingTop: spacing.md, paddingBottom: spacing.md }}>
        <Metric label={t('checkin:gps.samplesLabel')} value={isolate(`${samples.length}/${SAMPLE_COUNT}`, 'ltr')}>
          <Row gap="xs" aria-hidden>
            {Array.from({ length: SAMPLE_COUNT }, (_, i) => (
              <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i < samples.length ? theme.colors.primary : theme.colors.border }} />
            ))}
          </Row>
        </Metric>
        <View aria-hidden style={{ width: 1, backgroundColor: theme.colors.border }} />
        <Metric
          testID={best !== null ? 'checkin.gps.accuracy' : undefined}
          label={t('checkin:gps.accuracyLabel')}
          value={best !== null ? isolate(`±${formatDistance(best, locale)}`, 'ltr') : '—'}
          a11y={best !== null ? t('checkin:gps.accuracy', { accuracy: isolate(`±${formatDistance(best, locale)}`, 'ltr') }) : undefined}
        >
          <Row gap="xs">
            <SignalBars quality={quality} />
            {quality ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {t(`checkin:gps.quality.${quality}`)}
              </Text>
            ) : null}
          </Row>
        </Metric>
        {pin ? (
          <>
            <View aria-hidden style={{ width: 1, backgroundColor: theme.colors.border }} />
            <Metric testID="checkin.gps.distance" label={t('checkin:gps.distanceLabel')} value={dist !== null ? isolate(formatDistance(dist, locale), 'ltr') : '—'}>
              <Icon name="MapPin" size={16} weight="fill" color={dist !== null && dist <= DEFAULT_TRUST_CONFIG.gpsBaseRadiusM ? 'success' : 'textTertiary'} />
            </Metric>
          </>
        ) : null}
      </View>

      {denied ? (
        <Stack gap="sm" style={{ alignSelf: 'stretch' }}>
          <Notice tone="warning" icon="GpsFix" testID="checkin.location.denied" text={t('checkin:permission.location.denied')} />
          <Button variant="secondary" size="lg" fullWidth icon="QrCode" label={t('checkin:qr.enterCode')} onPress={onOtherWay} />
        </Stack>
      ) : (
        <Button
          testID="checkin.gps.start"
          size="lg"
          fullWidth
          icon={retry ? 'ArrowClockwise' : 'GpsFix'}
          label={retry ? t('checkin:gps.retry') : t('checkin:gps.start')}
          loading={sampling}
          loadingLabel={t('checkin:gps.progress', { done: samples.length, total: SAMPLE_COUNT })}
          onPress={onStart}
          style={{ alignSelf: 'stretch' }}
        />
      )}
    </View>
  );
}

function Metric({ label, value, children, testID, a11y }: { label: string; value: string; children?: ReactNode; testID?: string; a11y?: string }) {
  return (
    <View testID={testID} accessible aria-label={a11y ?? `${label}: ${value}`} style={{ flex: 1, alignItems: 'center', gap: spacing.xs, paddingStart: spacing.xs, paddingEnd: spacing.xs }}>
      <Text variant="caption" color="textSecondary" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="statSmall" numberOfLines={1}>
        {value}
      </Text>
      {children}
    </View>
  );
}

/** Success: the ring closes, the pin turns into a check with a bouncy spring, confetti once. */
function Success({ method, celebrate }: { method: string; celebrate: boolean }) {
  const { t } = useT();
  const theme = useTheme();
  const scale = useRef(new Animated.Value(celebrate && !theme.reducedMotion ? 0.4 : 1)).current;
  useEffect(() => {
    if (!celebrate || theme.reducedMotion) return;
    Animated.spring(scale, { toValue: 1, damping: 12, stiffness: 260, mass: 0.9, useNativeDriver: false }).start();
  }, [celebrate, theme.reducedMotion, scale]);
  return (
    <View testID="checkin.status" aria-live="polite" style={[panelStyle(theme), { alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.xxl, overflow: 'hidden' }]}>
      <View style={{ width: 200, height: 200, alignItems: 'center', justifyContent: 'center' }}>
        <Confetti size={300} play={celebrate} />
        <ProgressRing progress={1} size={168} thickness={12} color="success" animated={celebrate}>
          <Animated.View style={{ transform: [{ scale }], width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.successSubtle }}>
            <Icon name="CheckCircle" size={72} weight="fill" color="success" />
          </Animated.View>
        </ProgressRing>
      </View>
      <Stack gap="xs" align="center">
        <Text variant="title1" align="center">
          {t('checkin:success.title')}
        </Text>
        <StatusPill tone="success" icon={method === 'qr' ? 'QrCode' : method === 'peer' ? 'UsersThree' : method === 'host' ? 'SealCheck' : 'GpsFix'} label={t('checkin:success.method', { method })} size="md" />
        <Text variant="callout" color="textSecondary" align="center" style={{ marginTop: spacing.xs }}>
          {t('checkin:success.subtitle')}
        </Text>
      </Stack>
    </View>
  );
}

function CheckInSkeleton() {
  const { t } = useT();
  const theme = useTheme();
  return (
    <View testID="state.loading" aria-busy aria-label={t('common:status.loading')} style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={64} radius={radius.lg} style={{ flexBasis: '45%', flexGrow: 1, width: undefined }} />
        ))}
      </View>
      <View style={[panelStyle(theme), { alignItems: 'center' }]}>
        <Skeleton width={220} height={220} radius={110} />
        <Skeleton width="70%" height={16} />
        <Skeleton height={56} radius={radius.md} />
      </View>
    </View>
  );
}
