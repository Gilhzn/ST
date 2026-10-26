/** List row for settings hubs: icon, title, optional value, chevron. 56 dp tall, one focus stop. */
import { radius, spacing, Stack, Text, useTheme } from '@st/ui';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';

export function SettingsRow({
  icon,
  title,
  value,
  onPress,
  testID,
  danger,
  external,
  accessibilityHint,
}: {
  icon?: IconName;
  title: string;
  value?: string;
  onPress?: () => void;
  testID?: string;
  danger?: boolean;
  external?: boolean;
  accessibilityHint?: string;
}) {
  const { colors } = useTheme();
  const content = (
    <>
      {icon ? <Icon name={icon} color={danger ? 'dangerText' : 'textSecondary'} /> : null}
      <Stack gap="xxs" style={{ flex: 1 }}>
        <Text variant="body" color={danger ? 'dangerText' : 'text'}>
          {title}
        </Text>
        {value ? (
          <Text variant="caption" color="textSecondary">
            {value}
          </Text>
        ) : null}
      </Stack>
      {onPress ? <Icon name={external ? 'open-in-new' : 'chevron-right'} directional={!external} /> : null}
    </>
  );
  const base = {
    minHeight: 56,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingStart: spacing.md,
    paddingEnd: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderRadius: radius.md,
  };
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={value ? `${title}: ${value}` : title} style={base}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={value ? `${title}: ${value}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => ({ ...base, backgroundColor: pressed ? colors.surfaceSunken : 'transparent' })}
    >
      {content}
    </Pressable>
  );
}
