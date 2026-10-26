/**
 * Language picker (design §13.14): endonyms in their own script, current marked
 * (radio), "Use device language" on top. Web switches instantly; native asks to
 * restart when the reading direction changes (design §13.17).
 */
import type { Locale } from '@st/domain';
import { LANGUAGES, nativeNameOf, tFor } from '@st/i18n';
import { BidiText, radius, Row, spacing, Stack, Text, useTheme } from '@st/ui';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { useData } from '@/data/DataProvider';
import { useLanguage, useT } from '@/i18n';
import { useSession } from '@/state/session';

export function LanguagePicker({ showTitle = true }: { showTitle?: boolean } = {}) {
  const { t } = useT();
  const { colors } = useTheme();
  const lang = useLanguage();
  const port = useData();
  const { status } = useSession();
  const [pendingRestart, setPendingRestart] = useState<Locale | null>(null);

  const choose = async (next: Locale | null) => {
    const result = await lang.setLanguage(next);
    // Server-originated text (push, statements of reasons) uses the profile locale.
    if (status === 'ready') void port.updateProfile({ locale: result.locale }).catch(() => undefined);
    if (result.needsRestart) setPendingRestart(result.locale);
  };

  const row = (key: string, label: string, selected: boolean, onPress: () => void, secondary?: string) => (
    <Pressable
      key={key}
      testID={`settings.language.${key}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        paddingStart: spacing.md,
        paddingEnd: spacing.md,
        borderRadius: radius.md,
        justifyContent: 'center',
        backgroundColor: selected ? colors.primarySubtle : pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <Row gap="md">
        <Stack gap="xxs" style={{ flex: 1 }}>
          <BidiText variant="callout">{label}</BidiText>
          {secondary ? (
            <Text variant="caption" color="textSecondary">
              {secondary}
            </Text>
          ) : null}
        </Stack>
        {selected ? <Icon name="check" color="primary" /> : null}
      </Row>
    </Pressable>
  );

  const displayName = (l: Locale) => {
    try {
      return new Intl.DisplayNames([lang.locale], { type: 'language' }).of(l) ?? l;
    } catch {
      return l;
    }
  };

  return (
    <Stack gap="xs" testID="settings.language" accessibilityRole="radiogroup">
      {showTitle ? <Text variant="title3">{t('settings:language.title')}</Text> : null}
      {row('device', t('settings:language.useDevice'), lang.followsDevice, () => void choose(null), t('settings:language.deviceNow', { language: nativeNameOf(lang.deviceLocale) }))}
      {LANGUAGES.map((l) => row(l.locale, l.nativeName, !lang.followsDevice && lang.locale === l.locale, () => void choose(l.locale), displayName(l.locale)))}
      <ConfirmDialog
        testID="settings.language.restart"
        visible={!!pendingRestart}
        // Shown in the target language (design §13.14), body in the current one.
        title={pendingRestart ? tFor(pendingRestart)('settings:language.restart.title', { language: nativeNameOf(pendingRestart) }) : ''}
        body={t('settings:language.restart.body')}
        confirmLabel={t('settings:language.restart.restartNow')}
        cancelLabel={t('settings:language.restart.later')}
        onConfirm={() => void lang.restart()}
        onCancel={() => setPendingRestart(null)}
      />
    </Stack>
  );
}
