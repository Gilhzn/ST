/**
 * Create Game wizard (design v2 §15.5): full-screen modal with a close button, "Step 2 of 5"
 * and a segmented progress bar (mirrors). Sport tiles → venue cards (or a dropped pin) →
 * calendar day tiles, time and duration → big capacity / minimum steppers, visibility cards and
 * explained switches → deposit tiers → a review card with per-row Edit. Publishing shows a
 * success illustration with the game card and share actions (success haptic). Inline validation
 * per step, a local autosaved draft and a discard prompt.
 */
import { SPORT_IDS, type GameDetail, type LatLng, type NearbyVenue, type SportId } from '@st/domain';
import {
  BidiText,
  Button,
  Card,
  EmptyState,
  Haptics,
  Icon,
  IconButton,
  Illustration,
  isolate,
  ListGroup,
  ListItem,
  radius,
  Segmented,
  spacing,
  SportGlyphBadge,
  StatusPill,
  Text,
  TextField,
  usePressScale,
  useTheme,
  type IconName,
} from '@st/ui';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Linking, Platform, Pressable, ScrollView, Switch, View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { GameCard } from '@/components/GameCard';
import { goBack, Screen } from '@/components/Screen';
import { SelectField } from '@/components/SelectField';
import { Banner, InlineError, Skeleton } from '@/components/States';
import { SportTile } from '@/components/SportTile';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { DEFAULT_MAP_CENTER } from '@/features/map/cities';
import { compactMinutes } from '@/features/game/DetailsParts';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { currencyForCountry } from '@/lib/currency';
import { deviceRegion } from '@/lib/device';
import { currencyDigits, formatDate, formatDateTime, formatDistance, formatDuration, formatList, formatMoney, formatNumber, formatTime, usesMiles } from '@/lib/format';
import { getCurrentPosition, getLocationPermission } from '@/platform/location';
import { getPref, PrefKeys, setPref } from '@/state/prefs';
import { useSession } from '@/state/session';

const STEPS = ['sport', 'where', 'when', 'who', 'deposit'] as const;
const DURATIONS = [60, 90, 120];
const DAYS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const QUICK_TIMES = ['07:00', '12:00', '18:00', '19:30', '21:00'];
/** Deposit tiers in major units of the venue currency (plus None and Custom). */
const DEPOSIT_TIERS = ['10', '20', '50'];

/** Capacity range and defaults per sport (host included). */
const CAPACITY: Record<SportId, { min: number; max: number; def: number; teams: number }> = {
  football: { min: 4, max: 22, def: 10, teams: 2 },
  basketball: { min: 2, max: 12, def: 10, teams: 2 },
  tennis: { min: 2, max: 4, def: 2, teams: 2 },
  padel: { min: 2, max: 4, def: 4, teams: 2 },
  running: { min: 2, max: 50, def: 10, teams: 1 },
  volleyball: { min: 4, max: 14, def: 12, teams: 2 },
};
/** Minimum players for the game to go ahead (PRD GAME-001), clamped to 2..capacity. */
const MIN_PLAYERS: Record<SportId, number> = { football: 10, basketball: 6, tennis: 2, padel: 4, running: 2, volleyball: 8 };
const clampMin = (n: number, capacity: number) => Math.max(2, Math.min(capacity, n));
const DEPOSIT_MIN = 1;
const DEPOSIT_MAX = 200;

interface Draft {
  sport: SportId | null;
  title: string;
  teamCount: number;
  venueId: string | null;
  usePin: boolean;
  pinName: string;
  hideExact: boolean;
  day: number;
  time: string;
  duration: number;
  capacity: number;
  /** Null until the host changes it: follows the sport default. */
  minPlayers: number | null;
  visibility: 'public' | 'private';
  womenOnly: boolean;
  depositOn: boolean;
  deposit: string;
}

