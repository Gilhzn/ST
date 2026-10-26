/** Native select (design v2 §14 TextField look): a filled field that opens a sheet-style list (radio semantics). */
import { Icon, radius, spacing, Text, useTheme } from '@st/ui';
import { useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import type { SelectFieldProps } from './SelectField.types';
import { SelectShell } from './SelectShell';

export type { SelectFieldProps, SelectOption } from './SelectField.types';

export function SelectField(props: SelectFieldProps) {
  const { label, value, options, onChange, testID } = props;
  const theme = useTheme();
  const c = theme.colors;
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <SelectShell {...props} focused={open}>
      <Pressable
        testID={testID}
        role="button"
        aria-label={selected ? `${label}: ${selected.label}` : label}
        aria-expanded={open}
        onPress={() => setOpen(true)}
        style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}
      />
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingStart: spacing.lg, paddingEnd: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.md }}>
            <Text variant="title3" role="heading" style={{ flex: 1 }}>
              {label}
            </Text>
            <Pressable role="button" aria-label={t('common:a11y.close')} onPress={() => setOpen(false)} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: c.surfaceSunken }}>
              <Icon name="X" size={20} weight="bold" color="text" />
            </Pressable>
          </View>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            contentContainerStyle={{ paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingBottom: spacing.xxl }}
            renderItem={({ item, index }) => {
              const sel = item.value === value;
              return (
                <Pressable
                  testID={testID ? `${testID}.option.${item.value}` : undefined}
                  role="radio"
                  aria-checked={sel}
                  aria-label={item.label}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => ({
                    minHeight: 56,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    paddingStart: spacing.lg,
                    paddingEnd: spacing.lg,
                    backgroundColor: pressed ? c.surfaceSunken : c.surface,
                    borderTopStartRadius: index === 0 ? radius.lg : 0,
                    borderTopEndRadius: index === 0 ? radius.lg : 0,
                    borderBottomStartRadius: index === options.length - 1 ? radius.lg : 0,
                    borderBottomEndRadius: index === options.length - 1 ? radius.lg : 0,
                    borderBottomWidth: index === options.length - 1 ? 0 : 1,
                    borderBottomColor: c.border,
                  })}
                >
                  <Text variant="body" weight={sel ? 'semibold' : 'regular'} style={{ flex: 1 }}>
                    {item.label}
                  </Text>
                  {sel ? <Icon name="Check" size={20} weight="bold" color="primary" /> : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </SelectShell>
  );
}
