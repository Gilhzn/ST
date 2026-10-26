/**
 * Sparkline (react-native-svg): a smooth line over a soft area fill, the latest value as a
 * ringed dot. No axes; time runs from the reading-start edge, so the chart mirrors in RTL.
 * Decorative unless `label` is given (then one `img` with a spoken summary).
 */
import { useTheme } from '@st/ui';
import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/** Catmull-Rom → cubic Bézier path through the points (gentle, no overshoot beyond 1/6 handles). */
function smoothPath(points: readonly [number, number][]): string {
  if (points.length === 0) return '';
  const [x0, y0] = points[0] as [number, number];
  let d = `M${x0.toFixed(1)} ${y0.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i] as [number, number];
    const p2 = points[i + 1] as [number, number];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - (p0 as [number, number])[0]) / 6;
    const c1y = p1[1] + (p2[1] - (p0 as [number, number])[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function Sparkline({
  values,
  width,
  height = 44,
  color,
  label,
  testID,
  style,
}: {
  values: readonly number[];
  width: number;
  height?: number;
  color?: string;
  /** Spoken summary ("Level went from 3.0 to 3.4 over 9 weeks"). */
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const stroke = color ?? theme.colors.primary;
  const pad = 5;
  const data = values.length === 1 ? [values[0] as number, values[0] as number] : values;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points = data.map((v, i): [number, number] => [
    pad + (i * (width - 2 * pad)) / Math.max(1, data.length - 1),
    pad + (1 - (v - min) / span) * (height - 2 * pad),
  ]);
  const line = smoothPath(points);
  const last = points[points.length - 1] as [number, number];
  const first = points[0] as [number, number];
  const area = `${line} L${last[0].toFixed(1)} ${height} L${first[0].toFixed(1)} ${height} Z`;
  return (
    <View
      testID={testID}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={[{ width, height }, theme.isRTL ? { transform: [{ scaleX: -1 }] } : null, style]}
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={`spark${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity={0.26} />
            <Stop offset="1" stopColor={stroke} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={area} fill={`url(#spark${id})`} />
        <Path d={line} stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Circle cx={last[0]} cy={last[1]} r={5} fill={theme.colors.surface} stroke={stroke} strokeWidth={2.5} />
      </Svg>
    </View>
  );
}
