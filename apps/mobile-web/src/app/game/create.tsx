/**
 * Create Game wizard (design §13.5): Sport → Where → When → Who → Deposit →
 * Review, with a mirrored stepper ("Step 2 of 5"), inline validation per step,
 * a local draft, a discard prompt, and a share step after publishing.
 */
import { SPORT_IDS, type GameDetail, type LatLng, type NearbyVenue, type SportId } from '@st/domain';
import { BidiText, Button, Card, EmptyState, isolate, radius, Row, spacing, Stack, Text, TextField, useTheme } from '@st/ui';
import { ChoiceChip } from '@/components/ChoiceChip';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Linking, Platform, Pressable, Switch, View } from 'react-native';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { goBack, Screen } from '@/components/Screen';
import { SelectField } from '@/components/SelectField';
import { InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { DEFAULT_CENTER } from '@/data/mock/seed';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { currencyForCountry } from '@/lib/currency';
import { currencyDigits, formatDate, formatDateTime, formatDistance, formatDuration, formatMoney, formatTime } from '@/lib/format';
import { getCurrentPosition, getLocationPermission } from '@/platform/location';
import { getPref, PrefKeys, setPref } from '@/state/prefs';
import { useSession } from '@/state/session';

const STEPS = ['sport', 'where', 'when', 'who', 'deposit'] as const;
const DURATIONS = [60, 90, 120];
const DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Capacity range and defaults per sport (host included). */
const CAPACITY: Record<SportId, { min: number; max: number; def: number; teams: number }> = {
  football: { min: 4, max: 22, def: 10, teams: 2 },
  basketball: { min: 2, max: 12, def: 10, teams: 2 },
  tennis: { min: 2, max: 4, def: 2, teams: 2 },
  padel: { min: 2, max: 4, def: 4, teams: 2 },
  running: { min: 2, max: 50, def: 10, teams: 1 },
  volleyball: { min: 4, max: 14, def: 12, teams: 2 },
};
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
  const [center, setCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [published, setPublished] = useState<GameDetail | null>(null);
  const restored = useRef(false);

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
      <Screen testID="screen.game.create.done" title={t('games:wizard.published.title')} back={false}>
        <Stack gap="lg">
          <Card accentEdge>
            <Stack gap="xs">
              <Text variant="label" color="textSecondary">
                {t(`common:sports.${published.sport}`)}
              </Text>
              <BidiText variant="title2">{published.title}</BidiText>
              <Text variant="body" color="textSecondary">
                {isolate(formatDateTime(published.startsAt, locale), 'ltr')}
              </Text>
            </Stack>
          </Card>
          <Text variant="title3">{t('games:wizard.published.shareTitle')}</Text>
          <Row gap="sm" wrap>
            <Button
              testID="game.create.share.whatsapp"
              variant="secondary"
              label={t('games:wizard.published.whatsapp')}
              onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(`${published.title} ${url}`)}`)}
            />
            <Button
              testID="game.create.share.copy"
              variant="secondary"
              label={t('games:wizard.published.copyLink')}
              onPress={async () => {
                await Clipboard.setStringAsync(url);
                toast(t('games:wizard.published.linkCopied'));
              }}
            />
          </Row>
          <Button testID="game.create.view" size="lg" fullWidth label={t('games:wizard.published.viewGame')} onPress={() => router.replace(`/game/${published.id}`)} />
        </Stack>
      </Screen>
    );
  }

  const isReview = step === STEPS.length;
  const progress = Math.min(1, (step + 1) / (STEPS.length + 1));

  const footer = (
    <Stack gap="sm">
      {showErrors && stepError ? (
        <Text variant="callout" color="dangerText" accessibilityLiveRegion="polite" testID="game.create.error">
          {stepError}
        </Text>
      ) : null}
      <InlineError error={publish.error} />
      <Row gap="sm">
        <Button testID="game.create.back" variant="secondary" label={t('common:actions.back')} onPress={back} />
        <View style={{ flex: 1 }} />
        {isReview ? (
          <Button
            testID="game.create.publish"
            size="lg"
            label={t('games:wizard.review.publish')}
            loading={publish.busy}
            loadingLabel={t('games:wizard.review.publishing')}
            onPress={async () => {
              const g = await publish.run();
              if (g) setPublished(g);
            }}
          />
        ) : (
          <Button testID="game.create.next" size="lg" label={t('common:actions.next')} onPress={next} />
        )}
      </Row>
    </Stack>
  );

  return (
    <Screen testID="screen.game.create" title={t('games:wizard.title')} backFallback="/map" footer={footer}>
      <Stack gap="xs">
        <Text variant="label" color="textSecondary" accessibilityLiveRegion="polite" testID="game.create.step">
          {isReview ? t('games:wizard.review.title') : t('games:wizard.stepOf', { current: step + 1, total: STEPS.length })}
        </Text>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: STEPS.length + 1, now: step + 1 }}
          style={{ height: 6, borderRadius: radius.pill, backgroundColor: theme.colors.surfaceSunken, flexDirection: 'row', overflow: 'hidden' }}
        >
          <View style={{ width: `${progress * 100}%`, backgroundColor: theme.colors.primary }} />
        </View>
      </Stack>

      {step === 0 ? (
        <Stack gap="lg">
          <Text variant="title2">{t('games:wizard.sport.title')}</Text>
          <Row gap="sm" wrap accessibilityRole="radiogroup">
            {SPORT_IDS.map((s) => (
              <ChoiceChip
                key={s}
                testID={`game.create.sport.${s}`}
                sport={s}
                label={t(`common:sports.${s}`)}
                selectionRole="radio"
                selected={draft.sport === s}
                onToggle={() => update({ sport: s, capacity: CAPACITY[s].def, teamCount: CAPACITY[s].teams, venueId: draft.venueId })}
              />
            ))}
          </Row>
          <TextField
            testID="game.create.title"
            label={t('games:wizard.sport.gameTitleLabel')}
            helperText={t('games:wizard.sport.gameTitleHint')}
            value={draft.title}
            maxLength={80}
            onChangeText={(title) => update({ title })}
          />
          {draft.sport && draft.sport !== 'running' ? (
            <Stack gap="xs">
              <Text variant="label">{t('games:wizard.sport.teamCount')}</Text>
              <Row gap="sm" wrap accessibilityRole="radiogroup">
                {[1, 2, 3, 4].map((n) => (
                  <ChoiceChip key={n} testID={`game.create.teams.${n}`} label={String(n)} selectionRole="radio" selected={draft.teamCount === n} onToggle={() => update({ teamCount: n })} />
                ))}
              </Row>
            </Stack>
          ) : null}
        </Stack>
      ) : null}

      {step === 1 ? (
        <Stack gap="lg">
          <Text variant="title2">{t('games:wizard.where.title')}</Text>
          {venues.loading && !venues.data ? <Skeleton rows={3} height={64} /> : null}
          <Stack gap="sm">
            {(venues.data ?? []).slice(0, 12).map((v: NearbyVenue) => (
              <SelectableRow
                key={v.id}
                testID={`game.create.venue.${v.id}`}
                selected={draft.venueId === v.id}
                onPress={() => update({ venueId: v.id, usePin: false })}
                title={v.name}
                subtitle={formatDistance(v.distanceM, locale)}
              />
            ))}
            {preselected.data && !(venues.data ?? []).some((v) => v.id === preselected.data?.id) ? (
              <SelectableRow testID={`game.create.venue.${preselected.data.id}`} selected title={preselected.data.name} subtitle={preselected.data.address ?? ''} onPress={() => undefined} />
            ) : null}
            <SelectableRow
              testID="game.create.pin"
              selected={draft.usePin}
              onPress={() => update({ usePin: true, venueId: null })}
              title={t('games:wizard.where.dropPin')}
              subtitle={t('games:wizard.where.pinHere')}
              icon="map-marker-plus-outline"
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
          </Stack>
          <ToggleRow
            testID="game.create.hideExact"
            label={t('games:wizard.where.hideExactLabel')}
            help={t('games:wizard.where.hideExactHelp')}
            value={draft.hideExact}
            onChange={(hideExact) => update({ hideExact })}
          />
        </Stack>
      ) : null}

      {step === 2 ? (
        <Stack gap="lg">
          <Text variant="title2">{t('games:wizard.when.title')}</Text>
          <Stack gap="xs">
            <Text variant="label">{t('games:wizard.when.date')}</Text>
            <Row gap="sm" wrap accessibilityRole="radiogroup">
              {DAYS.map((d) => {
                const iso = startIso(d, '12:00');
                return (
                  <ChoiceChip key={d} testID={`game.create.day.${d}`} label={formatDate(iso, locale)} selectionRole="radio" selected={draft.day === d} onToggle={() => update({ day: d })} />
                );
              })}
            </Row>
          </Stack>
          <TimeSelect value={draft.time} onChange={(time) => update({ time })} label={t('games:wizard.when.start')} />
          <Stack gap="xs">
            <Text variant="label">{t('games:wizard.when.duration')}</Text>
            <Row gap="sm" wrap accessibilityRole="radiogroup">
              {DURATIONS.map((m) => (
                <ChoiceChip key={m} testID={`game.create.duration.${m}`} label={formatDuration(m, locale)} selectionRole="radio" selected={draft.duration === m} onToggle={() => update({ duration: m })} />
              ))}
            </Row>
          </Stack>
          <View style={{ opacity: 0.6 }}>
            <ToggleRow label={t('games:wizard.when.repeatWeekly')} help={t('games:wizard.when.comingSoon')} value={false} onChange={() => undefined} disabled />
          </View>
        </Stack>
      ) : null}

      {step === 3 ? (
        <Stack gap="lg">
          <Text variant="title2">{t('games:wizard.who.title')}</Text>
          <Stack gap="xs">
            <Text variant="label">{t('games:wizard.who.capacity')}</Text>
            <Row gap="md">
              <StepperButton testID="game.create.capacity.dec" icon="minus" label={t('games:wizard.who.fewer')} disabled={draft.capacity <= cap.min} onPress={() => update({ capacity: Math.max(cap.min, draft.capacity - 1) })} />
              <Text variant="numeric" testID="game.create.capacity.value" accessibilityLiveRegion="polite">
                {isolate(String(draft.capacity), 'ltr')}
              </Text>
              <StepperButton testID="game.create.capacity.inc" icon="plus" label={t('games:wizard.who.more')} disabled={draft.capacity >= cap.max} onPress={() => update({ capacity: Math.min(cap.max, draft.capacity + 1) })} />
            </Row>
            <Text variant="caption" color="textTertiary">
              {t('games:wizard.who.capacityRange', { min: cap.min, max: cap.max })}
            </Text>
          </Stack>
          <Stack gap="xs">
            <Text variant="label">{t('games:wizard.who.visibility')}</Text>
            <SelectableRow testID="game.create.visibility.public" selected={draft.visibility === 'public'} onPress={() => update({ visibility: 'public' })} title={t('games:wizard.who.public')} subtitle={t('games:wizard.who.publicHelp')} icon="earth" />
            <SelectableRow testID="game.create.visibility.private" selected={draft.visibility === 'private'} onPress={() => update({ visibility: 'private' })} title={t('games:wizard.who.private')} subtitle={t('games:wizard.who.privateHelp')} icon="lock-outline" />
          </Stack>
          <ToggleRow
            testID="game.create.womenOnly"
            label={t('games:wizard.who.womenOnly')}
            help={t('games:wizard.who.womenOnlyHelp')}
            value={draft.womenOnly}
            onChange={(womenOnly) => update({ womenOnly, hideExact: womenOnly ? true : draft.hideExact })}
          />
          <Text variant="caption" color="textTertiary">
            {t('games:wizard.who.approvalManual')}
          </Text>
        </Stack>
      ) : null}

      {step === 4 ? (
        <Stack gap="lg">
          <Text variant="title2">{t('games:wizard.deposit.title')}</Text>
          <ToggleRow testID="game.create.deposit.toggle" label={t('games:wizard.deposit.toggle')} value={draft.depositOn} onChange={(depositOn) => update({ depositOn })} />
          {draft.depositOn ? (
            <Stack gap="sm">
              <TextField
                testID="game.create.deposit.amount"
                label={t('games:wizard.deposit.amount')}
                value={draft.deposit}
                onChangeText={(deposit) => update({ deposit: deposit.replace(/[^\d.,]/g, '') })}
                keyboardType="decimal-pad"
                inputDirection="ltr"
                start={<Text variant="body" color="textSecondary">{currency}</Text>}
                error={showErrors && errors.deposit ? errors.deposit : undefined}
              />
              {depositMinor > 0 ? (
                <Text variant="callout" color="textSecondary">
                  {t('games:wizard.deposit.explain', { amount: formatMoney(depositMinor, currency, locale) })}
                </Text>
              ) : null}
              <Text variant="caption" color="textTertiary">
                {t('games:wizard.deposit.currencyNote')}
              </Text>
            </Stack>
          ) : null}
        </Stack>
      ) : null}

      {isReview ? (
        <Stack gap="md" testID="game.create.review">
          <ReviewRow label={t('games:wizard.stepName.sport')} value={draft.sport ? t(`common:sports.${draft.sport}`) : '—'} onEdit={() => goTo(0)} />
          <ReviewRow label={t('games:wizard.stepName.where')} value={venue?.name ?? (draft.pinName || '—')} onEdit={() => goTo(1)} />
          <ReviewRow
            label={t('games:wizard.stepName.when')}
            value={t('games:wizard.review.whenValue', { start: isolate(formatDateTime(startsAt, locale), 'ltr'), duration: formatDuration(draft.duration, locale) })}
            onEdit={() => goTo(2)}
          />
          <ReviewRow
            label={t('games:wizard.stepName.who')}
            value={t('games:wizard.review.whoValue', { capacity: draft.capacity, visibility: t(`games:wizard.who.${draft.visibility}`) })}
            onEdit={() => goTo(3)}
          />
          <ReviewRow
            label={t('games:wizard.stepName.deposit')}
            value={depositMinor > 0 ? formatMoney(depositMinor, currency, locale) : t('games:wizard.review.noDeposit')}
            onEdit={() => goTo(4)}
          />
        </Stack>
      ) : null}

      <ConfirmDialog
        testID="game.create.discard"
        visible={discard}
        title={t('games:wizard.discard.title')}
        body={t('games:wizard.discard.body')}
        confirmLabel={t('games:wizard.discard.discard')}
        cancelLabel={t('games:wizard.discard.keep')}
        destructive
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

function SelectableRow({
  title,
  subtitle,
  selected,
  onPress,
  testID,
  icon,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  icon?: Parameters<typeof Icon>[0]['name'];
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 56,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primarySubtle : pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      {icon ? <Icon name={icon} color={selected ? 'onPrimarySubtle' : 'textSecondary'} /> : null}
      <Stack gap="xxs" style={{ flex: 1 }}>
        <BidiText variant="callout" color={selected ? 'onPrimarySubtle' : 'text'}>
          {title}
        </BidiText>
        {subtitle ? (
          <Text variant="caption" color={selected ? 'onPrimarySubtle' : 'textSecondary'}>
            {subtitle}
          </Text>
        ) : null}
      </Stack>
      {selected ? <Icon name="check-circle" color="primary" /> : null}
    </Pressable>
  );
}

function ToggleRow({
  label,
  help,
  value,
  onChange,
  testID,
  disabled,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Row gap="md" style={{ minHeight: 56 }}>
      <Stack gap="xxs" style={{ flex: 1 }}>
        <Text variant="callout">{label}</Text>
        {help ? (
          <Text variant="caption" color="textSecondary">
            {help}
          </Text>
        ) : null}
      </Stack>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.primary, false: colors.borderStrong }}
        thumbColor={colors.surface}
      />
    </Row>
  );
}

function StepperButton({ icon, label, onPress, disabled, testID }: { icon: 'plus' | 'minus'; label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: colors.borderStrong,
        backgroundColor: disabled ? colors.disabledBg : pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      <Icon name={icon} color={disabled ? 'disabledText' : 'text'} />
    </Pressable>
  );
}

function TimeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { locale } = useT();
  const options = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const h = 6 + Math.floor(i / 2);
        const m = i % 2 ? 30 : 0;
        const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const d = new Date();
        d.setHours(h, m, 0, 0);
        return { value: v, label: formatTime(d.toISOString(), locale) };
      }),
    [locale],
  );
  const all = options.some((o) => o.value === value) ? options : [{ value, label: value }, ...options];
  return <SelectField testID="game.create.time" label={label} placeholder={label} value={value} options={all} onChange={onChange} />;
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }): ReactNode {
  const { t } = useT();
  return (
    <Card outlined>
      <Row gap="md">
        <Stack gap="xxs" style={{ flex: 1 }}>
          <Text variant="caption" color="textSecondary">
            {label}
          </Text>
          <BidiText variant="callout">{value}</BidiText>
        </Stack>
        <Button variant="ghost" size="sm" label={t('games:wizard.review.edit')} accessibilityLabel={t('games:wizard.review.editA11y', { section: label })} onPress={onEdit} />
      </Row>
    </Card>
  );
}
