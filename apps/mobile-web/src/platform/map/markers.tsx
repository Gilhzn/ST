/**
 * Map marker visuals, shared by web (inside positioned DOM wrappers) and native
 * (inside MapLibre `Marker` views). Kept in one isolated module so they can be swapped
 * for `@st/ui` MapPinMarker / ClusterMarker when the v2 design system ships them.
 *
 * - `MapPinMarker`: sport-colored teardrop with the sport glyph; `full` is hollow
 *   (design §3: "full" is never conveyed by color alone), `live` gets a volt ring.
 *   Selection scale/pulse are applied by the platform wrapper (CSS on web, Animated natively).
 * - `VenueMarker`: small surface-filled badge with a sport ring (venues rank below games).
 * - `ClusterMarker`: ink bubble with a tabular count and up to three sport dots.
 * - `UserDot`: location puck.
 * Purely visual: accessibility (role, label, focus) lives on the wrapper.
 */
import type { SportId } from '@st/domain';
import { contrastRatio, sportColors, useTheme } from '@st/ui';
import { Text, View } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { GLYPHS, type GlyphName } from './glyphs';

/** Teardrop box (dp). The tip sits at (PIN_W / 2, PIN_TIP_Y). */
export const PIN_W = 36;
export const PIN_H = 50;
export const PIN_TIP_Y = 45;
export const SELECTED_SCALE = 1.28;
export const VENUE_SIZE = 26;

const TEARDROP = 'M16.4 42.6 L4.86 26.14 A16 16 0 1 1 31.14 26.14 L19.6 42.6 Q18 44.9 16.4 42.6 Z';

/** Sport glyph color on the pin fill: white when it reads (≥ 2.4:1, a decorative cue), ink otherwise. */
export function glyphOn(fill: string): string {
  return contrastRatio(fill, '#FFFFFF') >= 2.4 ? '#FFFFFF' : '#0A0B12';
}

/** Slightly deeper shade for the bottom of the pin gradient. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * f);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

const sportGlyph = (sport: SportId): GlyphName => sport as GlyphName;

export function Glyph({ name, size, color, x = 0, y = 0 }: { name: GlyphName; size: number; color: string; x?: number; y?: number }) {
  const s = size / 256;
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      {GLYPHS[name].map((d, i) => (
        <Path key={i} d={d} fill={color} />
      ))}
    </G>
  );
}

/** Standalone glyph (filter chips, buttons). */
export function GlyphIcon({ name, size = 20, color }: { name: GlyphName; size?: number; color: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      style={{ flexShrink: 0, width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {GLYPHS[name].map((d, i) => (
        <Path key={i} d={d} fill={color} />
      ))}
    </Svg>
  );
}

export function MapPinMarker({ sport, state }: { sport: SportId; state: 'default' | 'selected' | 'full' | 'live' }) {
  const theme = useTheme();
  const tone = sportColors[sport];
  const hollow = state === 'full';
  const fill = hollow ? theme.colors.surface : tone.color;
  const glyph = hollow ? (contrastRatio(tone.color, theme.colors.surface) >= 2.4 ? tone.color : theme.colors.text) : glyphOn(tone.color);
  const ring = state === 'live' ? theme.colors.accent : '#FFFFFF';
  const id = `${sport}-${state}`;
  return (
    <Svg width={PIN_W} height={PIN_H} viewBox={`0 0 ${PIN_W} ${PIN_H}`}>
      <Defs>
        <LinearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={fill} />
          <Stop offset="1" stopColor={hollow ? fill : shade(tone.color, 0.86)} />
        </LinearGradient>
        <RadialGradient id={`s-${id}`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#000" stopOpacity={state === 'selected' ? 0.38 : 0.3} />
          <Stop offset="1" stopColor="#000" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {/* ground shadow under the tip */}
      <Ellipse cx={PIN_W / 2} cy={PIN_TIP_Y + 0.5} rx={state === 'selected' ? 9 : 7} ry={2.6} fill={`url(#s-${id})`} />
      <Path d={TEARDROP} fill={`url(#g-${id})`} stroke={hollow ? tone.color : ring} strokeWidth={hollow ? 3 : 2.5} strokeLinejoin="round" />
      {/* hairline outline keeps yellow/white pins legible on pale tiles (design §3 pinOutline) */}
      <Path d={TEARDROP} fill="none" stroke="rgba(10,11,18,0.28)" strokeWidth={0.75} />
      <Glyph name={sportGlyph(sport)} size={18} color={glyph} x={9} y={8} />
    </Svg>
  );
}

export function VenueMarker({ sport, selected }: { sport: SportId; selected: boolean }) {
  const theme = useTheme();
  const tone = sportColors[sport];
  const size = selected ? 34 : VENUE_SIZE;
  const glyph = contrastRatio(tone.color, theme.colors.surface) >= 2.4 ? tone.color : theme.colors.text;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.colors.surface,
        borderWidth: 2.5,
        borderColor: tone.color,
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0px 2px 6px rgba(10,11,18,0.28)',
      }}
    >
      <GlyphIcon name={`${sportGlyph(sport)}Bold` as GlyphName} size={size * 0.5} color={glyph} />
    </View>
  );
}

/** Cluster bubble diameter by count tier (design §3: 36/44/52, +4 for the halo ring). */
export function clusterSize(count: number): number {
  return count < 10 ? 40 : count < 100 ? 48 : 56;
}

export function ClusterMarker({ count, sports }: { count: number; sports: readonly SportId[] }) {
  const theme = useTheme();
  const size = clusterSize(count);
  const dark = theme.scheme === 'dark';
  const bg = theme.colors.surfaceInverse;
  const fg = theme.colors.textInverse;
  const family = theme.fontFamily('bold');
  return (
    <View style={{ width: size + 12, height: size + 12, alignItems: 'center', justifyContent: 'center' }}>
      {/* soft halo hints at density without adding visual weight */}
      <View
        style={{
          position: 'absolute',
          width: size + 12,
          height: size + 12,
          borderRadius: (size + 12) / 2,
          backgroundColor: dark ? 'rgba(143,125,255,0.24)' : 'rgba(91,61,245,0.16)',
        }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          borderWidth: 2.5,
          borderColor: dark ? theme.colors.background : '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: dark ? '0px 4px 14px rgba(0,0,0,0.55)' : '0px 4px 14px rgba(18,19,28,0.28)',
        }}
      >
        <Text
          style={{
            color: fg,
            fontSize: count < 100 ? 16 : 15,
            lineHeight: 18,
            fontWeight: theme.usesWeightedFamilies ? undefined : '700',
            fontVariant: ['tabular-nums'],
            ...(family ? { fontFamily: family } : null),
            marginTop: sports.length ? -4 : 0,
          }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {count > 999 ? `${Math.floor(count / 1000)}k+` : String(count)}
        </Text>
        {sports.length ? (
          <View style={{ position: 'absolute', bottom: size < 44 ? 5 : 7, flexDirection: 'row', gap: 2.5 }}>
            {sports.slice(0, 3).map((s) => (
              <View key={s} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sportColors[s].color, borderWidth: 0.5, borderColor: bg }} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function UserDot() {
  const theme = useTheme();
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', boxShadow: '0px 2px 6px rgba(10,11,18,0.35)' }}>
      <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: theme.scheme === 'dark' ? '#4F9DFF' : '#1A73E8' }} />
    </View>
  );
}
