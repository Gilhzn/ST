/**
 * Standard screen frame: safe area, header with a mirrored back button, a
 * scrolling body capped at the reading width, and an optional sticky footer
 * (primary actions, design §13.6).
 */
import { Row, sizing, spacing, Text, useTheme } from '@st/ui';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useT } from '@/i18n';

import { Icon } from './Icon';

export function goBack(fallback: Href = '/map') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

export function BackButton({ fallback, testID = 'nav.back' }: { fallback?: Href; testID?: string }) {
  const { t } = useT();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('common:a11y.back')}
      onPress={() => goBack(fallback)}
      hitSlop={4}
      style={({ pressed }) => ({
        width: sizing.touchTarget,
        height: sizing.touchTarget,
        borderRadius: sizing.touchTarget / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <Icon name="arrow-left" color="text" directional />
    </Pressable>
  );
}

export interface ScreenProps {
  title?: string;
  /** Show the back button (default true). */
  back?: boolean;
  backFallback?: Href;
  headerEnd?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  testID?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** Max content width (design: reading width 720). */
  maxWidth?: number;
  edges?: ('top' | 'bottom')[];
}

export function Screen({
  title,
  back = true,
  backFallback,
  headerEnd,
  children,
  footer,
  scroll = true,
  testID,
  contentStyle,
  maxWidth = sizing.maxContentWidth,
  edges = ['top', 'bottom'],
}: ScreenProps) {
  const { colors } = useTheme();
  const { bp } = useBreakpoint();
  const gutter = bp === 'compact' ? spacing.lg : spacing.xl;
  const body = (
    <View style={[{ width: '100%', maxWidth, alignSelf: 'center', paddingStart: gutter, paddingEnd: gutter, gap: spacing.lg }, contentStyle]}>
      {children}
    </View>
  );
  return (
    <SafeAreaView testID={testID} edges={footer ? ['top'] : edges} style={{ flex: 1, backgroundColor: colors.background }}>
      {title || back || headerEnd ? (
        <Row
          gap="sm"
          style={{ minHeight: 56, paddingStart: spacing.sm, paddingEnd: spacing.md, width: '100%', maxWidth: maxWidth + 2 * gutter, alignSelf: 'center' }}
        >
          {back ? <BackButton fallback={backFallback} /> : <View style={{ width: spacing.sm }} />}
          <View style={{ flex: 1 }}>
            {title ? (
              <Text variant="title2" numberOfLines={2}>
                {title}
              </Text>
            ) : null}
          </View>
          {headerEnd}
        </Row>
      ) : null}
      {scroll ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.sm }} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
      {footer ? <StickyFooter>{footer}</StickyFooter> : null}
    </SafeAreaView>
  );
}

export function StickyFooter({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={['bottom']} style={{ ...theme.elevation(2), backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
      <View style={{ width: '100%', maxWidth: sizing.maxContentWidth, alignSelf: 'center', padding: spacing.lg, gap: spacing.sm }}>{children}</View>
    </SafeAreaView>
  );
}
