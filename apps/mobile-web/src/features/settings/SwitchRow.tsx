/** Toggle row: the whole row is the 48 dp+ target (role=switch); the Switch is a visual only. */
import { radius, spacing, Stack, Text, useTheme } from '@st/ui';
import { Pressable, Switch } from 'react-native';

export function SwitchRow({
  label,
  help,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={help}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      aria-checked={value}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingStart: spacing.md,
        paddingEnd: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <Stack gap="xxs" style={{ flex: 1 }}>
        <Text variant="body" color={disabled ? 'textSecondary' : 'text'}>
          {label}
        </Text>
        {help ? (
          <Text variant="caption" color="textSecondary">
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
        trackColor={{ true: colors.primary, false: colors.borderStrong }}
        thumbColor="#FFFFFF"
        onValueChange={onChange}
      />
    </Pressable>
  );
}
