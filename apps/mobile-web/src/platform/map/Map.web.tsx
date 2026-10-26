/**
 * Web map: maplibre-gl renders the basemap; pins are React views (`@st/ui`
 * PinBadge / ClusterBadge) positioned over it from `map.project()`, so they keep
 * real accessibility (focusable buttons with labels) and stable test ids
 * (`map.pin.<id>`, `map.cluster.<n>`).
 *
 * Without WebGL (some headless browsers, old devices) the same overlay is drawn
 * on a plain Web-Mercator projection, so the map stays usable everywhere.
 * Maps never mirror in RTL: the container is forced to LTR (design §9.2).
 */
import 'maplibre-gl/dist/maplibre-gl.css';

import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { LatLng, SportId } from '@st/domain';
import { ClusterBadge, PinBadge, sportColors, useTheme } from '@st/ui';
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';

import { buildClusterIndex, type ClusterItem } from './cluster';
import type { MapPoint, MapViewProps } from './Map.types';
import { mapStyleFor, usesBlankStyle } from './style';

const TILE = 512;
const PIN_BOX = 48;

interface Viewport {
  center: LatLng;
  zoom: number;
  width: number;
  height: number;
}

interface Projector {
  project(p: LatLng): { x: number; y: number };
  bbox(): [number, number, number, number];
  zoom: number;
}

function mercatorProjector(v: Viewport): Projector {
  const world = TILE * 2 ** v.zoom;
  const toWorld = (p: LatLng) => {
    const lat = Math.max(-85.0511, Math.min(85.0511, p.lat));
    const s = Math.sin((lat * Math.PI) / 180);
    return { x: ((p.lng + 180) / 360) * world, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world };
  };
  const c = toWorld(v.center);
  const fromWorld = (x: number, y: number): LatLng => {
    const lng = (x / world) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / world;
    return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
  };
  return {
    zoom: v.zoom,
    project(p) {
      const w = toWorld(p);
      return { x: w.x - c.x + v.width / 2, y: w.y - c.y + v.height / 2 };
    },
    bbox() {
      const nw = fromWorld(c.x - v.width / 2, c.y - v.height / 2);
      const se = fromWorld(c.x + v.width / 2, c.y + v.height / 2);
      return [nw.lng, se.lat, se.lng, nw.lat];
    },
  };
}

function glProjector(map: MapLibreMap): Projector {
  return {
    zoom: map.getZoom(),
    project(p) {
      const pt = map.project([p.lng, p.lat]);
      return { x: pt.x, y: pt.y };
    },
    bbox() {
      const b = map.getBounds();
      return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    },
  };
}

let workerConfigured = false;
/** maplibre-gl v6 loads its worker by URL; the export serves it from /public. */
function configureWorker() {
  if (workerConfigured || typeof window === 'undefined') return;
  workerConfigured = true;
  setWorkerUrl(new URL('/maplibre-gl-worker.mjs', window.location.href).href);
}

function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** RNW passes DOM handlers through; RN's ViewProps doesn't type them. */
type WebHandlers = { onClick?: () => void; onKeyDown?: (e: { key: string; preventDefault(): void }) => void };
const webPress = (fn: () => void): WebHandlers => ({
  onClick: fn,
  onKeyDown: (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  },
});

