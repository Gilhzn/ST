/**
 * Waitlist offer (PRD GAME-045): a spot opened and is offered to this player until
 * `offerExpiresAt`. In a flash fill (< 1 h before start) everyone on the list gets
 * it and the first to accept wins. Countdown is informational (live region).
 */
import type { Participant } from '@st/domain';
import { Button, isolate, Row, Stack, Text } from '@st/ui';

import { Card } from '@/components/CardView';
import { Icon } from '@/components/Icon';
import { InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useAction } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatDuration, formatTime } from '@/lib/format';

export function hasActiveOffer(p: Participant | null | undefined, now: number): boolean {
  return !!p && p.status === 'waitlisted' && !!p.offerExpiresAt && Date.parse(p.offerExpiresAt) > now;
}

export function WaitlistOffer({ gameId, participant, onAccepted }: { gameId: string; participant: Participant; onAccepted: () => void }) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const now = useNow(15_000);
  const accept = useAction(async () => port.acceptWaitlistOffer(gameId));
  if (!hasActiveOffer(participant, now) || !participant.offerExpiresAt) return null;
  const minutes = Math.max(1, Math.ceil((Date.parse(participant.offerExpiresAt) - now) / 60_000));
  const flash = participant.offerMode === 'flash';

  return (
    <Card accentEdge testID="game.waitlist.offer">
      <Stack gap="sm" accessibilityLiveRegion="polite">
        <Row gap="sm">
          <Icon name="timer-sand" color="primary" />
          <Text variant="title3" style={{ flex: 1 }}>
            {t('games:details.offer.title')}
          </Text>
        </Row>
        <Text variant="callout" color="textSecondary">
          {flash ? t('games:details.offer.flash') : t('games:details.offer.body')}
        </Text>
        <Text variant="bodyStrong" testID="game.waitlist.offer.countdown">
          {t('games:details.offer.acceptWithin', {
            duration: formatDuration(minutes, locale),
            time: isolate(formatTime(participant.offerExpiresAt, locale), 'ltr'),
          })}
        </Text>
        <InlineError error={accept.error} />
        <Button
          testID="game.waitlist.accept"
          variant="accent"
          size="lg"
          fullWidth
          label={t('games:details.offer.accept')}
          loading={accept.busy}
          onPress={async () => {
            const res = await accept.run();
            if (res) {
              toast(t('games:details.offer.accepted'));
              onAccepted();
            }
          }}
        />
      </Stack>
    </Card>
  );
}
