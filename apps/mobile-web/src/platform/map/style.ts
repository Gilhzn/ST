/**
 * Basemap resolution (shared by web and native).
 *
 * - **Production:** a keyless OpenFreeMap vector style (`positron`). Override with
 *   `EXPO_PUBLIC_MAP_STYLE_URL`; `EXPO_PUBLIC_MAP_STYLE_URL_DARK` may point at a dedicated
 *   dark style. Without one, dark mode re-tints the light style at runtime
 *   (`transformRemoteStyle`), so both themes always come from the same tiles.
 *   Labels follow the UI language: `name:<lang>` with a fallback to the local `name`.
 * - **Offline canvas:** `EXPO_PUBLIC_MAP_OFFLINE=1` (the claude.ai Artifact build, whose CSP
 *   blocks every external host) and automated browsers (`navigator.webdriver`, so e2e never
 *   touches the network) use the bundled no-network style. It only paints the land tint; the
 *   dotted lattice, vignette, radius ring and labels are overlays (`OFFLINE_CANVAS`), so no
 *   glyphs or sprites are ever requested. `EXPO_PUBLIC_MAP_OFFLINE=0` forces the online map.
 */
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import offline from '../../../assets/map/offline-style.json';

export const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

type Scheme = 'light' | 'dark';

/** Offline canvas palette (land tint, lattice dots, vignette, outside-radius dimming). */
export const OFFLINE_CANVAS: Record<Scheme, { land: string; dot: string; dotMajor: string; vignette: string; outside: string }> = {
  light: {
    land: '#ECEEF5',
    dot: 'rgba(43, 46, 64, 0.13)',
    dotMajor: 'rgba(75, 47, 224, 0.20)',
    vignette: 'rgba(43, 46, 64, 0.10)',
    outside: 'rgba(43, 46, 64, 0.045)',
  },
  dark: {
    land: '#11131C',
    dot: 'rgba(180, 183, 202, 0.10)',
    dotMajor: 'rgba(154, 140, 255, 0.22)',
    vignette: 'rgba(0, 0, 0, 0.45)',
    outside: 'rgba(0, 0, 0, 0.22)',
  },
};

/** Map container color before the first frame (matches either basemap's land). */
export const LAND_COLOR: Record<Scheme, string> = { light: OFFLINE_CANVAS.light.land, dark: OFFLINE_CANVAS.dark.land };

export function isOfflineMap(): boolean {
  const flag = process.env.EXPO_PUBLIC_MAP_OFFLINE;
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  // Hermetic e2e: Playwright/WebDriver browsers never fetch tiles.
  return typeof navigator !== 'undefined' && (navigator as { webdriver?: boolean }).webdriver === true;
}

export type BasemapSource =
  | { kind: 'offline' }
  /** `retint`: dark mode derived from the light style at runtime. */
  | { kind: 'remote'; url: string; retint: boolean };

export function basemapSource(scheme: Scheme): BasemapSource {
  if (isOfflineMap()) return { kind: 'offline' };
  const light = process.env.EXPO_PUBLIC_MAP_STYLE_URL || DEFAULT_STYLE_URL;
  const dark = process.env.EXPO_PUBLIC_MAP_STYLE_URL_DARK;
  if (scheme === 'dark') return dark ? { kind: 'remote', url: dark, retint: false } : { kind: 'remote', url: light, retint: true };
  return { kind: 'remote', url: light, retint: false };
}

/** True when the offline canvas is in use (no basemap data, so no attribution needed). */
export function usesOfflineStyle(): boolean {
  return isOfflineMap();
}

export function offlineStyle(scheme: Scheme): StyleSpecification {
  const style = JSON.parse(JSON.stringify(offline)) as StyleSpecification;
  for (const layer of style.layers) {
    if (layer.type === 'background') layer.paint = { 'background-color': OFFLINE_CANVAS[scheme].land };
  }
  return style;
}

/* ------------------------------------------------------------------ */
/* Remote style transforms                                             */
/* ------------------------------------------------------------------ */

/** OpenMapTiles name keys to try for a UI locale, most specific first. */
export function nameKeysFor(locale: string): string[] {
  const [lang = 'en', ...rest] = locale.split(/[-_]/);
  const l = lang.toLowerCase();
  const keys: string[] = [];
  if (l === 'zh') {
    const script = rest.find((p) => /^Han[st]$/i.test(p));
    const tw = rest.some((p) => /^(TW|HK|MO)$/i.test(p));
    keys.push(script ? `name:zh-${script[0]?.toUpperCase()}${script.slice(1).toLowerCase()}` : tw ? 'name:zh-Hant' : 'name:zh-Hans', 'name:zh');
  } else {
    keys.push(`name:${l}`);
  }
  if (l !== 'en') keys.push('name:latin');
  return keys;
}

type Json = unknown;

function labelExpression(locale: string): Json {
  const keys = nameKeysFor(locale);
  // name:latin is only a late fallback for non-Latin UIs; the local `name` comes before it.
  const primary = keys.filter((k) => k !== 'name:latin');
  return ['coalesce', ...primary.map((k) => ['get', k]), ['get', 'name'], ...(keys.includes('name:latin') ? [['get', 'name:latin']] : [])];
}

function referencesName(v: Json): boolean {
  const s = JSON.stringify(v ?? '');
  return /name/.test(s) && !/housenumber|"ref"|\{ref\}/.test(s);
}

/* -- color math (hex / rgb[a] / hsl[a]) for the dark re-tint -- */

