/**
 * Invite landing (design v2 §15, share-ready): the night-stadium AuthHero ("You're invited",
 * "<host> invited you to play"), the game's hero card overlapping it, and one primary action —
 * Join, or Sign up to join when signed out. Expired links get a calm empty state.
 */
import { AuthHero, Button, EmptyState, isolate, spacing, Text } from '@st/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameCard } from '@/components/GameCard';
import { Screen } from '@/components/Screen';
import { ErrorView, InlineError, Skeleton } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { setPostAuthRedirect, useSession } from '@/state/session';

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const inviteToken = String(token);
  const { t } = useT();
  const port = useData();
  const { status } = useSession();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const ready = status === 'ready';
  const game = useAsync(() => port.resolveInvite(inviteToken), [port, inviteToken], ready);
  const join = useAction(async () => {
    const g = game.data;
    if (!g) return null;
    if (!g.myParticipation || g.myParticipation.status === 'cancelled') await port.requestJoin(g.id, { inviteToken });
    return g.id;
  });

  const g = game.data;
  const hero = (
    <AuthHero
      title={t('games:invite.title')}
      subtitle={g ? t('games:invite.from', { name: isolate(g.host.displayName) }) : t('games:invite.signedOutBody')}
      sports={g ? [g.sport] : undefined}
      topInset={insets.top}
      height={g ? 340 : 380}
    />
  );

  if (!ready) {
    return (
      <Screen
        testID="screen.invite"
        back={false}
        hero={hero}
        contentStyle={{ paddingTop: spacing.xl, gap: spacing.lg }}
        footer={
          <Button
            testID="invite.signup"
            size="lg"
            fullWidth
            iconEnd="ArrowRight"
            label={t('games:invite.signUpToJoin')}
            onPress={() => {
              setPostAuthRedirect(`/invite/${inviteToken}`);
              router.replace(status === 'needsProfile' ? '/age-gate' : '/phone');
            }}
          />
        }
      >
        <Text variant="callout" color="textSecondary" align="center">
          {t('auth:welcome.subtitle')}
        </Text>
      </Screen>
    );
  }

  const canJoin = !!g && !game.error;
  return (
    <Screen
      testID="screen.invite"
      backFallback="/map"
      hero={hero}
      contentStyle={{ gap: spacing.lg, marginTop: g ? -spacing.xxl : spacing.lg }}
      footer={
        canJoin ? (
          <>
            <InlineError error={join.error} />
            <Button
              testID="invite.accept"
              size="lg"
              fullWidth
              icon="Lightning"
              haptic="joinGame"
              label={t('games:invite.join')}
              loading={join.busy}
              onPress={async () => {
                const id = await join.run();
                if (id) router.replace(`/game/${id}`);
              }}
            />
          </>
        ) : undefined
      }
    >
      {game.loading && !g ? (
        <Skeleton kind="game" rows={1} />
      ) : game.error ? (
        <ErrorView error={game.error} onRetry={() => void game.reload()} />
      ) : !g ? (
        <EmptyState tone="empty" illustration="error" title={t('games:invite.expired')} actionLabel={t('common:nav.map')} actionIcon="MapTrifold" onAction={() => router.replace('/map')} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          <GameCard game={g} host={g.host} now={now} testID={`invite.card.${g.id}`} />
          <Text variant="footnote" color="textTertiary" align="center">
            {t('games:invite.hint')}
          </Text>
        </View>
      )}
    </Screen>
  );
}
