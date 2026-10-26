/**
 * 1–5 star scale for one attribute (RATE-001): five 44dp stars in a `radiogroup` with a word
 * under the selection ("Solid", "Great"). Tap the chosen star again to clear (attributes are
 * optional). Stars fill from the reading-start edge; the scale is a slider for assistive tech
 * via increment/decrement actions.
 */
import type { Stars } from '@st/domain';
import { Haptics, Icon, spacing, Text, useTheme } from '@st/ui';
import { Pressable, View } from 'react-native';

import { focusVisible } from './focusVisible';

export function StarInput({
  label,
  value,
  onChange,
  starLabel,
  valueWord,
  testID,
}: {
  label: string;
  value: Stars | null;
  onChange: (next: Stars | null) => void;
  /** Spoken name of one star ("3 of 5"). */
  starLabel: (n: Stars) => string;
  /** Word for a value ("Solid"); `null` = not rated. */
  valueWord: (n: Stars | null) => string;
  testID?: string;
}) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="callout" weight="medium" style={{ flex: 1 }} numberOfLines={1}>
          {label}
        </Text>
        <Text variant="footnote" color={value ? 'primaryText' : 'textTertiary'} weight={value ? 'semibold' : 'regular'} testID={testID ? `${testID}.word` : undefined}>
          {valueWord(value)}
        </Text>
      </View>
      <View
        role="radiogroup"
        aria-label={label}
        testID={testID}
        accessibilityActions={[
          { name: 'increment', label: starLabel(Math.min(5, (value ?? 0) + 1) as Stars) },
          { name: 'decrement', label: starLabel(Math.max(1, (value ?? 2) - 1) as Stars) },
        ]}
        onAccessibilityAction={(e) => {
          const next = e.nativeEvent.actionName === 'increment' ? Math.min(5, (value ?? 0) + 1) : Math.max(1, (value ?? 2) - 1);
          onChange(next as Stars);
        }}
        style={{ flexDirection: 'row', gap: spacing.xs }}
      >
        {([1, 2, 3, 4, 5] as Stars[]).map((n) => {
          const on = value !== null && n <= value;
          return (
            <Pressable
              key={n}
              testID={testID ? `${testID}.${n}` : undefined}
              role="radio"
              aria-checked={value === n}
              aria-label={starLabel(n)}
              hitSlop={2}
              onPress={() => {
                Haptics.selection();
                onChange(value === n ? null : n);
              }}
              style={(st) => {
                const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
                return {
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? c.warningSubtle : pressed ? c.border : c.surfaceSunken,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                  ...(focusVisible(focused) ? ({ outlineColor: c.focusRing, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 1 } as object) : null),
                };
              }}
            >
              <Icon name="Star" size={26} weight={on ? 'fill' : 'regular'} color={on ? 'warning' : 'textTertiary'} directional={false} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
