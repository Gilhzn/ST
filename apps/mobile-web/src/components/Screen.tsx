/**
 * Standard screen frame (design v2 §14/§15): safe area, a compact header (mirrored back button,
 * title, end actions) or a `LargeHeader` pattern (`large`: eyebrow, 32/38 title, subtitle and
 * optional controls that scroll with the content), a scrolling body capped at the reading width,
 * and an optional sticky footer (blur material on iOS/web, solid on Android) for the one primary
 * action of the screen.
 */
import { Icon, IconButton, LargeHeader, sizing, spacing, Text, usePressScale, useTheme, type IconName } from '@st/ui';
import { BlurView } from 'expo-blur';
import { router, type Href } from 'expo-router';
import type { ReactElement, ReactNode } from 'react';
import { Animated, Platform, Pressable, ScrollView, View, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useT } from '@/i18n';
import { focusVisible } from './focusVisible';

export function goBack(fallback: Href = '/map') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** Back button: 44dp icon button (ArrowLeft mirrors in RTL), `hitSlop` to 48. */
export function BackButton({
  fallback,
  testID = 'nav.back',
  onMedia,
  onPress,
}: {
  fallback?: Href;
  testID?: string;
  /** White glyph on a translucent disc, for sport gradients / hero images. */
  onMedia?: boolean;
  onPress?: () => void;
}) {
  const { t } = useT();
  const press = onPress ?? (() => goBack(fallback));
  if (onMedia) return <MediaIconButton testID={testID} icon="ArrowLeft" label={t('common:a11y.back')} onPress={press} />;
  return <IconButton testID={testID} icon="ArrowLeft" label={t('common:a11y.back')} color="text" onPress={press} />;
}

/** 44dp icon button for media (sport gradients, hero art): white glyph on 20% white, hairline ring. */
export function MediaIconButton({
  icon,
  label,
  onPress,
  testID,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
  badge?: boolean;
}) {
  const { colors } = useTheme();
  const scale = usePressScale(0.92);
  return (
    <Animated.View style={scale.style}>
      <Pressable
        testID={testID}
        role="button"
        aria-label={label}
        hitSlop={2}
        onPress={onPress}
        onPressIn={scale.onPressIn}
        onPressOut={scale.onPressOut}
        style={(st) => {
          const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
          return {
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.18)',
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.28)',
            ...(focusVisible(focused) ? { outlineColor: '#FFFFFF', outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 2 } : null),
          } as ViewStyle;
        }}
      >
        <Icon name={icon} size={22} weight="bold" color="#FFFFFF" />
        {badge ? (
          <View aria-hidden style={{ position: 'absolute', top: 6, end: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent, borderWidth: 2, borderColor: 'rgba(0,0,0,0.2)' }} />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export interface ScreenProps {
  title?: string;
  /** Large-title header (tab roots and hub screens): `title` renders as `largeTitle`. */
  large?: boolean;
  /** Line above a large title. */
  eyebrow?: string;
  /** Line under a large title. */
  subtitle?: string;
  /** Controls under a large title (Segmented, search). */
  headerChildren?: ReactNode;
  /** Show the back button (default true). */
  back?: boolean;
  backFallback?: Href;
  /** Custom back action (e.g. a wizard going one step back). */
  onBack?: () => void;
  headerEnd?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  testID?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** Max content width (design: reading width 720). */
  maxWidth?: number;
  edges?: ('top' | 'bottom')[];
  /** Scrolls with the content and replaces the header (hero screens draw their own). */
  hero?: ReactNode;
  /** Sticky custom header under the safe area, replacing the compact header (wizards). */
  header?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
}

export function Screen({
  title,
  large,
  eyebrow,
  subtitle,
  headerChildren,
  back = true,
  backFallback,
  onBack,
  headerEnd,
  children,
  footer,
  scroll = true,
  testID,
  contentStyle,
  maxWidth = sizing.maxContentWidth,
  edges = ['top', 'bottom'],
  hero,
  header,
  refreshControl,
}: ScreenProps) {
  const { colors } = useTheme();
  const { t } = useT();
  const { bp } = useBreakpoint();
  const gutter = bp === 'compact' ? spacing.lg : spacing.xl;
  const frame: ViewStyle = { width: '100%', maxWidth, alignSelf: 'center' };
  const body = (
    <View style={[frame, { paddingStart: gutter, paddingEnd: gutter, gap: spacing.lg }, contentStyle]}>{children}</View>
  );

  const largeHeader = large ? (
    <View style={frame}>
      <LargeHeader
        title={title ?? ''}
        eyebrow={eyebrow}
        subtitle={subtitle}
        onBack={back ? (onBack ?? (() => goBack(backFallback))) : undefined}
        backLabel={t('common:a11y.back')}
        actions={headerEnd}
        style={{ paddingStart: gutter, paddingEnd: gutter, paddingTop: back || headerEnd ? 0 : spacing.xl }}
      >
        {headerChildren}
      </LargeHeader>
    </View>
  ) : null;

  const compactHeader =
    header ?? (!large && !hero && (title || back || headerEnd) ? (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          minHeight: sizing.headerCompact + 4,
          paddingStart: gutter - spacing.sm,
          paddingEnd: gutter - spacing.xs,
          width: '100%',
          maxWidth: maxWidth + 2 * gutter,
          alignSelf: 'center',
        }}
      >
        {back ? <BackButton fallback={backFallback} onPress={onBack} /> : <View style={{ width: spacing.sm }} />}
        <View style={{ flex: 1 }}>
          {title ? (
            <Text variant="title3" role="heading" aria-level={1} numberOfLines={2}>
              {title}
            </Text>
          ) : null}
        </View>
        {headerEnd ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>{headerEnd}</View> : null}
      </View>
    ) : null);

  return (
    <SafeAreaView testID={testID} edges={hero ? [] : footer ? ['top'] : edges} style={{ flex: 1, backgroundColor: colors.background }}>
      {compactHeader}
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: footer ? spacing.xl : spacing.xxxl, paddingTop: large || hero ? 0 : spacing.sm }}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {hero}
          {largeHeader}
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {hero}
          {largeHeader}
          <View style={{ flex: 1 }}>{body}</View>
        </View>
      )}
      {footer ? <StickyFooter>{footer}</StickyFooter> : null}
    </SafeAreaView>
  );
}

/** Sticky action bar: translucent blur on iOS/web, solid surface on Android; hairline top edge. */
export function StickyFooter({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const c = theme.colors;
  const blur = Platform.OS !== 'android';
  return (
    <SafeAreaView
      edges={['bottom']}
      style={{
        backgroundColor: blur ? c.surfaceGlass : c.surface,
        borderTopWidth: 1,
        borderTopColor: c.border,
        overflow: 'hidden',
        ...(theme.scheme === 'light' ? { boxShadow: '0px -8px 24px rgba(18, 17, 41, 0.06)' } : null),
      }}
    >
      {blur ? (
        <BlurView
          intensity={60}
          tint={theme.scheme === 'dark' ? 'dark' : 'light'}
          style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}
        />
      ) : null}
      <View
        style={{
          width: '100%',
          maxWidth: sizing.maxContentWidth,
          alignSelf: 'center',
          paddingStart: spacing.lg,
          paddingEnd: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: spacing.md,
          gap: spacing.sm,
        }}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}
