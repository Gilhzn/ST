/**
 * Privacy and safety (design §13.14): what location is used for, how to change
 * the OS permission, blocked players and how to ask for a copy of your data.
 */
import { Button, Card, Divider, Row, Stack, Text } from '@st/ui';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

import { Icon } from '@/components/Icon';
import { useT } from '@/i18n';

import { BlockedList } from './BlockedList';
import { SettingsRow } from './SettingsRow';

export function PrivacySettings() {
  const { t } = useT();
  return (
    <Stack gap="lg" testID="settings.privacy">
      <Card outlined elevation={0}>
        <Stack gap="sm" testID="settings.privacy.location">
          <Row gap="sm">
            <Icon name="crosshairs-gps" color="primary" />
            <Text variant="title3" style={{ flex: 1 }}>
              {t('settings:privacy.location.title')}
            </Text>
          </Row>
          <Text variant="body" color="textSecondary">
            {t('auth:permissions.location.disclosure')}
          </Text>
          <Text variant="callout" color="textSecondary">
            {t('settings:privacy.location.preciseHelp')}
          </Text>
          {Platform.OS !== 'web' ? (
            <Button testID="settings.privacy.openSettings" variant="secondary" label={t('common:actions.openSettings')} onPress={() => void Linking.openSettings()} />
          ) : null}
        </Stack>
      </Card>
      <Divider />
      <BlockedList />
      <Divider />
      <Stack gap="xs" testID="settings.privacy.data">
        <Text variant="title3">{t('settings:privacy.data.title')}</Text>
        <SettingsRow
          testID="settings.privacy.dataRequest"
          icon="download-outline"
          title={t('settings:privacy.data.download')}
          value={t('settings:privacy.data.contact')}
          onPress={() => router.push('/legal/contact')}
        />
        <SettingsRow testID="settings.privacy.policy" icon="file-document-outline" title={t('legal:privacy.title')} onPress={() => router.push('/legal/privacy')} />
      </Stack>
    </Stack>
  );
}
