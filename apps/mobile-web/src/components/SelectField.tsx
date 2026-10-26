/** Native select: a field that opens a modal list (radio semantics). */
import { borderWidth, radius, sizing, spacing, Text, useTheme } from '@st/ui';
import { useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import type { SelectFieldProps } from './SelectField.types';

export type { SelectFieldProps, SelectOption } from './SelectField.types';

export function SelectField({ label, placeholder, value, options, onChange, error, helperText, testID }: SelectFieldProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="label">{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={selected ? `${label}: ${selected.label}` : label}
        onPress={() => setOpen(true)}
        style={{
          minHeight: sizing.touchTarget,
          flexDirection: 'row',
          alignItems: 'center',
          paddingStart: spacing.md,
          paddingEnd: spacing.md,
          borderRadius: radius.md,
          borderWidth: error ? borderWidth.thick : borderWidth.regular,
          borderColor: error ? c.danger : c.borderStrong,
          backgroundColor: c.surface,
        }}
      >
        <Text variant="body" color={selected ? 'text' : 'textTertiary'} style={{ flex: 1 }}>
          {selected?.label ?? placeholder}
        </Text>
        <Icon name="chevron-down" size={20} />
      </Pressable>
      {error ? (
        <Text variant="caption" color="dangerText" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : helperText ? (
        <Text variant="caption" color="textTertiary">
          {helperText}
        </Text>
      ) : null}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg }}>
            <Text variant="title3" style={{ flex: 1 }}>
              {label}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={placeholder} onPress={() => setOpen(false)} hitSlop={12}>
              <Icon name="close" color="text" />
            </Pressable>
          </View>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            renderItem={({ item }) => (
              <Pressable
                testID={testID ? `${testID}.option.${item.value}` : undefined}
                accessibilityRole="radio"
                accessibilityState={{ checked: item.value === value }}
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                style={{ minHeight: 56, justifyContent: 'center', paddingStart: spacing.lg, paddingEnd: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border }}
              >
                <Text variant="body">{item.value === value ? `✓ ${item.label}` : item.label}</Text>
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
