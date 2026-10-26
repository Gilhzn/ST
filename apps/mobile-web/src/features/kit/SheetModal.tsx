/**
 * Modal bottom sheet for edit flows (design v2 §14 Sheet: radius 28 top, grabber, elevation 3).
 * Phones: slides up to ~94% height over a scrim; wide screens: a centred 560 dp dialog.
 * Header: Cancel at the start, title centred; content scrolls; an optional sticky footer
 * holds the one primary action. Escape / back closes (onRequestClose).
 */
import { radius, spacing, Text, useTheme } from '@st/ui';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function SheetModal({
  visible,
  title,
  onClose,
  closeLabel,
  start,
  footer,
  children,
  testID,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  closeLabel: string;
  /** Leading header control (defaults to nothing; pass the Cancel button). */
  start?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width >= 768;
  return (
    <Modal visible={visible} transparent animationType={theme.reducedMotion ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center' }}>
        <Pressable role="button" aria-label={closeLabel} onPress={onClose} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth: wide ? 560 : undefined, alignItems: 'stretch' }}>
          <View
            testID={testID}
            role="dialog"
            aria-modal
            aria-label={title}
            style={{
              height: wide ? Math.min(760, height * 0.86) : height - insets.top - spacing.md,
              backgroundColor: theme.colors.background,
              borderTopStartRadius: radius.xl,
              borderTopEndRadius: radius.xl,
              borderBottomStartRadius: wide ? radius.xl : 0,
              borderBottomEndRadius: wide ? radius.xl : 0,
              overflow: 'hidden',
              ...theme.elevation(4),
            }}
          >
            <View style={{ alignItems: 'center', paddingTop: spacing.sm }}>
              <View aria-hidden style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: theme.colors.textTertiary, opacity: 0.4 }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingStart: spacing.sm, paddingEnd: spacing.sm }}>
              <View style={{ flex: 1, alignItems: 'flex-start' }}>{start}</View>
              <Text variant="headline" role="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
                {title}
              </Text>
              <View style={{ flex: 1 }} />
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {footer ? (
              <View style={{ padding: spacing.lg, paddingBottom: spacing.lg + (wide ? 0 : insets.bottom), borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }}>{footer}</View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
