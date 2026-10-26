/**
 * Modal confirmation (design §11: focus moves to the title; Escape/back closes;
 * destructive actions use the danger button). Centered dialog, max 560 dp.
 */
import { Button, radius, spacing, Stack, Text, useTheme, zIndex } from '@st/ui';
import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive,
  busy,
  children,
  testID,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  busy?: boolean;
  children?: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, zIndex: zIndex.modal }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          onPress={onCancel}
          style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          style={{ width: '100%', maxWidth: 560, borderRadius: radius.lg, padding: spacing.xl, backgroundColor: theme.colors.surfaceRaised, ...theme.elevation(4) }}
        >
          <Stack gap="md">
            <Text variant="title3" accessibilityRole="header">
              {title}
            </Text>
            {body ? (
              <Text variant="body" color="textSecondary">
                {body}
              </Text>
            ) : null}
            {children}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-end' }}>
              <Button testID={testID ? `${testID}.cancel` : undefined} variant="ghost" label={cancelLabel} onPress={onCancel} />
              <Button
                testID={testID ? `${testID}.confirm` : undefined}
                variant={destructive ? 'danger' : 'primary'}
                label={confirmLabel}
                onPress={onConfirm}
                loading={busy}
              />
            </View>
          </Stack>
        </View>
      </View>
    </Modal>
  );
}
