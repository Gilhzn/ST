/** Invite landing (design §13.18): preview + Join, or Sign up to join when signed out. */
import { Button, EmptyState, Stack, Text } from '@st/ui';
import { router, useLocalSearchParams } from 'expo-router';

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
  const now = useNow();
  const ready = status === 'ready';
  const game = useAsync(() => port.resolveInvite(inviteToken), [port, inviteToken], ready);
  const join = useAction(async () => {
    const g = game.data;
    if (!g) return null;
    if (!g.myParticipation || g.myParticipation.status === 'cancelled') await port.requestJoin(g.id, { inviteToken });
    return g.id;
  });

  if (!ready) {
    return (
      <Screen testID="screen.invite" title={t('games:invite.title')} back={false}>
        <Stack gap="lg">
          <Text variant="body" color="textSecondary">
            {t('games:invite.signedOutBody')}
          </Text>
          <Button
            testID="invite.signup"
            size="lg"
            fullWidth
            label={t('games:invite.signUpToJoin')}
            onPress={() => {
              setPostAuthRedirect(`/invite/${inviteToken}`);
              router.replace(status === 'needsProfile' ? '/age-gate' : '/phone');
            }}
          />
        </Stack>
      </Screen>
    );
  }

  return (
    <Screen testID="screen.invite" title={t('games:invite.title')} backFallback="/map">
      {game.loading && !game.data ? (
        <Skeleton rows={1} height={180} />
      ) : game.error ? (
        <ErrorView error={game.error} onRetry={() => void game.reload()} />
      ) : !game.data ? (
        <EmptyState tone="empty" title={t('games:invite.expired')} actionLabel={t('common:nav.map')} onAction={() => router.replace('/map')} />
      ) : (
        <Stack gap="lg">
          <GameCard game={game.data} host={game.data.host} now={now} testID={`invite.card.${game.data.id}`} />
          <InlineError error={join.error} />
          <Button
            testID="invite.accept"
            size="lg"
            fullWidth
            label={t('games:invite.join')}
            loading={join.busy}
            onPress={async () => {
              const id = await join.run();
              if (id) router.replace(`/game/${id}`);
            }}
          />
        </Stack>
      )}
    </Screen>
  );
}
