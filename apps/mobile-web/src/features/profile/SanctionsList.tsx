/** Sanctions currently in force, each linking to the statement of reasons (design §13.12, §13.13). */
import type { Sanction } from '@st/domain';
import { Card, Row, Stack, Text } from '@st/ui';
import { router } from 'expo-router';

import { Icon } from '@/components/Icon';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';

export function sanctionsInForce(sanctions: readonly Sanction[], now: number): Sanction[] {
  return sanctions.filter(
    (s) => (s.status === 'active' || s.status === 'disputed' || s.status === 'upheld') && (s.expiresAt === null || Date.parse(s.expiresAt) > now),
  );
}

export function SanctionsList({ sanctions }: { sanctions: readonly Sanction[] }) {
  const { t, locale } = useT();
  if (sanctions.length === 0) return null;
  return (
    <Stack gap="sm" testID="profile.sanctions">
      <Text variant="title3">{t('trust:sanctions.title')}</Text>
      {sanctions.map((s) => {
        const name = t(`trust:sanctions.kind.${s.kind}.name`);
        const status = t(`trust:sanctions.status.${s.status}`);
        const until = s.expiresAt ? t('trust:sanctions.until', { date: formatDate(s.expiresAt, locale, { day: 'numeric', month: 'short' }) }) : t('trust:sanctions.noEndDate');
        return (
          <Card
            key={s.id}
            outlined
            elevation={0}
            accessibilityLabel={`${name}. ${status}. ${until}`}
            accessibilityHint={t('profile:sanctions.openHint')}
            testID={`profile.sanction.${s.id}`}
            onPress={() => router.push(`/sanctions/${s.id}`)}
          >
            <Row gap="md">
              <Icon name="alert-circle-outline" color="warningText" />
              <Stack gap="xxs" style={{ flex: 1 }}>
                <Text variant="bodyStrong">{name}</Text>
                <Text variant="callout" color="textSecondary">
                  {status}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {until}
                </Text>
              </Stack>
              <Icon name="chevron-right" directional />
            </Row>
          </Card>
        );
      })}
    </Stack>
  );
}
