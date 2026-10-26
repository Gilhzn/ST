/**
 * Privacy and safety (design v2 §15.15): what location is used for and how to change the OS
 * permission, blocked players, and how to ask for a copy of your data.
 */
import { Button, Icon, ListGroup, ListItem, radius, Row, spacing, Stack, Text, useTheme } from '@st/ui';
import { router } from 'expo-router';
import { Linking, Platform, View } from 'react-native';

import { useT } from '@/i18n';

import { BlockedList } from './BlockedList';

export function PrivacySettings() {
  const { t } = useT();
  const theme = useTheme();
  return (
    <Stack gap="xl" testID="settings.privacy">
      <View testID="settings.privacy.location" style={{ padding: spacing.lg, gap: spacing.md, borderRadius: radius.lg, ...theme.elevation(1) }}>
        <Row gap="md">
          <View aria-hidden style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.successSubtle }}>
            <Icon name="GpsFix" size={24} weight="duotone" color="successText" />
          </View>
          <Text variant="title3" style={{ flex: 1 }}>
            {t('settings:privacy.location.title')}
          </Text>
        </Row>
        <Text variant="callout">{t('auth:permissions.location.disclosure')}</Text>
        <Row gap="xs" align="start">
          <Icon name="Info" size={16} color="textTertiary" />
          <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
            {t('settings:privacy.location.preciseHelp')}
          </Text>
        </Row>
        {Platform.OS !== 'web' ? (
          <Button testID="settings.privacy.openSettings" variant="secondary" icon="GearSix" label={t('common:actions.openSettings')} onPress={() => void Linking.openSettings()} />
        ) : null}
      </View>
      <BlockedList />
      <View testID="settings.privacy.data">
        <ListGroup title={t('settings:privacy.data.title')} footer={t('settings:privacy.data.help')}>
          <ListItem
            testID="settings.privacy.dataRequest"
            icon="DownloadSimple"
            iconTone="info"
            title={t('settings:privacy.data.download')}
            subtitle={t('settings:privacy.data.contact')}
            onPress={() => router.push('/legal/contact')}
          />
          <ListItem testID="settings.privacy.policy" icon="FileText" iconTone="neutral" title={t('legal:privacy.title')} onPress={() => router.push('/legal/privacy')} />
        </ListGroup>
      </View>
    </Stack>
  );
}
