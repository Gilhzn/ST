/**
 * Calm inline notice (design v2 §15 shared rules): tinted card, icon well, optional
 * title and actions. Used for check-in windows, chat expiry, moderation and result
 * windows. Never full-screen red; always pairs the tone with an icon and text.
 */
import { Icon, radius, spacing, Text, useTheme, type IconName } from '@st/ui';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export type NoticeTone = 'info' | 'warning' | 'success' | 'danger' | 'neutral' | 'brand';

export function useToneColors(tone: NoticeTone) {
  const { colors: c } = useTheme();
  const map: Record<NoticeTone, { bg: string; fg: string; well: string }> = {
    info: { bg: c.infoSubtle, fg: c.infoText, well: c.surface },
    warning: { bg: c.warningSubtle, fg: c.warningText, well: c.surface },
    success: { bg: c.successSubtle, fg: c.successText, well: c.surface },
    danger: { bg: c.dangerSubtle, fg: c.dangerText, well: c.surface },
    neutral: { bg: c.surfaceSunken, fg: c.textSecondary, well: c.surface },
    brand: { bg: c.primarySubtle, fg: c.onPrimarySubtle, well: c.surface },
  };
  return map[tone];
}

export function Notice({
  tone = 'info',
  icon,
  title,
  text,
  children,
  testID,
  titleTestID,
  live = 'polite',
  style,
}: {
  tone?: NoticeTone;
  icon: IconName;
  title?: string;
  text?: string;
  children?: ReactNode;
  testID?: string;
  titleTestID?: string;
  live?: 'polite' | 'assertive' | 'off';
  style?: StyleProp<ViewStyle>;
}) {
  const t = useToneColors(tone);
  return (
    <View
      testID={testID}
      aria-live={live === 'off' ? undefined : live}
      style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: t.bg }, style]}
    >
      <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: t.well, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} weight="fill" color={t.fg} />
      </View>
      <View style={{ flex: 1, gap: spacing.xs, paddingTop: title ? 0 : spacing.xs }}>
        {title ? (
          <Text variant="headline" style={{ color: t.fg }} testID={titleTestID}>
            {title}
          </Text>
        ) : null}
        {text ? (
          <Text variant="callout" color={title ? 'text' : undefined} style={title ? undefined : { color: t.fg }}>
            {text}
          </Text>
        ) : null}
        {children}
      </View>
    </View>
  );
}
