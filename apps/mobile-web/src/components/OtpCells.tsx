/**
 * One-time-code input (design v2 §15.1): six 52×56 boxed cells (radius 14, sunken; the active
 * cell gets the brand focus border + halo, filled cells a raised surface) drawn under ONE real
 * text input. A single input keeps SMS autofill (`one-time-code`), paste of the whole code and
 * screen-reader behaviour native, and "auto-advance" is just the caret moving to the next cell.
 * The input text is transparent; the cells mirror its value. Digits stay LTR in every locale.
 */
import { borderWidth, radius, spacing, Text, useTheme } from '@st/ui';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Animated, Platform, Pressable, TextInput, View } from 'react-native';

export function OtpCells({
  value,
  onChange,
  length = 6,
  label,
  error,
  testID,
  autoFocus,
}: {
  value: string;
  onChange: (digits: string) => void;
  length?: number;
  /** Spoken label of the input ("Verification code, 6 digits"). */
  label: string;
  error?: boolean;
  testID?: string;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!error || theme.reducedMotion) return;
    shake.setValue(0);
    Animated.sequence(
      [8, -8, 5, -5, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 50, useNativeDriver: false })),
    ).start();
  }, [error, shake, theme.reducedMotion]);

  const active = Math.min(value.length, length - 1);
  const family = theme.fontFamily('semibold');

  return (
    <Pressable onPress={() => input.current?.focus()} accessible={false} style={{ alignSelf: 'stretch' }}>
      {/* Logical `start` offset (not translateX) so the shake is direction-agnostic and lint-clean. */}
      <Animated.View style={{ flexDirection: 'row', direction: 'ltr', justifyContent: 'center', gap: spacing.sm, start: shake }}>
        {Array.from({ length }, (_, i) => {
          const ch = value[i] ?? '';
          const isActive = focused && i === active && value.length < length + 1;
          return (
            <View
              key={i}
              aria-hidden
              style={{
                flex: 1,
                maxWidth: 52,
                height: 60,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: ch ? c.surface : c.surfaceSunken,
                borderWidth: borderWidth.thick,
                borderColor: error ? c.danger : isActive ? c.focusRing : ch ? c.border : theme.scheme === 'dark' ? c.border : 'transparent',
                ...(isActive && !error
                  ? { boxShadow: `0px 0px 0px 4px ${theme.scheme === 'dark' ? 'rgba(143, 125, 255, 0.22)' : 'rgba(91, 61, 245, 0.14)'}` }
                  : ch
                    ? theme.elevation(1)
                    : null),
              }}
            >
              {ch ? (
                <Text variant="numeric" style={{ fontSize: 26, lineHeight: 32 }}>
                  {ch}
                </Text>
              ) : isActive ? (
                <View style={{ width: 2, height: 24, borderRadius: 1, backgroundColor: c.primary }} />
              ) : null}
            </View>
          );
        })}
      </Animated.View>
      <TextInput
        ref={input}
        testID={testID}
        aria-label={label}
        aria-invalid={Boolean(error)}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'web' ? 'one-time-code' : 'sms-otp'}
        maxLength={length}
        autoFocus={autoFocus}
        caretHidden
        selectionColor="transparent"
        {...(Platform.OS === 'web' ? ({ dir: 'ltr' } as object) : null)}
        style={
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            start: 0,
            end: 0,
            color: 'transparent',
            backgroundColor: 'transparent',
            fontSize: 16,
            ...(family ? { fontFamily: family } : null),
            ...(Platform.OS === 'web' ? { outlineStyle: 'none', caretColor: 'transparent', letterSpacing: 40 } : null),
          } as object
        }
      />
    </Pressable>
  );
}
