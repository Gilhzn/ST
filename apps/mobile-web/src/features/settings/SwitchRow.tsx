/**
 * Toggle row for grouped settings (design v2 §14 ListItem): tinted icon well, label, help,
 * and a visual switch. The whole row is the 56 dp+ target (role=switch, aria-checked).
 */
import { Icon, radius, spacing, Stack, Text, useTheme, type IconName, type ListItemLeadTone } from '@st/ui';
import { Pressable, Switch, View } from 'react-native';

export function SwitchRow({
  label,
  help,
  value,
  onChange,
  disabled,
  icon,
  tone = 'brand',
  testID,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  icon?: IconName;
  tone?: ListItemLeadTone;
  testID?: string;
}) {
  const { colors: c } = useTheme();
  const wells: Record<ListItemLeadTone, [string, string]> = {
    brand: [c.primarySubtle, c.onPrimarySubtle],
    neutral: [c.surfaceSunken, c.textSecondary],
    success: [c.successSubtle, c.successText],
    warning: [c.warningSubtle, c.warningText],
    danger: [c.dangerSubtle, c.dangerText],
    info: [c.infoSubtle, c.infoText],
  };
  const [bg, fg] = wells[tone];
  return (
    <Pressable
      testID={testID}
      role="switch"
      aria-label={label}
      aria-checked={value}
      aria-disabled={!!disabled}
      accessibilityHint={help}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingStart: spacing.lg,
        paddingEnd: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
        backgroundColor: pressed ? c.surfaceSunken : 'transparent',
      })}
    >
      {icon ? (
        <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} weight="duotone" color={fg} />
        </View>
      ) : null}
      <Stack gap="xxs" style={{ flex: 1 }}>
        <Text variant="body" color="text">
          {label}
        </Text>
        {help ? (
          <Text variant="footnote" color="textSecondary">
            {help}
          </Text>
        ) : null}
      </Stack>
      <Switch
        value={value}
        disabled={disabled}
        // Visual only: the row handles press and semantics.
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        trackColor={{ true: c.primary, false: c.borderStrong }}
        thumbColor="#FFFFFF"
        {...({ activeThumbColor: '#FFFFFF' } as object)}
        onValueChange={onChange}
      />
    </Pressable>
  );
}
