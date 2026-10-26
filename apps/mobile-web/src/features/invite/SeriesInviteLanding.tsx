/**
 * Series invite landing (PRD §5.4 step 4): "Join the regulars". Signed out, the CTA goes through
 * sign-up and comes back with `?join=1`, which adds the player to the roster right away. Signed
 * in: the series card, what regulars get, and one primary action. Regulars and the host are
 * sent to the series screen instead.
 */
import type { GameSeriesDetail } from '@st/domain';
import { AuthHero, Button, EmptyState, Haptics, Icon, isolate, radius, spacing, Text, useTheme, type IconName } from '@st/ui';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen } from '@/components/Screen';
import { ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { setPostAuthRedirect, useSession } from '@/state/session';

import { dayLabel, timeIn } from '@/features/series/format';
import { SeriesCard } from '@/features/series/SeriesParts';

export function SeriesInviteLanding({ token, autoJoin, initial }: { token: string; autoJoin?: boolean; initial?: GameSeriesDetail | null }) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { status } = useSession();
  const ready = status === 'ready';
  const series = useAsync(async () => initial ?? (await port.resolveSeriesInvite(token)), [port, token], ready);
  const join = useAction(() => port.joinSeriesViaInvite(token));
  const d = series.data;
  const member = !!d && (d.isHost || d.myRoster?.status === 'regular');
  const tried = useRef(false);

  const onJoin = async () => {
    if (!d) return;
    const res = await join.run();
    if (res) {
      Haptics.success();
      toast(t('invite:landing.joined', { title: d.series.title }), 'success');
      router.replace(`/series/${d.series.id}`);
    }
  };

  useEffect(() => {
    if (autoJoin && d && !member && !tried.current) {
      tried.current = true;
      void onJoin();
    }
    // onJoin closes over the latest detail; run once when it loads.
  }, [autoJoin, d, member]);

  const hero = (
    <AuthHero
      title={t('invite:landing.title')}
      subtitle={d ? t('invite:landing.from', { name: isolate(d.host.displayName), title: isolate(d.series.title) }) : t('invite:landing.signedOutBody')}
      sports={d ? [d.series.sport] : undefined}
      topInset={insets.top}
      height={d ? 340 : 380}
    />
  );

  if (!ready) {
    return (
      <Screen
        testID="screen.invite.series"
        back={false}
        hero={hero}
        contentStyle={{ paddingTop: spacing.xl, gap: spacing.lg }}
        footer={
          <Button
            testID="invite.series.signup"
            size="lg"
            fullWidth
            iconEnd="ArrowRight"
            label={t('invite:landing.signUp')}
            onPress={() => {
              setPostAuthRedirect(`/invite/series/${token}?join=1`);
              router.replace(status === 'needsProfile' ? '/age-gate' : '/phone');
            }}
          />
        }
      >
        <Perks />
      </Screen>
    );
  }

  const next = d?.upcoming.find((o) => o.status === 'scheduled');
  return (
    <Screen
      testID="screen.invite.series"
      backFallback="/map"
      hero={hero}
      contentStyle={{ gap: spacing.xl, marginTop: d ? -spacing.xxl : spacing.lg }}
      footer={
        d ? (
          <>
            <InlineError error={join.error} />
            {member ? (
              <Button testID="invite.series.open" size="lg" fullWidth iconEnd="ArrowRight" label={t('invite:landing.open')} onPress={() => router.replace(`/series/${d.series.id}`)} />
            ) : (
              <Button testID="invite.series.join" size="lg" fullWidth icon="UsersThree" haptic="joinGame" label={t('invite:landing.join')} loading={join.busy} onPress={() => void onJoin()} />
            )}
          </>
        ) : undefined
      }
    >
      {series.loading && !d ? (
        <Skeleton kind="game" rows={1} />
      ) : series.error ? (
        <ErrorView error={series.error} onRetry={() => void series.reload()} />
      ) : !d ? (
        <EmptyState tone="empty" illustration="error" title={t('games:invite.expired')} actionLabel={t('common:nav.map')} actionIcon="MapTrifold" onAction={() => router.replace('/map')} />
      ) : (
        <>
          <SeriesCard
            testID="invite.series.card"
            series={d.series}
            regulars={d.rosterCount}
            nextLabel={next ? t('series:card.next', { date: `${dayLabel(next.startsAt, locale, d.series.timeZone)} · ${timeIn(next.startsAt, locale, d.series.timeZone)}` }) : null}
            status={member ? { label: d.isHost ? t('games:my.state.hosting') : t('series:card.regular'), tone: 'success', icon: d.isHost ? 'Strategy' : 'CheckCircle' } : null}
            onPress={() => router.push(`/series/${d.series.id}`)}
          />
          <View style={{ borderRadius: radius.lg, padding: spacing.lg, backgroundColor: theme.colors.surface, ...theme.elevation(1) }}>
            <Perks hours={d.series.rosterPriorityHours} />
          </View>
        </>
      )}
    </Screen>
  );
}

function Perks({ hours = 24 }: { hours?: number }) {
  const { t } = useT();
  const theme = useTheme();
  const items: [IconName, string][] = [
    ['Hourglass', t('invite:landing.perkFirstPick', { hours })],
    ['Lightning', t('invite:landing.perkAlwaysIn')],
    ['ChatsCircle', t('invite:landing.perkNoPolls')],
  ];
  return (
    <View style={{ gap: spacing.md }} testID="invite.series.perks">
      {items.map(([icon, text]) => (
        <View key={icon} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View aria-hidden style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primarySubtle }}>
            <Icon name={icon} size={20} weight="duotone" color="onPrimarySubtle" />
          </View>
          <Text variant="callout" style={{ flex: 1 }}>
            {text}
          </Text>
        </View>
      ))}
    </View>
  );
}
