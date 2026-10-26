/**
 * Language picker (design §13.14): endonyms in their own script, current marked
 * (radio), "Use device language" on top. Web switches instantly; native asks to
 * restart when the reading direction changes (design §13.17).
 */
import { LOCALES, type Locale } from '@st/domain';
import { BidiText, localeNativeNames, radius, Row, spacing, Stack, Text, useTheme } from '@st/ui';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { useLanguage, useT } from '@/i18n';

export function LanguagePicker() {
  const { t } = useT();
  const { colors } = useTheme();
  const lang = useLanguage();
  const [pendingRestart, setPendingRestart] = useState<Locale | null>(null);

  const choose = async (next: Locale | null) => {
    const result = await lang.setLanguage(next);
    if (result.needsRestart) setPendingRestart(result.locale);
  };

  const row = (key: string, label: string, selected: boolean, onPress: () => void, secondary?: string) => (
    <Pressable
      key={key}
      testID={`settings.language.${key}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
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
      <Text variant="title3">{t('settings:language.title')}</Text>
      {row('device', t('settings:language.useDevice'), lang.followsDevice, () => void choose(null), t('settings:language.deviceNow', { language: localeNativeNames[lang.deviceLocale] }))}
      {LOCALES.map((l) => row(l, localeNativeNames[l], !lang.followsDevice && lang.locale === l, () => void choose(l), displayName(l)))}
      <ConfirmDialog
        testID="settings.language.restart"
        visible={!!pendingRestart}
        title={t('settings:language.restart.title', { language: pendingRestart ? localeNativeNames[pendingRestart] : '' })}
        body={t('settings:language.restart.body')}
        confirmLabel={t('settings:language.restart.restartNow')}
        cancelLabel={t('settings:language.restart.later')}
        onConfirm={() => void lang.restart()}
        onCancel={() => setPendingRestart(null)}
      />
    </Stack>
  );
}
