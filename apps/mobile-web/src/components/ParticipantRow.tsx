import type { ParticipantView } from '@st/domain';
import { BidiText, spacing, StatusPill, Text } from '@st/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useT } from '@/i18n';

import { ReliabilityAvatar, ReliabilityDot } from './ReliabilityBadge';

/**
 * Participant row (design v2 §15.4): avatar inside a reliability arc, name (bidi-safe) + status
 * dot, then host / position / checked-in pills; trailing slot for host actions. Sits inside a
 * `ListGroup` card (its own start/end padding).
 */
export function ParticipantRow({ p, trailing, isHost, inset = true }: { p: ParticipantView; trailing?: ReactNode; isHost?: boolean; inset?: boolean }) {
  const { t } = useT();
  const checkedIn = p.attendance === 'verified';
  return (
    <View
      testID={`game.participants.${p.userId}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 64,
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
        paddingStart: inset ? spacing.lg : 0,
        paddingEnd: inset ? spacing.md : 0,
      }}
    >
      <ReliabilityAvatar name={p.profile.displayName} uri={p.profile.avatarUrl} status={p.profile.reliabilityStatus} score={p.profile.reliabilityScore} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 }}>
          <BidiText variant="body" weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
            {p.profile.displayName}
          </BidiText>
          <ReliabilityDot status={p.profile.reliabilityStatus} score={p.profile.reliabilityScore} />
        </View>
        {isHost || p.position || checkedIn ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs }}>
            {isHost ? <StatusPill tone="brand" icon="Strategy" label={t('games:details.host.badge')} /> : null}
            {checkedIn ? <StatusPill tone="success" icon="CheckCircle" label={t('games:details.checkedIn')} /> : null}
            {p.position ? (
              <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                {t(`common:positions.${p.position}`)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}
