/** Sanctions currently in force (design v2 §15.13): warning-tone rows linking to the statement of reasons (§15.14). */
import type { Sanction } from '@st/domain';
import { ListGroup, ListItem } from '@st/ui';
import { router } from 'expo-router';
import { View } from 'react-native';

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
    <View testID="profile.sanctions">
      <ListGroup title={t('trust:sanctions.title')}>
        {sanctions.map((s) => {
          const name = t(`trust:sanctions.kind.${s.kind}.name`);
          const status = t(`trust:sanctions.status.${s.status}`);
          const until = s.expiresAt ? t('trust:sanctions.until', { date: formatDate(s.expiresAt, locale, { day: 'numeric', month: 'short' }) }) : t('trust:sanctions.noEndDate');
          return (
            <ListItem
              key={s.id}
              testID={`profile.sanction.${s.id}`}
              icon="ShieldWarning"
              iconTone={s.kind === 'yellow_card' ? 'warning' : 'danger'}
              title={name}
              subtitle={`${status}\n${until}`}
              aria-label={`${name}. ${status}. ${until}`}
              accessibilityHint={t('profile:sanctions.openHint')}
              onPress={() => router.push(`/sanctions/${s.id}`)}
            />
          );
        })}
      </ListGroup>
    </View>
  );
}
