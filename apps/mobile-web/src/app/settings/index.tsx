/**
 * Settings hub (design §13.14): account, language, theme, notifications, privacy
 * and safety, legal, about, sign out and the delete-account danger zone.
 */
import { nativeNameOf } from '@st/i18n';
import { Button, Divider, isolate, Stack, Text } from '@st/ui';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Screen } from '@/components/Screen';
import { SettingsRow } from '@/features/settings/SettingsRow';
import { ThemeSection } from '@/features/settings/ThemeSection';
import { useLanguage, useT } from '@/i18n';
import { useSession } from '@/state/session';

export default function SettingsScreen() {
  const { t } = useT();
  const lang = useLanguage();
  const session = useSession();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen title={t('settings:title')} testID="screen.settings" backFallback="/profile">
      <Stack gap="lg">
        <Stack gap="xxs" testID="settings.section.account">
          <Text variant="title3">{t('settings:section.account')}</Text>
          <SettingsRow
            testID="settings.account.phone"
            icon="phone-outline"
            title={t('settings:account.phone')}
            value={session.user?.phone ? isolate(session.user.phone, 'ltr') : undefined}
          />
        </Stack>
        <Divider />
        <Stack gap="xxs">
          <SettingsRow
            testID="settings.language.open"
            icon="translate"
            title={t('settings:language.title')}
            value={lang.followsDevice ? t('settings:language.useDevice') : nativeNameOf(lang.locale)}
            onPress={() => router.push('/settings/language')}
          />
          <SettingsRow
            testID="settings.notifications.open"
            icon="bell-outline"
            title={t('settings:notifications.title')}
            onPress={() => router.push('/settings/notifications')}
          />
          <SettingsRow
            testID="settings.privacy.open"
            icon="shield-lock-outline"
            title={t('settings:privacy.title')}
            onPress={() => router.push('/settings/privacy')}
          />
        </Stack>
        <Divider />
        <ThemeSection />
        <Divider />
        <Stack gap="xxs" testID="settings.section.legal">
          <Text variant="title3">{t('settings:section.legal')}</Text>
          <SettingsRow testID="settings.legal.privacy" icon="file-document-outline" title={t('legal:privacy.title')} onPress={() => router.push('/legal/privacy')} />
          <SettingsRow testID="settings.legal.terms" icon="file-document-outline" title={t('legal:terms.title')} onPress={() => router.push('/legal/terms')} />
          <SettingsRow testID="settings.legal.contact" icon="email-outline" title={t('legal:contact.title')} onPress={() => router.push('/legal/contact')} />
        </Stack>
        <Divider />
        <Stack gap="sm">
          <Button testID="settings.signOut" variant="secondary" size="lg" fullWidth label={t('settings:account.signOut')} onPress={() => setConfirmSignOut(true)} />
        </Stack>
        <Stack gap="xxs" testID="settings.section.danger">
          <Text variant="title3" color="dangerText">
            {t('settings:delete.dangerZone')}
          </Text>
          <SettingsRow
            testID="settings.delete.open"
            icon="delete-outline"
            danger
            title={t('settings:delete.title')}
            onPress={() => router.push('/settings/delete-account')}
          />
        </Stack>
        <Text variant="caption" color="textSecondary" align="center" testID="settings.version">
          {t('settings:about.version', { version: isolate(version, 'ltr') })}
        </Text>
      </Stack>
      <ConfirmDialog
        testID="settings.signOut.dialog"
        visible={confirmSignOut}
        title={t('settings:account.signOut')}
        body={t('settings:account.signOutConfirm')}
        confirmLabel={t('settings:account.signOut')}
        cancelLabel={t('common:actions.cancel')}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          void session.signOut();
        }}
      />
    </Screen>
  );
}
