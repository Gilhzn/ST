/**
 * Waitlist offer (PRD GAME-045, design v2 §15.4 banner): a spot opened and is offered to this
 * player until `offerExpiresAt`. In a flash fill (< 1 h before start) everyone on the list gets
 * it and the first to accept wins. A floodlight card (brand-night gradient, volt accent button);
 * the countdown is informational (live region).
 */
import type { Participant } from '@st/domain';
import { Button, Gradient, Icon, isolate, radius, spacing, StatusPill, Text } from '@st/ui';
import { View } from 'react-native';

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
    <View testID="game.waitlist.offer" style={{ borderRadius: radius.lg, overflow: 'hidden' }}>
      <Gradient name="brandNight" style={{ padding: spacing.lg, gap: spacing.md }}>
        <View aria-live="polite" style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View aria-hidden style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#CCFF33' }}>
              <Icon name={flash ? 'Lightning' : 'Hourglass'} size={24} weight="fill" color="#121129" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title3" color="textOnMedia">
                {t('games:details.offer.title')}
              </Text>
              {flash ? <StatusPill tone="live" label={t('games:details.offer.flashTag')} /> : null}
            </View>
          </View>
          <Text variant="callout" color="textOnMedia" style={{ opacity: 0.86 }}>
            {flash ? t('games:details.offer.flash') : t('games:details.offer.body')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Icon name="ClockCountdown" size={18} weight="bold" color="#CCFF33" />
            <Text variant="label" weight="semibold" color="textOnMedia" testID="game.waitlist.offer.countdown" style={{ flex: 1 }}>
              {t('games:details.offer.acceptWithin', {
                duration: formatDuration(minutes, locale),
                time: isolate(formatTime(participant.offerExpiresAt, locale), 'ltr'),
              })}
            </Text>
          </View>
          <InlineError error={accept.error} />
          <Button
            testID="game.waitlist.accept"
            variant="accent"
            size="lg"
            fullWidth
            icon="Lightning"
            haptic="joinGame"
            label={t('games:details.offer.accept')}
            loading={accept.busy}
            onPress={async () => {
              const res = await accept.run();
              if (res) {
                toast(t('games:details.offer.accepted'), 'success');
                onAccepted();
              }
            }}
          />
        </View>
      </Gradient>
    </View>
  );
}
