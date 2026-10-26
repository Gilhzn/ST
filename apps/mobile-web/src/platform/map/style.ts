/**
 * Map style resolution. `EXPO_PUBLIC_MAP_STYLE_URL` (and optional `_DARK`) point at a
 * vector style (OpenFreeMap / MapTiler / Stadia). Without one we use the bundled
 * blank style, so e2e and offline demos need no network.
 */
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import blank from './blank-style.json';

const BLANK_BG = { light: '#E8EBF2', dark: '#1A1C26' } as const;

export function mapStyleFor(scheme: 'light' | 'dark'): string | StyleSpecification {
  const light = process.env.EXPO_PUBLIC_MAP_STYLE_URL;
  const dark = process.env.EXPO_PUBLIC_MAP_STYLE_URL_DARK;
  const url = scheme === 'dark' ? (dark ?? light) : light;
  if (url) return url;
  const style = JSON.parse(JSON.stringify(blank)) as StyleSpecification;
  const bg = style.layers[0];
  if (bg && bg.type === 'background') bg.paint = { 'background-color': BLANK_BG[scheme] };
  return style;
}

/** True when the bundled blank style is in use (no basemap, no attribution needed). */
export function usesBlankStyle(): boolean {
  return !process.env.EXPO_PUBLIC_MAP_STYLE_URL;
}

/** Points on a circle of `radiusKm` around a centre (for the radius ring). */
export function circlePolygon(center: { lat: number; lng: number }, radiusKm: number, steps = 64): [number, number][] {
  const coords: [number, number][] = [];
  const latR = radiusKm / 110.574;
  const lngR = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([center.lng + lngR * Math.cos(a), center.lat + latR * Math.sin(a)]);
  }
  return coords;
}