interface Hsla {
  h: number;
  s: number;
  l: number;
  a: number;
}

function parseColor(input: string): Hsla | null {
  const c = input.trim().toLowerCase();
  let r: number, g: number, b: number, a = 1;
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^#([0-9a-f]{3,8})$/))) {
    const hex = m[1] ?? '';
    const full = hex.length <= 4 ? hex.split('').map((x) => x + x).join('') : hex;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
    if (full.length === 8) a = parseInt(full.slice(6, 8), 16) / 255;
  } else if ((m = c.match(/^rgba?\(([^)]+)\)$/))) {
    const p = (m[1] ?? '').split(/[\s,/]+/).filter(Boolean).map(Number);
    [r = 0, g = 0, b = 0] = p;
    a = p[3] ?? 1;
  } else if ((m = c.match(/^hsla?\(([^)]+)\)$/))) {
    const p = (m[1] ?? '').split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x));
    return { h: p[0] ?? 0, s: (p[1] ?? 0) / 100, l: (p[2] ?? 0) / 100, a: p[3] ?? 1 };
  } else return null;
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s, l, a };
}

const hsla = ({ h, s, l, a }: Hsla) =>
  `hsla(${h.toFixed(1)}, ${(Math.max(0, Math.min(1, s)) * 100).toFixed(1)}%, ${(Math.max(0, Math.min(1, l)) * 100).toFixed(1)}%, ${a})`;

/** Land lightness of the light style; everything is re-mapped relative to it. */
const LIGHT_LAND_L = 0.95;
/** Ink-950-tinted dark land, matching the app canvas (tokens `ink950`/`ink900`). */
const DARK_LAND = { h: 232, l: 0.105 };

function darkFill(c: Hsla): Hsla {
  const d = c.l - LIGHT_LAND_L;
  const l = DARK_LAND.l + (d > 0 ? d * 1.4 : d * 0.34);
  const water = c.h >= 180 && c.h <= 240 && c.s > 0.08;
  return { h: water ? 222 : DARK_LAND.h, s: water ? 0.32 : Math.min(c.s, 0.16), l: Math.max(0.035, l), a: c.a };
}

function darkText(c: Hsla, halo: boolean): Hsla {
  if (halo) return { h: DARK_LAND.h, s: 0.2, l: 0.08, a: c.a };
  return { h: DARK_LAND.h, s: Math.min(c.s, 0.18), l: Math.min(0.86, 1.02 - c.l * 0.75), a: c.a };
}

function mapColors(v: Json, fn: (c: Hsla) => Hsla): Json {
  if (typeof v === 'string') {
    const c = parseColor(v);
    return c ? hsla(fn(c)) : v;
  }
  if (Array.isArray(v)) return v.map((x) => mapColors(x, fn));
  if (v && typeof v === 'object') {
    const o = v as Record<string, Json>;
    if (Array.isArray(o.stops)) return { ...o, stops: (o.stops as Json[]).map((s) => (Array.isArray(s) ? [s[0], mapColors(s[1], fn)] : s)) };
  }
  return v;
}

/**
 * Localizes labels and (optionally) re-tints a light vector style for dark mode.
 * Pure: returns a new object, never mutates the fetched style.
 */
export function transformRemoteStyle(input: StyleSpecification, opts: { locale: string; retint: boolean }): StyleSpecification {
  const style = JSON.parse(JSON.stringify(input)) as StyleSpecification;
  const label = labelExpression(opts.locale);
  for (const layer of style.layers as Array<Record<string, Json>>) {
    const layout = layer.layout as Record<string, Json> | undefined;
    if (layer.type === 'symbol' && layout && referencesName(layout['text-field'])) layout['text-field'] = label;
    if (!opts.retint) continue;
    const paint = layer.paint as Record<string, Json> | undefined;
    if (!paint) continue;
    for (const key of Object.keys(paint)) {
      if (!key.endsWith('-color')) continue;
      if (key === 'text-color') paint[key] = mapColors(paint[key], (c) => darkText(c, false));
      else if (key === 'text-halo-color') paint[key] = mapColors(paint[key], (c) => darkText(c, true));
      else paint[key] = mapColors(paint[key], darkFill);
    }
    if (layer.type === 'fill-extrusion') paint['fill-extrusion-opacity'] = 0.35;
  }
  return style;
}

const styleCache = new Map<string, Promise<StyleSpecification>>();

/** Fetches (once per URL) and transforms a remote style. Rejects on network/JSON errors. */
export function loadRemoteStyle(url: string, opts: { locale: string; retint: boolean }): Promise<StyleSpecification> {
  let raw = styleCache.get(url);
  if (!raw) {
    raw = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`style ${r.status}`);
      return r.json() as Promise<StyleSpecification>;
    });
    raw.catch(() => styleCache.delete(url));
    styleCache.set(url, raw);
  }
  return raw.then((s) => transformRemoteStyle(s, opts));
}

/* ------------------------------------------------------------------ */
/* Geometry                                                             */
/* ------------------------------------------------------------------ */

/** Points on a circle of `radiusKm` around a centre (for the radius ring). */
export function circlePolygon(center: { lat: number; lng: number }, radiusKm: number, steps = 96): [number, number][] {
  const coords: [number, number][] = [];
  const latR = radiusKm / 110.574;
  const lngR = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([center.lng + lngR * Math.cos(a), center.lat + latR * Math.sin(a)]);
  }
  return coords;
}

/** Great-circle distance in km (for "Search this area"). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
