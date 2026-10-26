/**
 * Settings hub (design v2 §15.15): iOS-style grouped rows with tinted icon wells —
 * account, preferences (language, theme, notifications), privacy and safety, legal,
 * sign out, and the delete-account danger zone (two-step flow on its own screen).
 */
import { nativeNameOf } from '@st/i18n';
import { Haptics, isolate, ListGroup, ListItem, Text } from '@st/ui';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SettingsFrame } from '@/features/settings/SettingsFrame';
import { ThemeSection } from '@/features/settings/ThemeSection';
import { useLanguage, useT } from '@/i18n';
import { useSession } from '@/state/session';
import { formatPhone } from '@/lib/countries';

export default function SettingsScreen() {
  const { t } = useT();
  const lang = useLanguage();
  const session = useSession();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <SettingsFrame title={t('settings:title')} testID="screen.settings" backFallback="/profile">
      <ListGroup title={t('settings:section.account')} testID="settings.section.account">
        <ListItem
          testID="settings.account.phone"
          icon="Phone"
          iconTone="brand"
          title={t('settings:account.phone')}
          value={session.user?.phone ? isolate(formatPhone(session.user.phone), 'ltr') : undefined}
          aria-label={session.user?.phone ? `${t('settings:account.phone')}: ${formatPhone(session.user.phone)}` : t('settings:account.phone')}
        />
      </ListGroup>

      <ListGroup title={t('settings:section.preferences')}>
        <ListItem
          testID="settings.language.open"
          icon="Translate"
          iconTone="info"
          title={t('settings:language.title')}
          value={lang.followsDevice ? t('settings:language.useDevice') : nativeNameOf(lang.locale)}
          onPress={() => router.push('/settings/language')}
        />
        <ThemeSection />
        <ListItem testID="settings.notifications.open" icon="Bell" iconTone="warning" title={t('settings:notifications.title')} onPress={() => router.push('/settings/notifications')} />
      </ListGroup>

      <ListGroup title={t('settings:section.privacy')}>
        <ListItem testID="settings.privacy.open" icon="ShieldCheck" iconTone="success" title={t('settings:privacy.title')} onPress={() => router.push('/settings/privacy')} />
        <ListItem testID="settings.blocked.open" icon="UserMinus" iconTone="neutral" title={t('settings:privacy.blocked.title')} onPress={() => router.push('/settings/privacy')} />
      </ListGroup>

      <ListGroup title={t('settings:section.legal')} testID="settings.section.legal">
        <ListItem testID="settings.legal.privacy" icon="FileText" iconTone="neutral" title={t('legal:privacy.title')} onPress={() => router.push('/legal/privacy')} />
        <ListItem testID="settings.legal.terms" icon="FileText" iconTone="neutral" title={t('legal:terms.title')} onPress={() => router.push('/legal/terms')} />
        <ListItem testID="settings.legal.contact" icon="EnvelopeSimple" iconTone="neutral" title={t('legal:contact.title')} onPress={() => router.push('/legal/contact')} />
      </ListGroup>

      <ListGroup>
        <ListItem testID="settings.signOut" icon="SignOut" destructive chevron={false} title={t('settings:account.signOut')} onPress={() => setConfirmSignOut(true)} />
      </ListGroup>

      <ListGroup title={t('settings:delete.dangerZone')} testID="settings.section.danger">
        <ListItem
          testID="settings.delete.open"
          icon="Trash"
          destructive
          title={t('settings:delete.title')}
          onPress={() => {
            Haptics.warning();
            router.push('/settings/delete-account');
          }}
        />
      </ListGroup>

      <View style={{ alignItems: 'center' }}>
        <Text variant="caption" color="textTertiary" align="center" testID="settings.version">
          {t('settings:about.version', { version: isolate(version, 'ltr') })}
        </Text>
      </View>
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
    </SettingsFrame>
  );
}
