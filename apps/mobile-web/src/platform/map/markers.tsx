/**
 * Map marker visuals shared by web (inside positioned DOM wrappers) and native (inside
 * MapLibre `Marker` views). Game pins and clusters are the `@st/ui` v2 `MapPinMarker` /
 * `ClusterMarker` (re-exported here so the platform maps import from one place); this
 * module adds what the design system doesn't ship yet:
 * - `VenueMarker`: small surface-filled badge with a sport ring (venues rank below games).
 * - `UserDot`: location puck.
 * - `Glyph` / `GlyphIcon`: Phosphor paths for map-internal art (ring label, venue badge).
 */
import type { SportId } from '@st/domain';
import { contrastRatio, mapPinSize, sportColors, useTheme } from '@st/ui';
import { View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

export { ClusterMarker, MapPinMarker } from '@st/ui';

import { GLYPHS, type GlyphName } from './glyphs';

/** Venue badge size (dp); selected venues grow to 34. */
export const VENUE_SIZE = 26;

/** Cluster bubble diameter by count tier (matches `@st/ui` ClusterMarker: 40/48/56). */
export function clusterSize(count: number): number {
  return count < 10 ? 40 : count < 100 ? 48 : 56;
}

/** Height of the `@st/ui` teardrop for a visual width `w` and where its tip sits (40×50 viewBox, tip at 48.5). */
export function pinGeometry(state: 'default' | 'selected' | 'full' | 'live'): { box: number; h: number; tipY: number } {
  const { width, height } = mapPinSize(state);
  return { box: width, h: height, tipY: Math.round((height * 48.5) / 50) };
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

export function UserDot() {
  const theme = useTheme();
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', boxShadow: '0px 2px 6px rgba(10,11,18,0.35)' }}>
      <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: theme.scheme === 'dark' ? '#4F9DFF' : '#1A73E8' }} />
    </View>
  );
}
