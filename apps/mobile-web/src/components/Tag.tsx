import { radius, spacing, Text, useTheme } from '@st/ui';
import { View } from 'react-native';

import { Icon, type IconName } from './Icon';

/** Small labelled badge (Deposit, Women only, Private, Waitlist). Icon + text, never color alone. */
export function Tag({ icon, label, tone = 'neutral', testID }: { icon?: IconName; label: string; tone?: 'neutral' | 'warning' | 'info'; testID?: string }) {
  const { colors } = useTheme();
  const bg = tone === 'warning' ? colors.warningSubtle : tone === 'info' ? colors.infoSubtle : colors.surfaceSunken;
  const fg = tone === 'warning' ? 'warningText' : tone === 'info' ? 'infoText' : 'textSecondary';
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
        paddingStart: spacing.sm,
        paddingEnd: spacing.sm,
        minHeight: 24,
        borderRadius: radius.pill,
        backgroundColor: bg,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <Text variant="caption" color={fg} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
