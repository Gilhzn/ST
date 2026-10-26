/**
 * Modal confirmation (design v2 §12/§14: elevation 4 dialog, radius 28, focus moves to the title,
 * Escape/back closes; destructive actions use the danger button + warning haptic). Centered,
 * max 440 dp, with a tone icon well. Actions stack full width (primary first) for easy reach.
 */
import { Button, Icon, radius, spacing, Text, useTheme, zIndex, type IconName } from '@st/ui';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

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
  icon,
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
  /** Icon in the tone well above the title (default: Warning when destructive, Info otherwise). */
  icon?: IconName;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const well = destructive ? { bg: c.dangerSubtle, fg: 'dangerText' as const } : { bg: c.primarySubtle, fg: 'onPrimarySubtle' as const };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, zIndex: zIndex.modal }}>
        <Pressable
          role="button"
          aria-label={cancelLabel}
          onPress={onCancel}
          style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: c.scrim }}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          aria-label={title}
          style={{
            width: '100%',
            maxWidth: 440,
            maxHeight: '90%',
            borderRadius: radius.xl,
            backgroundColor: c.surfaceRaised,
            ...theme.elevation(4),
          }}
        >
          <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} bounces={false}>
            <View style={{ gap: spacing.sm }}>
              <View aria-hidden style={{ width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: well.bg, marginBottom: spacing.xs }}>
                <Icon name={icon ?? (destructive ? 'Warning' : 'Info')} size={24} weight="fill" color={well.fg} />
              </View>
              <Text variant="title3" role="heading" aria-level={2}>
                {title}
              </Text>
              {body ? (
                <Text variant="callout" color="textSecondary">
                  {body}
                </Text>
              ) : null}
            </View>
            {children}
            <View style={{ gap: spacing.sm }}>
              <Button
                testID={testID ? `${testID}.confirm` : undefined}
                variant={destructive ? 'danger' : 'primary'}
                size="lg"
                fullWidth
                label={confirmLabel}
                onPress={onConfirm}
                loading={busy}
                haptic={destructive ? 'destructiveConfirm' : undefined}
              />
              <Button testID={testID ? `${testID}.cancel` : undefined} variant="ghost" size="lg" fullWidth label={cancelLabel} onPress={onCancel} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