function SportIcon({ sport, color, size }: { sport: SportId; color: string; size: number }) {
  const name = sportColors[sport].icon as ComponentProps<typeof MaterialCommunityIcons>['name'];
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

export function Map({
  points,
  center,
  zoom,
  radiusKm,
  userLocation,
  selectedId,
  scheme,
  onPressPoint,
  onRegionChange,
  clusterLabel,
  accessibilityLabel,
  zoomInLabel,
  zoomOutLabel,
  testID,
}: MapViewProps) {
  const theme = useTheme();
  const containerRef = useRef<ComponentRef<typeof View>>(null);
  const glRef = useRef<MapLibreMap | null>(null);
  const [engine, setEngine] = useState<'pending' | 'gl' | 'static'>('pending');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [staticView, setStaticView] = useState({ center, zoom });
  const [frame, setFrame] = useState(0);
  const onRegionChangeRef = useRef(onRegionChange);
  useEffect(() => {
    onRegionChangeRef.current = onRegionChange;
  }, [onRegionChange]);

  // Create the GL map once.
  useEffect(() => {
    const el = containerRef.current as unknown as HTMLElement | null;
    if (!el || !webglAvailable()) {
      setEngine('static');
      return;
    }
    configureWorker();
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: el,
        style: mapStyleFor(scheme) as never,
        center: [center.lng, center.lat],
        zoom,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        attributionControl: usesBlankStyle() ? false : { compact: true },
        fadeDuration: 0,
      });
    } catch {
      setEngine('static');
      return;
    }
    glRef.current = map;
    let raf = 0;
    const redraw = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setFrame((f) => f + 1);
      });
    };
    map.on('move', redraw);
    map.on('resize', redraw);
    map.on('load', redraw);
    map.on('moveend', (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return;
      const c = map.getCenter();
      onRegionChangeRef.current?.({ center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() });
    });
    map.on('error', () => undefined); // tile/network errors must not surface as app errors
    setEngine('gl');
    return () => {
      if (raf) cancelAnimationFrame(raf);
      glRef.current = null;
      map.remove();
    };
    // Created once; camera and style are synced by the effects below.
  }, []);

  // Theme → style.
  useEffect(() => {
    const map = glRef.current;
    if (engine === 'gl' && map) map.setStyle(mapStyleFor(scheme) as never);
  }, [engine, scheme]);

  // Controlled camera.
  useEffect(() => {
    const map = glRef.current;
    if (engine === 'gl' && map) {
      const c = map.getCenter();
      if (Math.abs(c.lat - center.lat) > 1e-6 || Math.abs(c.lng - center.lng) > 1e-6 || Math.abs(map.getZoom() - zoom) > 0.01) {
        map.easeTo({ center: [center.lng, center.lat], zoom, duration: theme.reducedMotion ? 0 : 400 });
      }
    } else if (engine === 'static') {
      setStaticView({ center, zoom });
    }
  }, [engine, center.lat, center.lng, zoom, theme.reducedMotion]);

  const index = useMemo(() => buildClusterIndex(points), [points]);

  const projector: Projector | null =
    size.width === 0
      ? null
      : engine === 'gl' && glRef.current
        ? glProjector(glRef.current)
        : engine === 'static'
          ? mercatorProjector({ ...staticView, ...size })
          : null;
  void frame; // re-render trigger for GL camera moves

  const items: ClusterItem[] = projector ? index.query(projector.bbox(), projector.zoom) : [];

  const zoomTo = (target: LatLng, z: number) => {
    const map = glRef.current;
    if (map) map.easeTo({ center: [target.lng, target.lat], zoom: z, duration: theme.reducedMotion ? 0 : 400 });
    else {
      setStaticView({ center: target, zoom: z });
      onRegionChange?.({ center: target, zoom: z });
    }
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
    glRef.current?.resize();
  };

  const ring = (() => {
    if (!projector || !radiusKm) return null;
    const c = projector.project(center);
    const north = projector.project({ lat: center.lat + radiusKm / 110.574, lng: center.lng });
    const r = Math.abs(c.y - north.y);
    if (!Number.isFinite(r) || r < 4) return null;
    return { x: c.x, y: c.y, r };
  })();
  const me = projector && userLocation ? projector.project(userLocation) : null;

  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="none"
      onLayout={onLayout}
      style={{ flex: 1, direction: 'ltr', overflow: 'hidden', backgroundColor: scheme === 'dark' ? '#1A1C26' : '#E8EBF2' }}
    >
      <View ref={containerRef} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}>
        {ring ? (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: 'absolute',
              start: ring.x - ring.r,
              top: ring.y - ring.r,
              width: ring.r * 2,
              height: ring.r * 2,
              borderRadius: ring.r,
              borderWidth: 2,
              borderColor: theme.colors.primary,
              backgroundColor: theme.scheme === 'dark' ? 'rgba(154,140,255,0.08)' : 'rgba(75,47,224,0.06)',
            }}
          />
        ) : null}
        {me ? (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: 'absolute',
              start: me.x - 9,
              top: me.y - 9,
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: theme.colors.info,
              borderWidth: 3,
              borderColor: theme.colors.pinRing,
              boxShadow: '0px 1px 4px rgba(0,0,0,0.35)',
            }}
          />
        ) : null}
        {projector
          ? items.map((item) => {
              const at = projector.project(item.at);
              if (at.x < -PIN_BOX || at.y < -PIN_BOX || at.x > size.width + PIN_BOX || at.y > size.height + PIN_BOX) return null;
              const pos = { position: 'absolute' as const, start: at.x - PIN_BOX / 2, top: at.y - PIN_BOX / 2 };
              if (item.type === 'cluster') {
                return (
                  <View
                    key={item.key}
                    testID={`map.cluster.${item.clusterId}`}
                    style={[pos, { zIndex: 2, cursor: 'pointer' } as object]}
                    {...(webPress(() => zoomTo(item.at, item.expansionZoom)) as object)}
                  >
                    <ClusterBadge count={item.count} sports={item.sports} accessibilityLabel={clusterLabel(item.count, item.sports)} />
                  </View>
                );
              }
              return <Pin key={item.key} point={item.point} selected={item.point.id === selectedId} style={pos} onPress={onPressPoint} />;
            })
          : null}
      </View>
      {engine === 'static' ? (
        <StaticZoomControls
          zoomInLabel={zoomInLabel}
          zoomOutLabel={zoomOutLabel}
          zoomIn={() => zoomTo(staticView.center, Math.min(18, staticView.zoom + 1))}
          zoomOut={() => zoomTo(staticView.center, Math.max(3, staticView.zoom - 1))}
        />
      ) : null}
    </View>
  );
}

