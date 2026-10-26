/**
 * Language picker (design v2 §15.15): "Use device language" on top, then every locale by its
 * native name (in its own script) with the name in the current language underneath; radio
 * semantics, the selected row ends in a brand check. Web switches instantly; native asks to
 * restart when the reading direction changes.
 */
import type { Locale } from '@st/domain';
import { LANGUAGES, nativeNameOf, tFor } from '@st/i18n';
import { Haptics, Icon, ListGroup, ListItem } from '@st/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useData } from '@/data/DataProvider';
import { useLanguage, useT } from '@/i18n';
import { useSession } from '@/state/session';

export function LanguagePicker() {
  const { t } = useT();
  const lang = useLanguage();
  const port = useData();
  const { status } = useSession();
  const [pendingRestart, setPendingRestart] = useState<Locale | null>(null);

  const choose = async (next: Locale | null) => {
    Haptics.selection();
    const result = await lang.setLanguage(next);
    // Server-originated text (push, statements of reasons) uses the profile locale.
    if (status === 'ready') void port.updateProfile({ locale: result.locale }).catch(() => undefined);
    if (result.needsRestart) setPendingRestart(result.locale);
  };

  const displayName = (l: Locale) => {
    try {
      return new Intl.DisplayNames([lang.locale], { type: 'language' }).of(l) ?? l;
    } catch {
      return l;
    }
  };

  const check = <Icon name="Check" size={20} weight="bold" color="primary" />;

  return (
    <View testID="settings.language" role="radiogroup" aria-label={t('settings:language.title')} style={{ gap: 24 }}>
      <ListGroup>
        <ListItem
          testID="settings.language.device"
          role="radio"
          aria-checked={lang.followsDevice}
          icon="GlobeHemisphereWest"
          iconTone="info"
          title={t('settings:language.useDevice')}
          subtitle={t('settings:language.deviceNow', { language: nativeNameOf(lang.deviceLocale) })}
          chevron={false}
          trailing={lang.followsDevice ? check : undefined}
          onPress={() => void choose(null)}
        />
      </ListGroup>
      <ListGroup title={t('settings:language.allLanguages')}>
        {LANGUAGES.map((l) => {
          const selected = !lang.followsDevice && lang.locale === l.locale;
          return (
            <ListItem
              key={l.locale}
              testID={`settings.language.${l.locale}`}
              role="radio"
              aria-checked={selected}
              aria-label={`${l.nativeName}, ${displayName(l.locale)}`}
              title={l.nativeName}
              subtitle={displayName(l.locale)}
              chevron={false}
              trailing={selected ? check : undefined}
              onPress={() => void choose(l.locale)}
            />
          );
        })}
      </ListGroup>
      <ConfirmDialog
        testID="settings.language.restart"
        visible={!!pendingRestart}
        // Shown in the target language, body in the current one.
        title={pendingRestart ? tFor(pendingRestart)('settings:language.restart.title', { language: nativeNameOf(pendingRestart) }) : ''}
        body={t('settings:language.restart.body')}
        confirmLabel={t('settings:language.restart.restartNow')}
        cancelLabel={t('settings:language.restart.later')}
        onConfirm={() => void lang.restart()}
        onCancel={() => setPendingRestart(null)}
      />
    </View>
  );
}
