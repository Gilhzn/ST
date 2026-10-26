/** Sports with self-assessed level and positions (design §13.12 "Positions"). */
import type { PositionId, Stars, UserSport } from '@st/domain';
import { Card, Row, Stack, Text } from '@st/ui';

import { SportIcon } from '@/components/Icon';
import { Tag } from '@/components/Tag';
import { useT } from '@/i18n';

export function SportsSection({ sports }: { sports: readonly UserSport[] }) {
  const { t } = useT();
  return (
    <Stack gap="sm" testID="profile.sports">
      <Text variant="title3">{t('profile:sportsTitle')}</Text>
      {sports.length === 0 ? (
        <Text variant="body" color="textSecondary" testID="profile.sports.empty">
          {t('profile:positions.none')}
        </Text>
      ) : (
        sports.map((s) => {
          const [primary, ...secondary] = s.positions as readonly PositionId[];
          return (
            <Card key={s.sport} outlined elevation={0}>
              <Stack gap="sm" testID={`profile.sport.${s.sport}`}>
                <Row gap="sm">
                  <SportIcon sport={s.sport} />
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {t(`common:sports.${s.sport}`)}
                  </Text>
                  <Text variant="callout" color="textSecondary">
                    {t(`auth:profileSetup.skill.${s.selfSkill as Stars}`)}
                  </Text>
                </Row>
                {primary ? (
                  <Row gap="xs" wrap>
                    <Text variant="caption" color="textSecondary">
                      {t('profile:positions.primary')}
                    </Text>
                    <Tag label={t(`common:positions.${primary}`)} tone="info" />
                  </Row>
                ) : null}
                {secondary.length > 0 ? (
                  <Row gap="xs" wrap>
                    <Text variant="caption" color="textSecondary">
                      {t('profile:positions.secondary')}
                    </Text>
                    {secondary.map((p) => (
                      <Tag key={p} label={t(`common:positions.${p}`)} />
                    ))}
                  </Row>
                ) : null}
              </Stack>
            </Card>
          );
        })
      )}
    </Stack>
  );
}
