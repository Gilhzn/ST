/**
 * Stepped slider (design v2: tonal −/+ around a 6dp track with a raised thumb). Drag or tap the
 * track, use the −/+ buttons (44dp targets, selection haptic) or the keyboard (arrows, Home/End).
 * The fill grows from the reading-start edge (mirrors in RTL). One `slider` with value text.
 */
import { Haptics, IconButton, radius, spacing, useTheme } from '@st/ui';
import { useRef, useState, type ComponentRef } from 'react';
import { PanResponder, Platform, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { focusVisible } from './focusVisible';

export function RangeSlider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  valueText,
  decLabel,
  incLabel,
  testID,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  label: string;
  valueText: (v: number) => string;
  decLabel: string;
  incLabel: string;
  testID?: string;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  const track = useRef<ComponentRef<typeof View>>(null);
  const origin = useRef(0);
  const last = useRef(value);
  last.current = value;
  const THUMB = 28;
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min));
  const set = (v: number) => {
    const next = clamp(v);
    if (next !== last.current) {
      Haptics.selection();
      last.current = next;
      onChange(next);
    }
  };
  const fraction = (value - min) / (max - min || 1);
  const fromX = (pageX: number) => {
    if (width <= THUMB) return value;
    let f = (pageX - origin.current - THUMB / 2) / (width - THUMB);
    if (theme.isRTL) f = 1 - f;
    return min + Math.max(0, Math.min(1, f)) * (max - min);
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const pageX = e.nativeEvent.pageX;
        track.current?.measure((_x: number, _y: number, _w: number, _h: number, px: number) => {
          origin.current = px;
          set(fromXRef.current(pageX));
        });
      },
      onPanResponderMove: (_, g) => set(fromXRef.current(g.moveX)),
    }),
  ).current;
  const fromXRef = useRef(fromX);
  fromXRef.current = fromX;

  const onKey = (e: { nativeEvent: { key: string }; preventDefault?: () => void }) => {
    const k = e.nativeEvent.key;
    const forward = theme.isRTL ? 'ArrowLeft' : 'ArrowRight';
    const back = theme.isRTL ? 'ArrowRight' : 'ArrowLeft';
    if (k === forward || k === 'ArrowUp') set(value + step);
    else if (k === back || k === 'ArrowDown') set(value - step);
    else if (k === 'Home') set(min);
    else if (k === 'End') set(max);
    else return;
    e.preventDefault?.();
  };

  const usable = Math.max(0, width - THUMB);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <IconButton testID={testID ? `${testID}.dec` : undefined} icon="Minus" weight="bold" variant="tonal" label={decLabel} disabled={value <= min} haptic="none" onPress={() => set(value - step)} />
      <View
        ref={track}
        testID={testID}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText(value)}
        focusable
        accessibilityActions={[
          { name: 'increment', label: incLabel },
          { name: 'decrement', label: decLabel },
        ]}
        onAccessibilityAction={(e) => set(value + (e.nativeEvent.actionName === 'increment' ? step : -step))}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...(Platform.OS === 'web' ? ({ onKeyDown: onKey, tabIndex: 0 } as object) : null)}
        {...responder.panHandlers}
        style={{
          flex: 1,
          height: 44,
          justifyContent: 'center',
          borderRadius: radius.md,
          ...(focusVisible(focused) ? ({ outlineColor: c.focusRing, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 2 } as object) : null),
          ...(Platform.OS === 'web' ? ({ cursor: 'pointer', touchAction: 'none', userSelect: 'none' } as object) : null),
        }}
      >
        <View aria-hidden pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', height: 6, marginStart: THUMB / 2, marginEnd: THUMB / 2 }}>
          <View style={{ width: usable * fraction, height: 6, borderTopStartRadius: 3, borderBottomStartRadius: 3, backgroundColor: c.primary }} />
          <View style={{ flex: 1, height: 6, borderTopEndRadius: 3, borderBottomEndRadius: 3, backgroundColor: c.surfaceSunken }} />
        </View>
        <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: usable * fraction }} />
          <View
            style={{
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              backgroundColor: theme.scheme === 'dark' ? c.surfaceRaised : c.surface,
              borderWidth: 2,
              borderColor: c.primary,
              ...theme.elevation(2),
            }}
          />
        </View>
      </View>
      <IconButton testID={testID ? `${testID}.inc` : undefined} icon="Plus" weight="bold" variant="tonal" label={incLabel} disabled={value >= max} haptic="none" onPress={() => set(value + step)} />
    </View>
  );
}