function defaultTime(): string {
  const d = new Date(Date.now() + 90 * 60_000);
  const m = d.getMinutes() < 30 ? 30 : 0;
  const h = (d.getHours() + (m === 0 ? 1 : 0)) % 24;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function startIso(day: number, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() + day);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

const EMPTY: Draft = {
  sport: null,
  title: '',
  teamCount: 2,
  venueId: null,
  usePin: false,
  pinName: '',
  hideExact: false,
  day: 0,
  time: defaultTime(),
  duration: 90,
  capacity: 10,
  minPlayers: null,
  visibility: 'public',
  womenOnly: false,
  depositOn: false,
  deposit: '',
};

export default function CreateGameScreen() {
  const { t, locale } = useT();
  const theme = useTheme();
  const port = useData();
  const toast = useToast();
  const { profile } = useSession();
  const params = useLocalSearchParams<{ venueId?: string }>();
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, venueId: typeof params.venueId === 'string' ? params.venueId : null });
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [center, setCenter] = useState<LatLng>(DEFAULT_MAP_CENTER);
  const [published, setPublished] = useState<GameDetail | null>(null);
  const [customDeposit, setCustomDeposit] = useState(false);
  const restored = useRef(false);
  const miles = useMemo(() => usesMiles(deviceRegion()), []);

  // Restore an autosaved draft (unless opened for a specific venue) and the location.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!params.venueId) {
        const saved = await getPref<Draft>(PrefKeys.createGameDraft);
        if (alive && saved && typeof saved === 'object') setDraft({ ...EMPTY, ...saved, time: saved.time || defaultTime() });
      }
      restored.current = true;
      if ((await getLocationPermission()) === 'granted') {
        const fix = await getCurrentPosition();
        if (alive && fix) setCenter(fix.location);
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.venueId]);

  useEffect(() => {
    if (restored.current && !published) void setPref(PrefKeys.createGameDraft, draft);
  }, [draft, published]);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const venues = useAsync(
    () => port.nearbyVenues(center, 30, draft.sport ? [draft.sport] : []),
    [port, center.lat, center.lng, draft.sport],
  );
  const preselected = useAsync(() => (draft.venueId ? port.getVenue(draft.venueId) : Promise.resolve(null)), [port, draft.venueId]);
  const venue = (venues.data ?? []).find((v) => v.id === draft.venueId) ?? preselected.data ?? null;
  const currency = currencyForCountry(venue?.countryCode ?? profile?.countryCode ?? null);
  const cap = draft.sport ? CAPACITY[draft.sport] : CAPACITY.football;
  const minPlayers = clampMin(draft.minPlayers ?? (draft.sport ? MIN_PLAYERS[draft.sport] : 2), draft.capacity);
  const startsAt = startIso(draft.day, draft.time);
  const endsAt = new Date(Date.parse(startsAt) + draft.duration * 60_000).toISOString();
  const depositMajor = Number(draft.deposit.replace(',', '.'));
  const depositMinor = draft.depositOn && Number.isFinite(depositMajor) ? Math.round(depositMajor * 10 ** currencyDigits(currency, locale)) : 0;
  const hostSuspended = !!profile?.hostSuspendedUntil && Date.parse(profile.hostSuspendedUntil) > Date.now();

  const errors = {
    sport: !draft.sport ? t('games:wizard.validation.sportRequired') : null,
    where: !draft.venueId && !(draft.usePin && draft.pinName.trim()) ? t('games:wizard.validation.venueRequired') : null,
    when: Date.parse(startsAt) <= Date.now() ? t('games:wizard.validation.startInPast') : null,
    who:
      draft.capacity < cap.min || draft.capacity > cap.max
        ? t('games:wizard.validation.capacityRange', { min: cap.min, max: cap.max })
        : null,
    deposit:
      draft.depositOn && (!Number.isFinite(depositMajor) || depositMajor < DEPOSIT_MIN || depositMajor > DEPOSIT_MAX)
        ? t('games:wizard.validation.depositRange', {
            min: formatMoney(DEPOSIT_MIN * 10 ** currencyDigits(currency, locale), currency, locale),
            max: formatMoney(DEPOSIT_MAX * 10 ** currencyDigits(currency, locale), currency, locale),
          })
        : null,
  };
  const stepError = step < STEPS.length ? errors[STEPS[step] as keyof typeof errors] : null;

  const publish = useAction(async () => {
    const sport = draft.sport as SportId;
    let venueId = draft.venueId;
    let location: LatLng | null = null;
    if (!venueId && draft.usePin) {
      const created = await port.createVenue({ name: draft.pinName.trim(), location: center, sports: [sport] });
      venueId = created.id;
      location = created.location;
    }
    const game = await port.createGame({
      sport,
      title: draft.title.trim() || t('games:wizard.defaultTitle', { sport: t(`common:sports.${sport}`) }),
      notes: null,
      visibility: draft.visibility,
      venueId,
      location,
      hideExactLocation: draft.hideExact,
      capacity: draft.capacity,
      minPlayers,
      startsAt,
      endsAt,
      depositMinor,
      currency,
      womenOnly: draft.womenOnly,
      teamCount: Math.min(draft.teamCount, draft.capacity),
    });
    await setPref(PrefKeys.createGameDraft, null);
    return game;
  });

  const goTo = (n: number) => {
    setStep(n);
    setShowErrors(false);
    const label = n < STEPS.length ? t('games:wizard.stepOf', { current: n + 1, total: STEPS.length }) : t('games:wizard.review.title');
    AccessibilityInfo.announceForAccessibility?.(label);
  };
  const next = () => {
    if (stepError) {
      setShowErrors(true);
      return;
    }
    goTo(step + 1);
  };
  const back = () => {
    if (step > 0 && !published) goTo(step - 1);
    else if (draft.sport && !published) setDiscard(true);
    else goBack('/map');
  };
  const close = () => {
    if (draft.sport && !published) setDiscard(true);
    else goBack('/map');
  };

  if (hostSuspended) {
    return (
      <Screen testID="screen.game.create" title={t('games:wizard.title')} backFallback="/map">
        <EmptyState
          tone="restricted"
          title={t('games:wizard.hostSuspended.title')}
          body={t('games:wizard.hostSuspended.body')}
          actionLabel={t('games:wizard.hostSuspended.action')}
          onAction={() => router.replace('/profile')}
        />
      </Screen>
    );
  }

  if (published) {
    const url = `${Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://sporttalent.app'}/invite/${published.inviteToken ?? ''}`;
    return (
      <Screen
        testID="screen.game.create.done"
        back={false}
        contentStyle={{ gap: spacing.xl, paddingTop: spacing.xl }}
        footer={<Button testID="game.create.view" size="lg" fullWidth iconEnd="ArrowRight" label={t('games:wizard.published.viewGame')} onPress={() => router.replace(`/game/${published.id}`)} />}
      >
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          <Illustration name="success" size={160} />
          <Text variant="title1" align="center" role="heading" aria-level={1}>
            {t('games:wizard.published.title')}
          </Text>
          <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 340 }}>
            {t('games:wizard.published.body')}
          </Text>
        </View>
        <GameCard game={{ ...published, approvedCount: published.approvedCount, waitlistCount: published.waitlistCount }} now={Date.now()} />
        <View style={{ gap: spacing.sm }}>
          <Text variant="overline" color="textTertiary">
            {t('games:wizard.published.shareTitle')}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                testID="game.create.share.whatsapp"
                variant="secondary"
                fullWidth
                icon="WhatsappLogo"
                label={t('games:wizard.published.whatsapp')}
                onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(`${published.title} ${url}`)}`)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                testID="game.create.share.copy"
                variant="secondary"
                fullWidth
                icon="Copy"
                label={t('games:wizard.published.copyLink')}
                onPress={async () => {
                  await Clipboard.setStringAsync(url);
                  Haptics.selection();
                  toast(t('games:wizard.published.linkCopied'), 'success');
                }}
              />
            </View>
          </View>
        </View>
      </Screen>
    );
  }

  const isReview = step === STEPS.length;
  const stepLabel = isReview ? t('games:wizard.review.title') : t('games:wizard.stepOf', { current: step + 1, total: STEPS.length });

  const header = (
    <View style={{ width: '100%', maxWidth: 760, alignSelf: 'center', paddingStart: spacing.sm, paddingEnd: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 52 }}>
        <IconButton testID="nav.back" icon="X" label={t('common:actions.close')} color="text" onPress={close} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="headline" role="heading" aria-level={1}>
            {t('games:wizard.title')}
          </Text>
          <Text variant="caption" color="textSecondary" aria-live="polite" testID="game.create.step">
            {stepLabel}
          </Text>
        </View>
        <View style={{ width: 44 }} />
      </View>
      <View
        role="progressbar"
        aria-label={stepLabel}
        aria-valuemin={0}
        aria-valuemax={STEPS.length + 1}
        aria-valuenow={step + 1}
        style={{ flexDirection: 'row', gap: spacing.xs, paddingStart: spacing.sm }}
      >
        {[...STEPS, 'review'].map((name, i) => (
          <View key={name} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? theme.colors.primary : theme.colors.surfaceSunken }} />
        ))}
      </View>
    </View>
  );

  const footer = (
    <>
      {showErrors && stepError ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Icon name="WarningCircle" size={16} weight="bold" color="dangerText" />
          <Text variant="footnote" color="dangerText" aria-live="polite" testID="game.create.error" style={{ flex: 1 }}>
            {stepError}
          </Text>
        </View>
      ) : null}
      <InlineError error={publish.error} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button testID="game.create.back" variant="outline" size="lg" icon="ArrowLeft" label={t('common:actions.back')} onPress={back} />
        <View style={{ flex: 1 }}>
          {isReview ? (
            <Button
              testID="game.create.publish"
              size="lg"
              fullWidth
              icon="Confetti"
              haptic="publishGame"
              label={t('games:wizard.review.publish')}
              loading={publish.busy}
              loadingLabel={t('games:wizard.review.publishing')}
              onPress={async () => {
                const g = await publish.run();
                if (g) setPublished(g);
              }}
            />
          ) : (
            <Button testID="game.create.next" size="lg" fullWidth iconEnd="ArrowRight" label={t('common:actions.next')} onPress={next} />
          )}
        </View>
      </View>
    </>
  );

  const depositTier = !draft.depositOn ? 'none' : customDeposit || !DEPOSIT_TIERS.includes(draft.deposit) ? 'custom' : draft.deposit;
  const money = (major: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(major);
    } catch {
      return formatMoney(major * 10 ** currencyDigits(currency, locale), currency, locale);
    }
  };

  return (
    <Screen testID="screen.game.create" header={header} footer={footer} contentStyle={{ gap: spacing.xl, paddingTop: spacing.lg }}>
      {step === 0 ? (
        <>
          <StepTitle title={t('games:wizard.sport.title')} subtitle={t('games:wizard.sport.subtitle')} />
          <View role="radiogroup" aria-label={t('games:wizard.stepName.sport')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            {SPORT_IDS.map((s) => (
              <SportTile
                key={s}
                testID={`game.create.sport.${s}`}
                sport={s}
                role="radio"
                label={t(`common:sports.${s}`)}
                caption={t('common:players.count', { count: CAPACITY[s].def })}
                selected={draft.sport === s}
                onPress={() => update({ sport: s, capacity: CAPACITY[s].def, minPlayers: null, teamCount: CAPACITY[s].teams, venueId: draft.venueId })}
              />
            ))}
          </View>
          <TextField
            testID="game.create.title"
            label={t('games:wizard.sport.gameTitleLabel')}
            helperText={t('games:wizard.sport.gameTitleHint')}
            icon="PencilSimple"
            value={draft.title}
            maxLength={80}
            onChangeText={(title) => update({ title })}
          />
          {draft.sport && draft.sport !== 'running' ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="label" color="textSecondary">
                {t('games:wizard.sport.teamCount')}
              </Text>
              <Segmented
                label={t('games:wizard.sport.teamCount')}
                value={String(draft.teamCount)}
                onChange={(v) => update({ teamCount: Number(v) })}
                options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: formatNumber(n, locale), testID: `game.create.teams.${n}` }))}
              />
            </View>
          ) : null}
        </>
      ) : null}

      {step === 1 ? (
        <>
          <StepTitle title={t('games:wizard.where.title')} subtitle={t('games:wizard.where.subtitle')} />
          {venues.loading && !venues.data ? <Skeleton kind="row" rows={4} /> : null}
          <View role="radiogroup" aria-label={t('games:wizard.stepName.where')} style={{ gap: spacing.sm }}>
            {(venues.data ?? []).slice(0, 12).map((v: NearbyVenue) => (
              <ChoiceCard
                key={v.id}
                testID={`game.create.venue.${v.id}`}
                selected={draft.venueId === v.id}
                onPress={() => update({ venueId: v.id, usePin: false })}
                title={v.name}
                subtitle={formatList([formatDistance(v.distanceM, locale, miles), ...(v.address ? [v.address] : [])], locale)}
                lead={<SportGlyphBadge sport={draft.sport && v.sports.includes(draft.sport) ? draft.sport : (v.sports[0] ?? 'football')} size={40} variant="tint" squircle />}
                userContent
              />
            ))}
            {preselected.data && !(venues.data ?? []).some((v) => v.id === preselected.data?.id) ? (
              <ChoiceCard testID={`game.create.venue.${preselected.data.id}`} selected title={preselected.data.name} subtitle={preselected.data.address ?? ''} icon="MapPin" onPress={() => undefined} userContent />
            ) : null}
            <ChoiceCard
              testID="game.create.pin"
              selected={draft.usePin}
              onPress={() => update({ usePin: true, venueId: null })}
              title={t('games:wizard.where.dropPin')}
              subtitle={t('games:wizard.where.pinHere')}
              icon="MapPinPlus"
            />
            {draft.usePin ? (
              <TextField
                testID="game.create.pinName"
                label={t('games:wizard.where.venueNameLabel')}
                helperText={t('games:wizard.where.venueNameHint')}
                value={draft.pinName}
                maxLength={120}
                onChangeText={(pinName) => update({ pinName })}
                required
              />
            ) : null}
          </View>
          <ToggleRow
            testID="game.create.hideExact"
            icon="LockSimple"
            label={t('games:wizard.where.hideExactLabel')}
            help={t('games:wizard.where.hideExactHelp')}
            value={draft.hideExact}
            onChange={(hideExact) => update({ hideExact })}
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <StepTitle title={t('games:wizard.when.title')} subtitle={t('games:wizard.when.subtitle')} />
          <View style={{ gap: spacing.sm }}>
            <Text variant="label" color="textSecondary">
              {t('games:wizard.when.date')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingEnd: spacing.lg }} style={{ marginEnd: -spacing.lg }}>
              <View role="radiogroup" aria-label={t('games:wizard.when.date')} style={{ flexDirection: 'row', gap: spacing.sm }}>
                {DAYS.map((d) => (
                  <DayTile key={d} day={d} selected={draft.day === d} onPress={() => update({ day: d })} />
                ))}
              </View>
            </ScrollView>
          </View>
          <View style={{ gap: spacing.sm }}>
            <TimeSelect value={draft.time} onChange={(time) => update({ time })} label={t('games:wizard.when.start')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {QUICK_TIMES.map((qt) => (
                <ChoiceChip
                  key={qt}
                  size="sm"
                  selectionRole="radio"
                  testID={`game.create.quickTime.${qt}`}
                  label={timeLabel(qt, locale)}
                  selected={draft.time === qt}
                  onToggle={() => update({ time: qt })}
                />
              ))}
            </View>
          </View>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label" color="textSecondary">
              {t('games:wizard.when.duration')}
            </Text>
            <Segmented
              label={t('games:wizard.when.duration')}
              value={String(draft.duration)}
              onChange={(v) => update({ duration: Number(v) })}
              options={DURATIONS.map((m) => ({ value: String(m), label: compactMinutes(m, locale), testID: `game.create.duration.${m}` }))}
            />
          </View>
          <ToggleRow
            icon="ArrowClockwise"
            label={t('games:wizard.when.repeatWeekly')}
            help={t('games:wizard.when.comingSoon')}
            value={false}
            onChange={() => undefined}
            disabled
          />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <StepTitle title={t('games:wizard.who.title')} subtitle={t('games:wizard.who.subtitle')} />
          <Card padding="lg">
            <View style={{ gap: spacing.lg }}>
              <Stepper
                id="capacity"
                label={t('games:wizard.who.capacity')}
                help={t('games:wizard.who.capacityRange', { min: cap.min, max: cap.max })}
                value={draft.capacity}
                decLabel={t('games:wizard.who.fewer')}
                incLabel={t('games:wizard.who.more')}
                canDec={draft.capacity > cap.min}
                canInc={draft.capacity < cap.max}
                onDec={() => update({ capacity: Math.max(cap.min, draft.capacity - 1) })}
                onInc={() => update({ capacity: Math.min(cap.max, draft.capacity + 1) })}
              />
              <View aria-hidden style={{ height: 1, backgroundColor: theme.colors.border }} />
              <Stepper
                id="minPlayers"
                label={t('games:wizard.who.minPlayers')}
                help={t('games:wizard.who.minPlayersHelp', { count: minPlayers })}
                value={minPlayers}
                decLabel={t('games:wizard.who.fewerMin')}
                incLabel={t('games:wizard.who.moreMin')}
                canDec={minPlayers > 2}
                canInc={minPlayers < draft.capacity}
                onDec={() => update({ minPlayers: minPlayers - 1 })}
                onInc={() => update({ minPlayers: minPlayers + 1 })}
              />
            </View>
          </Card>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label" color="textSecondary">
              {t('games:wizard.who.visibility')}
            </Text>
            <View role="radiogroup" aria-label={t('games:wizard.who.visibility')} style={{ gap: spacing.sm }}>
              <ChoiceCard testID="game.create.visibility.public" selected={draft.visibility === 'public'} onPress={() => update({ visibility: 'public' })} title={t('games:wizard.who.public')} subtitle={t('games:wizard.who.publicHelp')} icon="GlobeHemisphereWest" />
              <ChoiceCard testID="game.create.visibility.private" selected={draft.visibility === 'private'} onPress={() => update({ visibility: 'private' })} title={t('games:wizard.who.private')} subtitle={t('games:wizard.who.privateHelp')} icon="LockSimple" />
            </View>
          </View>
          <ToggleRow
            testID="game.create.womenOnly"
            icon="GenderFemale"
            label={t('games:wizard.who.womenOnly')}
            help={t('games:wizard.who.womenOnlyHelp')}
            value={draft.womenOnly}
            onChange={(womenOnly) => update({ womenOnly, hideExact: womenOnly ? true : draft.hideExact })}
          />
          <Banner tone="info" icon="Handshake" text={t('games:wizard.who.approvalManual')} />
        </>
      ) : null}

      {step === 4 ? (
        <>
          <StepTitle title={t('games:wizard.deposit.title')} subtitle={t('games:wizard.deposit.subtitle')} />
          <Segmented
            testID="game.create.deposit.toggle"
            label={t('games:wizard.deposit.toggle')}
            value={depositTier}
            onChange={(v) => {
              if (v === 'none') {
                setCustomDeposit(false);
                update({ depositOn: false });
              } else if (v === 'custom') {
                setCustomDeposit(true);
                update({ depositOn: true, deposit: DEPOSIT_TIERS.includes(draft.deposit) ? '' : draft.deposit });
              } else {
                setCustomDeposit(false);
                update({ depositOn: true, deposit: v });
              }
            }}
            options={[
              { value: 'none', label: t('games:wizard.deposit.none'), testID: 'game.create.deposit.tier.none' },
              ...DEPOSIT_TIERS.map((v) => ({ value: v, label: money(Number(v)), testID: `game.create.deposit.tier.${v}` })),
              { value: 'custom', label: t('games:wizard.deposit.custom'), testID: 'game.create.deposit.tier.custom' },
            ]}
          />
          {depositTier === 'custom' ? (
            <TextField
              testID="game.create.deposit.amount"
              label={t('games:wizard.deposit.amount')}
              value={draft.deposit}
              onChangeText={(deposit) => update({ deposit: deposit.replace(/[^\d.,]/g, '') })}
              keyboardType="decimal-pad"
              inputDirection="ltr"
              icon="Coins"
              start={<Text variant="body" weight="medium" color="textSecondary">{currency}</Text>}
              error={showErrors && errors.deposit ? errors.deposit : undefined}
            />
          ) : null}
          <Card variant="filled" padding="lg">
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View aria-hidden style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.warningSubtle }}>
                <Icon name="Coins" size={22} weight="duotone" color="warningText" />
              </View>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text variant="headline">{depositMinor > 0 ? formatMoney(depositMinor, currency, locale) : t('games:wizard.review.noDeposit')}</Text>
                <Text variant="footnote" color="textSecondary">
                  {depositMinor > 0 ? t('games:wizard.deposit.explain', { amount: formatMoney(depositMinor, currency, locale) }) : t('games:wizard.deposit.noneHelp')}
                </Text>
                <Text variant="caption" color="textTertiary">
                  {t('games:wizard.deposit.currencyNote')}
                </Text>
              </View>
            </View>
          </Card>
        </>
      ) : null}

      {isReview ? (
        <View style={{ gap: spacing.xl }} testID="game.create.review">
          <StepTitle title={t('games:wizard.review.title')} subtitle={t('games:wizard.review.subtitle')} />
          {draft.sport ? (
            <GameCard
              now={Date.now()}
              venueName={venue?.name ?? (draft.pinName.trim() || undefined)}
              game={{
                id: 'draft',
                hostId: profile?.id ?? 'me',
                sport: draft.sport,
                title: draft.title.trim() || t('games:wizard.defaultTitle', { sport: t(`common:sports.${draft.sport}`) }),
                notes: null,
                visibility: draft.visibility,
                venueId: draft.venueId,
                location: null,
                approxLocation: center,
                hideExactLocation: draft.hideExact,
                capacity: draft.capacity,
                minPlayers,
                startsAt,
                endsAt,
                depositMinor,
                currency,
                depositForfeitTo: 'host',
                womenOnly: draft.womenOnly,
                status: 'scheduled',
                teamCount: draft.teamCount,
                inviteToken: null,
                createdAt: startsAt,
                approvedCount: 1,
                waitlistCount: 0,
              }}
            />
          ) : null}
          <ListGroup>
            <ReviewRow icon="SoccerBall" label={t('games:wizard.stepName.sport')} value={draft.sport ? t(`common:sports.${draft.sport}`) : '—'} onEdit={() => goTo(0)} />
            <ReviewRow icon="MapPin" label={t('games:wizard.stepName.where')} value={venue?.name ?? (draft.pinName || '—')} onEdit={() => goTo(1)} />
            <ReviewRow
              icon="CalendarDots"
              label={t('games:wizard.stepName.when')}
              value={t('games:wizard.review.whenValue', { start: isolate(formatDateTime(startsAt, locale), 'ltr'), duration: formatDuration(draft.duration, locale) })}
              onEdit={() => goTo(2)}
            />
            <ReviewRow
              icon="UsersThree"
              label={t('games:wizard.stepName.who')}
              value={t('games:wizard.review.whoValue', { capacity: draft.capacity, min: minPlayers, visibility: t(`games:wizard.who.${draft.visibility}`) })}
              onEdit={() => goTo(3)}
            />
            <ReviewRow
              icon="Coins"
              label={t('games:wizard.stepName.deposit')}
              value={depositMinor > 0 ? formatMoney(depositMinor, currency, locale) : t('games:wizard.review.noDeposit')}
              onEdit={() => goTo(4)}
            />
          </ListGroup>
        </View>
      ) : null}

      <ConfirmDialog
        testID="game.create.discard"
        visible={discard}
        title={t('games:wizard.discard.title')}
        body={t('games:wizard.discard.body')}
        confirmLabel={t('games:wizard.discard.discard')}
        cancelLabel={t('games:wizard.discard.keep')}
        destructive
        icon="Trash"
        onConfirm={async () => {
          setDiscard(false);
          await setPref(PrefKeys.createGameDraft, null);
          goBack('/map');
        }}
        onCancel={() => setDiscard(false)}
      />
    </Screen>
  );
}

function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="title1" role="heading" aria-level={2}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="callout" color="textSecondary">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/** Selectable card (radio): icon well or custom lead, title (bidi-safe for venues), subtitle, check disc. */
function ChoiceCard({
  title,
  subtitle,
  selected,
  onPress,
  testID,
  icon,
  lead,
  userContent,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  icon?: IconName;
  lead?: ReactNode;
  userContent?: boolean;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const press = usePressScale(0.985);
  return (
    <Animated.View style={press.style}>
      <Pressable
        testID={testID}
        role="radio"
        aria-checked={selected}
        aria-label={subtitle ? `${title}, ${subtitle}` : title}
        onPress={() => {
          Haptics.trigger('chipToggle');
          onPress();
        }}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          minHeight: 72,
          padding: spacing.md,
          paddingEnd: spacing.lg,
          borderRadius: radius.lg,
          borderWidth: 2,
          borderColor: selected ? c.primary : theme.scheme === 'dark' ? c.border : 'transparent',
          backgroundColor: selected ? c.primarySubtle : pressed ? c.surfaceSunken : c.surface,
          ...(selected ? null : theme.elevation(1)),
        })}
      >
        {lead ??
          (icon ? (
            <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.surface : c.surfaceSunken }}>
              <Icon name={icon} size={22} weight="duotone" color={selected ? 'primary' : 'textSecondary'} />
            </View>
          ) : null)}
        <View style={{ flex: 1, gap: 2 }}>
          {userContent ? (
            <BidiText variant="headline" color={selected ? 'onPrimarySubtle' : 'text'} numberOfLines={2}>
              {title}
            </BidiText>
          ) : (
            <Text variant="headline" color={selected ? 'onPrimarySubtle' : 'text'} numberOfLines={2}>
              {title}
            </Text>
          )}
          {subtitle ? (
            <Text variant="footnote" color={selected ? 'onPrimarySubtle' : 'textSecondary'} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.primary : 'transparent', borderWidth: selected ? 0 : 1.5, borderColor: c.borderStrong }}>
          {selected ? <Icon name="Check" size={14} weight="bold" color="onPrimary" /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Explained switch row in a card: icon well, label, help text, Switch. */
function ToggleRow({
  label,
  help,
  value,
  onChange,
  testID,
  disabled,
  icon,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
  disabled?: boolean;
  icon?: IconName;
}) {
  const { colors } = useTheme();
  const { t } = useT();
  return (
    <Card padding="lg" style={disabled ? { opacity: 0.6 } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        {icon ? (
          <View aria-hidden style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: value ? colors.primarySubtle : colors.surfaceSunken }}>
            <Icon name={icon} size={22} weight="duotone" color={value ? 'onPrimarySubtle' : 'textSecondary'} />
          </View>
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Text variant="headline">{label}</Text>
            {disabled ? <StatusPill label={t('games:wizard.when.comingSoon')} /> : null}
          </View>
          {help && !disabled ? (
            <Text variant="footnote" color="textSecondary">
              {help}
            </Text>
          ) : null}
        </View>
        <Switch
          testID={testID}
          aria-label={label}
          value={value}
          onValueChange={(v) => {
            Haptics.trigger('chipToggle');
            onChange(v);
          }}
          disabled={disabled}
          trackColor={{ true: colors.primary, false: colors.borderStrong }}
          thumbColor="#FFFFFF"
          {...(Platform.OS === 'web' ? ({ activeThumbColor: '#FFFFFF' } as object) : null)}
        />
      </View>
    </Card>
  );
}

/** Big stepper: tonal −/+ (selection haptic) around a statLarge tabular value. */
function Stepper({
  id,
  label,
  help,
  value,
  decLabel,
  incLabel,
  canDec,
  canInc,
  onDec,
  onInc,
}: {
  id: string;
  label: string;
  help: string;
  value: number;
  decLabel: string;
  incLabel: string;
  canDec: boolean;
  canInc: boolean;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="headline">{label}</Text>
        <Text variant="footnote" color="textSecondary">
          {help}
        </Text>
      </View>
      <IconButton testID={`game.create.${id}.dec`} icon="Minus" weight="bold" variant="tonal" size="lg" haptic="scorePlusMinus" label={decLabel} disabled={!canDec} onPress={onDec} />
      <Text variant="statLarge" testID={`game.create.${id}.value`} aria-live="polite" align="center" style={{ minWidth: 64, fontSize: 36, lineHeight: 42 }}>
        {isolate(String(value), 'ltr')}
      </Text>
      <IconButton testID={`game.create.${id}.inc`} icon="Plus" weight="bold" variant="tonal" size="lg" haptic="scorePlusMinus" label={incLabel} disabled={!canInc} onPress={onInc} />
    </View>
  );
}

/** Calendar day tile: weekday short + big date number; "Today"/"Tomorrow" as the weekday line. */
function DayTile({ day, selected, onPress }: { day: number; selected: boolean; onPress: () => void }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const c = theme.colors;
  const iso = startIso(day, '12:00');
  const top = day === 0 ? t('games:my.section.today') : day === 1 ? t('games:my.section.tomorrow') : formatDate(iso, locale, { weekday: 'short' });
  const num = formatDate(iso, locale, { day: 'numeric' });
  const month = formatDate(iso, locale, { month: 'short' });
  return (
    <Pressable
      testID={`game.create.day.${day}`}
      role="radio"
      aria-checked={selected}
      aria-label={formatDate(iso, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
      onPress={() => {
        Haptics.trigger('chipToggle');
        onPress();
      }}
      style={({ pressed }) => ({
        width: 76,
        paddingTop: spacing.md,
        paddingBottom: spacing.md,
        borderRadius: radius.lg,
        alignItems: 'center',
        gap: 2,
        backgroundColor: selected ? c.surfaceInverse : pressed ? c.surfaceSunken : c.surface,
        ...(selected ? null : theme.elevation(1)),
      })}
    >
      <Text variant="caption" weight="semibold" color={selected ? 'textInverse' : 'textSecondary'} numberOfLines={1}>
        {top}
      </Text>
      <Text variant="numeric" color={selected ? 'textInverse' : 'text'} style={{ fontSize: 26, lineHeight: 32 }}>
        {num}
      </Text>
      <Text variant="caption" color={selected ? 'textInverse' : 'textTertiary'} numberOfLines={1} style={{ opacity: selected ? 0.8 : 1 }}>
        {month}
      </Text>
    </Pressable>
  );
}

function timeLabel(v: string, locale: string): string {
  const [h, m] = v.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return formatTime(d.toISOString(), locale);
}

function TimeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { locale } = useT();
  const options = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const h = 6 + Math.floor(i / 2);
        const m = i % 2 ? 30 : 0;
        const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        return { value: v, label: timeLabel(v, locale) };
      }),
    [locale],
  );
  const all = options.some((o) => o.value === value) ? options : [{ value, label: timeLabel(value, locale) }, ...options];
  return <SelectField testID="game.create.time" icon="Clock" label={label} placeholder={label} value={value} options={all} onChange={onChange} />;
}

function ReviewRow({ icon, label, value, onEdit }: { icon: IconName; label: string; value: string; onEdit: () => void }) {
  const { t } = useT();
  return (
    <ListItem
      icon={icon}
      title={value}
      subtitle={label}
      onPress={onEdit}
      aria-label={t('games:wizard.review.editA11y', { section: label })}
      trailing={
        <Text variant="label" weight="semibold" color="primaryText">
          {t('games:wizard.review.edit')}
        </Text>
      }
    />
  );
}
