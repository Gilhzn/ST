import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { basemapSource, DEFAULT_STYLE_URL, nameKeysFor, offlineStyle, OFFLINE_CANVAS, transformRemoteStyle } from '../style';

/** A trimmed OpenMapTiles/positron-like style: the shapes the transform has to handle. */
const positronLike = {
  version: 8,
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': 'rgb(242,243,240)' } },
    { id: 'water', type: 'fill', paint: { 'fill-color': 'rgb(194, 200, 202)' } },
    { id: 'road', type: 'line', paint: { 'line-color': '#fff', 'line-width': { stops: [[10, 1], [16, 4]] } } },
    { id: 'park', type: 'fill', paint: { 'fill-color': { stops: [[8, 'hsla(80, 30%, 90%, 0.6)'], [14, 'hsl(80, 30%, 88%)']] } } },
    {
      id: 'place',
      type: 'symbol',
      layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']] },
      paint: { 'text-color': '#333', 'text-halo-color': 'rgba(255,255,255,0.8)' },
    },
    { id: 'housenum', type: 'symbol', layout: { 'text-field': '{housenumber}' } },
    { id: 'shield', type: 'symbol', layout: { 'text-field': '{ref}' } },
  ],
} as unknown as StyleSpecification;

const lightness = (hsla: string) => Number(/,\s*([\d.]+)%,\s*[\d.]+\)$/.exec(hsla)?.[1]);

describe('basemap style', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to OpenFreeMap positron and re-tints it for dark mode', () => {
    vi.stubEnv('EXPO_PUBLIC_MAP_OFFLINE', '0');
    vi.stubEnv('EXPO_PUBLIC_MAP_STYLE_URL', '');
    vi.stubEnv('EXPO_PUBLIC_MAP_STYLE_URL_DARK', '');
    expect(basemapSource('light')).toEqual({ kind: 'remote', url: DEFAULT_STYLE_URL, retint: false });
    expect(basemapSource('dark')).toEqual({ kind: 'remote', url: DEFAULT_STYLE_URL, retint: true });
  });

  it('uses a dedicated dark style as-is, and the offline canvas when asked', () => {
    vi.stubEnv('EXPO_PUBLIC_MAP_OFFLINE', '0');
    vi.stubEnv('EXPO_PUBLIC_MAP_STYLE_URL_DARK', 'https://example.test/dark');
    expect(basemapSource('dark')).toEqual({ kind: 'remote', url: 'https://example.test/dark', retint: false });
    vi.stubEnv('EXPO_PUBLIC_MAP_OFFLINE', '1');
    expect(basemapSource('dark')).toEqual({ kind: 'offline' });
  });

  it('offline style has no sources, glyphs or sprites and is tinted per theme', () => {
    const s = offlineStyle('dark');
    expect(s.sources).toEqual({});
    expect(s.glyphs).toBeUndefined();
    expect(s.sprite).toBeUndefined();
    expect(s.layers[0]).toMatchObject({ type: 'background', paint: { 'background-color': OFFLINE_CANVAS.dark.land } });
  });

  it('maps UI locales to OpenMapTiles name keys', () => {
    expect(nameKeysFor('en-US')).toEqual(['name:en']);
    expect(nameKeysFor('he')).toEqual(['name:he', 'name:latin']);
    expect(nameKeysFor('zh-Hant-TW')[0]).toBe('name:zh-Hant');
    expect(nameKeysFor('zh-CN')[0]).toBe('name:zh-Hans');
  });

  it('localizes name labels (with a fallback to `name`) and leaves refs/house numbers alone', () => {
    const out = transformRemoteStyle(positronLike, { locale: 'he-IL', retint: false });
    const byId = Object.fromEntries(out.layers.map((l) => [l.id, l as unknown as { layout?: Record<string, unknown> }]));
    expect(byId.place?.layout?.['text-field']).toEqual(['coalesce', ['get', 'name:he'], ['get', 'name'], ['get', 'name:latin']]);
    expect(byId.housenum?.layout?.['text-field']).toBe('{housenumber}');
    expect(byId.shield?.layout?.['text-field']).toBe('{ref}');
    expect(positronLike.layers[4]).toMatchObject({ layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']] } }); // not mutated
  });

  it('dark re-tint keeps the light ordering (roads above land, water below) and inverts text', () => {
    const out = transformRemoteStyle(positronLike, { locale: 'en', retint: true });
    const paint = (id: string) => (out.layers.find((l) => l.id === id) as unknown as { paint: Record<string, unknown> }).paint;
    const land = lightness(paint('background')['background-color'] as string);
    const water = lightness(paint('water')['fill-color'] as string);
    const road = lightness(paint('road')['line-color'] as string);
    const text = lightness(paint('place')['text-color'] as string);
    expect(land).toBeLessThan(15);
    expect(water).toBeLessThan(land);
    expect(road).toBeGreaterThan(land);
    expect(text).toBeGreaterThan(60);
    const park = paint('park')['fill-color'] as { stops: [number, string][] };
    expect(park.stops.every(([, c]) => c.startsWith('hsla('))).toBe(true);
  });
});
