/**
 * One-shot celebration burst (design v2 §7: success celebration ≤ 800 ms, once).
 * Decorative and hidden from assistive tech; renders nothing with reduced motion.
 * The burst is radially symmetric, so it needs no RTL handling.
 */
import { palette, sportColors, useTheme } from '@st/ui';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

const COUNT = 22;

export function Confetti({ size = 280, play = true }: { size?: number; play?: boolean }) {
  const theme = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const colors = useMemo(
    () => [theme.colors.primary, palette.volt400, sportColors.football.color, sportColors.basketball.color, sportColors.volleyball.color, sportColors.running.color],
    [theme.colors.primary],
  );
  const pieces = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        const angle = (i / COUNT) * Math.PI * 2 + (i % 3) * 0.17;
        const dist = size * (0.32 + ((i * 37) % 11) / 40);
        return {
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist,
          rot: `${((i * 53) % 360) - 180}deg`,
          w: i % 2 ? 8 : 6,
          h: i % 2 ? 4 : 10,
          round: i % 4 === 0,
          color: colors[i % colors.length] ?? '#5B3DF5',
        };
      }),
    [size, colors],
  );

  useEffect(() => {
    if (!play || theme.reducedMotion) return;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 800, easing: Easing.bezier(0, 0, 0.2, 1), useNativeDriver: false }).start();
  }, [play, theme.reducedMotion, progress]);

  if (!play || theme.reducedMotion) return null;
  return (
    <View pointerEvents="none" aria-hidden style={{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: p.w,
            height: p.h,
            borderRadius: p.round ? 5 : 1.5,
            backgroundColor: p.color,
            opacity: progress.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy + size * 0.12] }) },
              { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', p.rot] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}
