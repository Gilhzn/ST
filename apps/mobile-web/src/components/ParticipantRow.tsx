import type { ParticipantView } from '@st/domain';
import { Avatar, BidiText, Row, Stack, Text } from '@st/ui';
import type { ReactNode } from 'react';

import { useT } from '@/i18n';

import { ReliabilityDot } from './ReliabilityBadge';

/** Participant list row: avatar, name (bidi-safe), reliability dot, position, trailing actions. */
export function ParticipantRow({ p, trailing, isHost }: { p: ParticipantView; trailing?: ReactNode; isHost?: boolean }) {
  const { t } = useT();
  return (
    <Row gap="md" style={{ minHeight: 56 }} testID={`game.participants.${p.userId}`}>
      <Avatar name={p.profile.displayName} uri={p.profile.avatarUrl} size="md" decorative />
      <Stack gap="xxs" style={{ flex: 1 }}>
        <Row gap="xs">
          <BidiText variant="callout" numberOfLines={1} style={{ flexShrink: 1 }}>
            {p.profile.displayName}
          </BidiText>
          <ReliabilityDot status={p.profile.reliabilityStatus} score={p.profile.reliabilityScore} />
        </Row>
        <Row gap="sm">
          {isHost ? (
            <Text variant="caption" color="primaryText">
              {t('games:details.host.badge')}
            </Text>
          ) : null}
          {p.position ? (
            <Text variant="caption" color="textSecondary">
              {t(`common:positions.${p.position}`)}
            </Text>
          ) : null}
          {p.attendance === 'verified' ? (
            <Text variant="caption" color="successText">
              {t('games:details.checkedIn')}
            </Text>
          ) : null}
        </Row>
      </Stack>
      {trailing}
    </Row>
  );
}
