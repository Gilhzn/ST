import { Mirror, useTheme } from '@st/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

/** Circular progress (mirrors in RTL, design §13.7) with centred content. Decorative; pair with live text. */
export function ProgressRing({ progress, size = 160, stroke = 10, tone = 'primary', children }: { progress: number; size?: number; stroke?: number; tone?: 'primary' | 'success' | 'warning'; children?: ReactNode }) {
  const { colors } = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : colors.primary;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Mirror style={{ position: 'absolute' }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceSunken} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - Math.max(0, Math.min(1, progress)))}
          />
        </Svg>
      </Mirror>
      {children}
    </View>
  );
}
