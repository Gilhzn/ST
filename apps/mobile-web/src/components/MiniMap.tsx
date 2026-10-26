/**
 * Static mini map chip (no tiles, no network): a stylised block of streets and a park in the
 * map palette with a sport-colored teardrop pin, or a blurred area disc when the exact spot is
 * hidden. Decorative; the venue text next to it carries the meaning.
 */
import type { SportId } from '@st/domain';
import { Icon, radius, sportColors, useTheme } from '@st/ui';
import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export function MiniMap({ sport, hidden, size = 64 }: { sport: SportId; hidden?: boolean; size?: number }) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const base = dark ? '#1B1D24' : '#F2EFE9';
  const road = dark ? '#2E3140' : '#FFFFFF';
  const park = dark ? '#1E3326' : '#D7EDCF';
  const water = dark ? '#18293D' : '#CFE3F5';
  const pin = sportColors[sport].color;
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: radius.md, overflow: 'hidden', backgroundColor: base, borderWidth: 1, borderColor: theme.colors.border }}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Rect x={0} y={0} width={64} height={64} fill={base} />
        <Path d="M40 0 L64 0 L64 22 C56 26 48 20 40 0 Z" fill={water} />
        <Rect x={4} y={36} width={22} height={18} rx={4} fill={park} />
        <Path d="M-4 28 L68 20" stroke={road} strokeWidth={5} />
        <Path d="M30 -4 L36 68" stroke={road} strokeWidth={4} />
        <Path d="M-4 58 L68 46" stroke={road} strokeWidth={3} />
        {hidden ? <Circle cx={33} cy={32} r={16} fill={pin} fillOpacity={0.22} stroke={pin} strokeWidth={1.5} strokeDasharray="3 3" /> : null}
        {!hidden ? (
          <>
            <Circle cx={33} cy={41} r={3} fill="#000000" fillOpacity={0.18} />
            <Path d="M33 41 C27 33 23 29 23 24 A10 10 0 0 1 43 24 C43 29 39 33 33 41 Z" fill={pin} stroke="#FFFFFF" strokeWidth={2} />
            <Circle cx={33} cy={24} r={3.5} fill="#FFFFFF" />
          </>
        ) : null}
      </Svg>
      {hidden ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="LockSimple" size={18} weight="fill" color={dark ? '#F4F4FA' : '#121129'} />
        </View>
      ) : null}
    </View>
  );
}