function Pin({
  point,
  selected,
  style,
  onPress,
}: {
  point: MapPoint;
  selected: boolean;
  style: object;
  onPress?: (p: MapPoint) => void;
}) {
  const theme = useTheme();
  const isVenue = point.kind === 'venue';
  const state = selected ? 'selected' : isVenue ? 'full' : point.state;
  const t = sportColors[point.sport];
  const iconColor = state === 'full' ? theme.colors.text : t.on;
  const size = isVenue && !selected ? 24 : undefined;
  return (
    <View
      testID={`map.pin.${point.id}`}
      style={[style, { zIndex: selected ? 3 : isVenue ? 0 : 1, cursor: 'pointer' } as object]}
      {...(webPress(() => onPress?.(point)) as object)}
    >
      <PinBadge
        sport={point.sport}
        state={state}
        size={size}
        accessibilityLabel={point.label}
        icon={<SportIcon sport={point.sport} color={iconColor} size={isVenue ? 12 : 18} />}
      />
    </View>
  );
}

function StaticZoomControls({
  zoomIn,
  zoomOut,
  zoomInLabel,
  zoomOutLabel,
}: {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomInLabel: string;
  zoomOutLabel: string;
}) {
  const theme = useTheme();
  const btn = {
    width: 40,
    height: 40,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.colors.surface,
  };
  return (
    <View
      style={{
        position: 'absolute',
        top: 140,
        end: 12,
        borderRadius: 12,
        overflow: 'hidden',
        ...theme.elevation(2),
      }}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={zoomInLabel} onPress={zoomIn} style={btn}>
        <Text style={{ fontSize: 22, color: theme.colors.text }}>+</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={zoomOutLabel} onPress={zoomOut} style={btn}>
        <Text style={{ fontSize: 22, color: theme.colors.text }}>−</Text>
      </Pressable>
    </View>
  );
}
