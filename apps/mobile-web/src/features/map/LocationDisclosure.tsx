/**
 * Prominent disclosure shown before the OS location prompt (compliance §5,
 * Play User Data policy, Apple 5.1.2(i)). Never blocks: "Not now" keeps the map
 * working by city search.
 */
import { Button, Card, Row, Stack, Text } from '@st/ui';

import { Icon } from '@/components/Icon';
import { useT } from '@/i18n';

export function LocationDisclosure({ onAllow, onDismiss, busy }: { onAllow: () => void; onDismiss: () => void; busy?: boolean }) {
  const { t } = useT();
  return (
    <Card elevation={3} testID="map.location.disclosure" accessibilityRole="summary">
      <Stack gap="md">
        <Row gap="sm" align="center">
          <Icon name="crosshairs-gps" color="primary" />
          <Text variant="title3" style={{ flex: 1 }}>
            {t('auth:permissions.location.title')}
          </Text>
        </Row>
        <Text variant="body" color="textSecondary">
          {t('auth:permissions.location.disclosure')}
        </Text>
        <Row gap="sm" wrap>
          <Button testID="map.location.allow" label={t('auth:permissions.location.allow')} onPress={onAllow} loading={busy} />
          <Button testID="map.location.notNow" variant="ghost" label={t('auth:permissions.location.notNow')} onPress={onDismiss} />
        </Row>
      </Stack>
    </Card>
  );
}
