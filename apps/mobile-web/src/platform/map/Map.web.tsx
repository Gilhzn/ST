/**
 * Web map: maplibre-gl draws the basemap; markers, the radius ring, the user dot and the
 * offline canvas (dotted lattice + vignette) are DOM overlays.
 *
 * Performance (2,000+ pins): games are clustered (supercluster) and only the clusters/pins
 * in a padded viewport are mounted. React renders them when the cluster set changes
 * (move end, or crossing an integer zoom); during gestures every overlay is positioned
 * imperatively with `translate3d` from the map's `move` event, so a pan never re-renders React.
 *
 * Accessibility: each marker is a focusable `role="button"` with a spoken label and a stable
 * test id (`map.pin.<id>`, `map.cluster.<n>`). Without WebGL (some headless browsers, old
 * devices) the same overlays are drawn on a Web-Mercator projection with drag-to-pan and zoom
 * buttons. Maps never mirror in RTL: the container is forced to LTR (design §9.2).
 */
import 'maplibre-gl/dist/maplibre-gl.css';

import type { LatLng } from '@st/domain';
import { useTheme } from '@st/ui';
import { Map as MapLibreMap, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';

import { buildClusterIndex, type ClusterItem } from './cluster';
import { cameraDurationMs, type MapPadding, type MapPoint, type MapViewProps } from './Map.types';
import { ClusterMarker, clusterSize, GlyphIcon, MapPinMarker, pinGeometry, UserDot, VenueMarker, VENUE_SIZE } from './markers';
import { distanceKm, LAND_COLOR, OFFLINE_CANVAS, usesOfflineStyle } from './style';
import { useBasemap } from './useBasemap';

const TILE = 512;
const NO_PADDING: MapPadding = { top: 0, bottom: 0 };

interface Projector {
  project(p: LatLng): { x: number; y: number };
  bbox(): [number, number, number, number];
  zoom: number;
}

interface StaticCamera {
  center: LatLng;
  zoom: number;
}

const toWorld = (p: LatLng, world: number) => {
  const lat = Math.max(-85.0511, Math.min(85.0511, p.lat));
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((p.lng + 180) / 360) * world, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world };
};

/** Web-Mercator projector for the no-WebGL fallback; `center` sits in the middle of the padded area. */
function mercatorProjector(cam: StaticCamera, w: number, h: number, pad: MapPadding): Projector {
  const world = TILE * 2 ** cam.zoom;
  const c = toWorld(cam.center, world);
  const ax = w / 2;
  const ay = pad.top + (h - pad.top - pad.bottom) / 2;
  const fromWorld = (x: number, y: number): LatLng => {
    const lng = (x / world) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / world;
    return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
  };
  return {
    zoom: cam.zoom,
    project(p) {
      const q = toWorld(p, world);
      return { x: q.x - c.x + ax, y: q.y - c.y + ay };
    },
    bbox() {
      const nw = fromWorld(c.x - ax, c.y - ay);
      const se = fromWorld(c.x + (w - ax), c.y + (h - ay));
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

/** Viewport bbox grown by half a screen on each side, so pans don't pop markers in. */
function padBbox([w, s, e, n]: [number, number, number, number]): [number, number, number, number] {
  const dx = (e - w) / 2;
  const dy = (n - s) / 2;
  return [Math.max(-180, w - dx), Math.max(-85, s - dy), Math.min(180, e + dx), Math.min(85, n + dy)];
}

let workerConfigured = false;
/**
 * maplibre-gl v6 loads its worker by URL; the export serves it from /public. Resolved against
 * the app root: the site origin normally, or the Artifact demo's own directory (`__ST_BASE__`,
 * set by scripts/artifact-boot.js) when the page is served from a sub-path.
 */
function configureWorker() {
  if (workerConfigured || typeof window === 'undefined') return;
  workerConfigured = true;
  const appRoot = (window as { __ST_BASE__?: string }).__ST_BASE__ ?? `${window.location.origin}/`;
  setWorkerUrl(new URL('maplibre-gl-worker.mjs', appRoot).href);
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

/* ------------------------------------------------------------------ */
/* Overlay stylesheet (injected once)                                  */
/* ------------------------------------------------------------------ */

const CSS = `
.st-ov{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.st-mk{position:absolute;left:0;top:0;will-change:transform;pointer-events:none}
.st-hit{position:absolute;pointer-events:auto;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent;border-radius:24px}
.st-hit:focus-visible{box-shadow:0 0 0 3px var(--st-focus)}
.st-vis{position:absolute;transition:transform 220ms cubic-bezier(.3,0,0,1.15),filter 220ms ease}
.st-pin .st-vis{transform-origin:50% var(--st-tip)}
.st-pin.is-sel .st-vis{filter:drop-shadow(0 8px 12px rgba(11,10,28,.30));animation:st-pop 260ms cubic-bezier(.3,0,0,1.15)}
.st-hit:hover .st-vis{transform:scale(1.08)}
.st-pin.is-sel .st-hit:hover .st-vis{transform:none}
@keyframes st-pop{0%{transform:scale(.78)}100%{transform:scale(1)}}
.st-cl .st-vis{transform-origin:50% 50%}
.st-me-halo{position:absolute;border-radius:50%;pointer-events:none;background:var(--st-me);animation:st-pulse 2.4s cubic-bezier(0,0,.2,1) infinite}
.st-ring{position:absolute;left:0;top:0;border-radius:50%;pointer-events:none;will-change:transform,width,height}
.st-ring-label{position:absolute;left:0;top:0;pointer-events:none;will-change:transform;transition:opacity 160ms ease}
@keyframes st-pulse{0%{transform:scale(.55);opacity:.7}80%,100%{transform:scale(1.9);opacity:0}}
.st-rm .st-me-halo{animation:none;transform:scale(1.15);opacity:.35}
.st-rm .st-vis{transition:none;animation:none}
@media (prefers-reduced-motion: reduce){.st-me-halo{animation:none;transform:scale(1.15);opacity:.35}.st-vis{transition:none;animation:none}}
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-st', 'map');
  el.textContent = CSS;
  document.head.appendChild(el);
}

/* ------------------------------------------------------------------ */
/* Offline canvas: hex dot lattice anchored to the world               */
/* ------------------------------------------------------------------ */

const LATTICE = 22; // px between dots at an integer zoom

function rgbaWithAlpha(rgba: string, mult: number): string {
  return rgba.replace(/rgba\(([^)]+),\s*([\d.]+)\)/, (_m, rgb: string, a: string) => `rgba(${rgb}, ${(Number(a) * mult).toFixed(3)})`);
}

/**
 * Two hex lattices: the coarse one at spacing `a` and a finer one at `a / 2` that fades in as you
 * zoom towards the next integer level, so zooming feels continuous (the coarse lattice is a
 * subset of the fine one, so the hand-over at integer zooms is seamless).
 */
function latticeStyle(origin: { x: number; y: number }, zoom: number, dot: string) {
  const f = 2 ** (zoom - Math.floor(zoom));
  const layers: { img: string; size: string; pos: string }[] = [];
  const add = (a: number, color: string, r: number) => {
    const h = a * Math.sqrt(3);
    const ox = ((origin.x % a) + a) % a;
    const oy = ((origin.y % h) + h) % h;
    const img = `radial-gradient(circle, ${color} 0 ${r}px, transparent ${r + 0.6}px)`;
    layers.push({ img, size: `${a}px ${h}px`, pos: `${ox}px ${oy}px` });
    layers.push({ img, size: `${a}px ${h}px`, pos: `${ox + a / 2}px ${oy + h / 2}px` });
  };
  const a = LATTICE * f;
  add(a, dot, 1.15);
  add(a / 2, rgbaWithAlpha(dot, Math.max(0, f - 1)), 1.15);
  return {
    backgroundImage: layers.map((l) => l.img).join(','),
    backgroundSize: layers.map((l) => l.size).join(','),
    backgroundPosition: layers.map((l) => l.pos).join(','),
  };
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

type WebKey = { key: string; preventDefault(): void; stopPropagation(): void };

export function Map({
  points,
  center,
  zoom,
  cameraKey = 0,
  padding = NO_PADDING,
  radiusKm,
  radiusLabel,
  userLocation,
  selectedId,
  scheme,
  onPressPoint,
  onPressMap,
  onRegionChange,
  clusterLabel,
  accessibilityLabel,
  zoomInLabel,
  zoomOutLabel,
  testID,
}: MapViewProps) {
  const theme = useTheme();
  const basemap = useBasemap(scheme, theme.locale);
  const offlineCanvas = basemap.offline;
  const canvas = OFFLINE_CANVAS[scheme];

  const containerRef = useRef<ComponentRef<typeof View>>(null);
  const glRef = useRef<MapLibreMap | null>(null);
  const [engine, setEngine] = useState<'pending' | 'gl' | 'static'>('pending');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [staticCam, setStaticCam] = useState<StaticCamera>({ center, zoom });
  /** Bumped when the set of visible clusters may have changed. */
  const [snapshot, setSnapshot] = useState(0);

  const latest = useRef({ onRegionChange, onPressMap, padding, center, radiusKm, size, staticCam, offlineCanvas, canvas });
  latest.current = { onRegionChange, onPressMap, padding, center, radiusKm, size, staticCam, offlineCanvas, canvas };

  // Imperatively positioned overlay nodes.
  const markerNodes = useRef(new globalThis.Map<string, { el: HTMLDivElement; at: LatLng }>());
  const ringEl = useRef<HTMLDivElement | null>(null);
  const ringLabelEl = useRef<HTMLDivElement | null>(null);
  const meEl = useRef<HTMLDivElement | null>(null);
  const latticeEl = useRef<HTMLDivElement | null>(null);
  const userRef = useRef(userLocation);
  userRef.current = userLocation;

  useEffect(injectCss, []);

  const projector = useCallback((): Projector | null => {
    const { size: s, staticCam: cam, padding: pad } = latest.current;
    if (!s.width) return null;
    const map = glRef.current;
    if (map) return glProjector(map);
    return mercatorProjector(cam, s.width, s.height, pad);
  }, []);

  /** Positions every overlay for the current camera. Cheap: no React work. */
  const place = useCallback(() => {
    const proj = projector();
    if (!proj) return;
    const { size: s, center: c, radiusKm: r, padding: pad, offlineCanvas: off, canvas: cv } = latest.current;
    const margin = 80;
    for (const { el, at } of markerNodes.current.values()) {
      const p = proj.project(at);
      const out = p.x < -margin || p.y < -margin || p.x > s.width + margin || p.y > s.height + margin;
      el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      el.style.visibility = out ? 'hidden' : 'visible';
    }
    const ring = ringEl.current;
    const label = ringLabelEl.current;
    if (ring) {
      const cp = proj.project(c);
      const north = proj.project({ lat: c.lat + (r ?? 0) / 110.574, lng: c.lng });
      const rad = Math.abs(cp.y - north.y);
      const show = !!r && Number.isFinite(rad) && rad >= 6;
      ring.style.display = show ? 'block' : 'none';
      if (show) {
        ring.style.width = `${rad * 2}px`;
        ring.style.height = `${rad * 2}px`;
        ring.style.transform = `translate3d(${(cp.x - rad).toFixed(1)}px, ${(cp.y - rad).toFixed(1)}px, 0)`;
      }
      if (label) {
        // Ring label sits on the ring's top edge, or the bottom edge if the top is under the search UI.
        const topY = cp.y - rad;
        const botY = cp.y + rad;
        const y = topY > pad.top + 14 ? topY : botY < s.height - pad.bottom - 14 ? botY : null;
        label.style.opacity = show && y !== null ? '1' : '0';
        if (y !== null) label.style.transform = `translate3d(${cp.x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      }
    }
    const me = meEl.current;
    const u = userRef.current;
    if (me) {
      if (u) {
        const p = proj.project(u);
        me.style.display = 'block';
        me.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      } else me.style.display = 'none';
    }
    const lattice = latticeEl.current;
    if (lattice && off) {
      const origin = proj.project({ lat: 0, lng: 0 });
      const st = latticeStyle(origin, proj.zoom, cv.dot);
      lattice.style.backgroundImage = st.backgroundImage;
      lattice.style.backgroundSize = st.backgroundSize;
      lattice.style.backgroundPosition = st.backgroundPosition;
    }
  }, [projector]);

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
        style: basemap.style as unknown as StyleSpecification,
        center: [center.lng, center.lat],
        zoom,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        attributionControl: usesOfflineStyle() ? false : { compact: true },
        fadeDuration: 150,
        renderWorldCopies: false,
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
    } catch {
      setEngine('static');
      return;
    }
    glRef.current = map;
    let lastZ = Math.round(zoom);
    map.on('move', place);
    map.on('zoom', () => {
      const z = Math.round(map.getZoom());
      if (z !== lastZ) {
        lastZ = z;
        setSnapshot((n) => n + 1);
      }
    });
    map.on('resize', place);
    map.on('load', () => setSnapshot((n) => n + 1));
    map.on('moveend', (e: { originalEvent?: unknown; stUser?: boolean }) => {
      setSnapshot((n) => n + 1);
      if (!e.originalEvent && !e.stUser) return;
      const c = map.getCenter();
      latest.current.onRegionChange?.({ center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() });
    });
    map.on('click', (e: { originalEvent?: Event }) => {
      // Marker taps bubble through the canvas container too; they are not map taps.
      const target = e.originalEvent?.target as Element | null | undefined;
      if (target?.closest?.('.st-hit')) return;
      latest.current.onPressMap?.();
    });
    map.on('error', () => undefined); // tile/network errors must not surface as app errors
    setEngine('gl');
    return () => {
      glRef.current = null;
      map.remove();
    };
    // Created once; camera and style are synced by the effects below.
  }, []);

  // Theme / language → style.
  const styleKey = useRef(basemap.key);
  useEffect(() => {
    const map = glRef.current;
    if (engine !== 'gl' || !map || styleKey.current === basemap.key) return;
    styleKey.current = basemap.key;
    map.setStyle(basemap.style as unknown as StyleSpecification, { diff: false });
  }, [engine, basemap.key]);

  // Controlled camera: moves only when the requested target changes (never fights the user).
  const lastCamera = useRef<string | null>(null);
  useEffect(() => {
    const key = `${center.lat},${center.lng},${zoom},${cameraKey},${padding.top},${padding.bottom}`;
    const first = lastCamera.current === null;
    if (lastCamera.current === key) return;
    const map = glRef.current;
    if (engine === 'gl' && map) {
      lastCamera.current = key;
      const pad = { top: padding.top, bottom: padding.bottom, left: 0, right: 0 };
      if (first) {
        map.jumpTo({ center: [center.lng, center.lat], zoom, padding: pad });
        return;
      }
      const from = map.getCenter();
      const dist = distanceKm({ lat: from.lat, lng: from.lng }, center);
      const duration = cameraDurationMs(dist, zoom - map.getZoom(), theme.reducedMotion);
      const target = { center: [center.lng, center.lat] as [number, number], zoom, padding: pad, duration, essential: true };
      if (dist > 30 && duration > 0) map.flyTo({ ...target, curve: 1.42 });
      else map.easeTo({ ...target, easing: easeStandard });
    } else if (engine === 'static') {
      lastCamera.current = key;
      setStaticCam({ center, zoom });
    }
  }, [engine, center.lat, center.lng, zoom, cameraKey, padding.top, padding.bottom, theme.reducedMotion]);

  const index = useMemo(() => buildClusterIndex(points), [points]);

  // Visible clusters/pins (re-queried on move end and integer-zoom changes only).
  const items: ClusterItem[] = useMemo(() => {
    const proj = projector();
    if (!proj) return [];
    return index.query(padBbox(proj.bbox()), proj.zoom);
    // `snapshot`, `staticCam`, `size` and `engine` invalidate the camera-dependent query.
  }, [index, snapshot, staticCam, size.width, size.height, engine, projector]);

  // Position after every render (new nodes, prop changes, static camera).
  useLayoutEffect(() => {
    place();
  });

  const zoomTo = (target: LatLng, z: number) => {
    const map = glRef.current;
    if (map) {
      map.easeTo(
        { center: [target.lng, target.lat], zoom: z, duration: theme.reducedMotion ? 0 : 520, easing: easeStandard, essential: true },
        { stUser: true },
      );
    } else {
      setStaticCam({ center: target, zoom: z });
      onRegionChange?.({ center: target, zoom: z });
    }
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
    glRef.current?.resize();
  };

  // Static engine: drag to pan (pointer events), so "Search this area" works without WebGL too.
  const drag = useRef<{ x: number; y: number; cam: StaticCamera; moved: boolean } | null>(null);
  const staticHandlers =
    engine === 'static'
      ? {
          onPointerDown: (e: { clientX: number; clientY: number }) => {
            drag.current = { x: e.clientX, y: e.clientY, cam: staticCam, moved: false };
          },
          onPointerMove: (e: { clientX: number; clientY: number }) => {
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (!d.moved && Math.hypot(dx, dy) < 4) return;
            d.moved = true;
            const world = TILE * 2 ** d.cam.zoom;
            const c = toWorld(d.cam.center, world);
            const x = c.x - dx;
            const y = c.y - dy;
            const lng = (x / world) * 360 - 180;
            const n = Math.PI - (2 * Math.PI * y) / world;
            setStaticCam({ zoom: d.cam.zoom, center: { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng } });
          },
          onPointerUp: (e: { target: EventTarget | null }) => {
            const d = drag.current;
            drag.current = null;
            if (!d) return;
            if (d.moved) onRegionChange?.(latest.current.staticCam);
            else if (!(e.target as Element | null)?.closest?.('.st-hit')) onPressMap?.();
          },
        }
      : null;

  const selectedFirst = useMemo(() => {
    // Selected marker last so it paints on top; venues first (below games).
    return [...items].sort((a, b) => rank(a, selectedId) - rank(b, selectedId));
  }, [items, selectedId]);

  const register = (key: string, at: LatLng) => (el: HTMLDivElement | null) => {
    if (el) markerNodes.current.set(key, { el, at });
    else markerNodes.current.delete(key);
  };

  const cssVars = {
    '--st-focus': theme.colors.focusRing,
    '--st-me': scheme === 'dark' ? 'rgba(79,157,255,0.35)' : 'rgba(26,115,232,0.25)',
  } as Record<string, string>;

  // GL: overlays live inside MapLibre's canvas container, so a drag that starts on a marker
  // still pans the map (like MapLibre's own Marker). Static: rendered inline.
  const glHost = engine === 'gl' && glRef.current ? glRef.current.getCanvasContainer() : null;
  const overlay = (
    <div
      className={`st-ov${theme.reducedMotion ? ' st-rm' : ''}`}
      style={{ ...cssVars, pointerEvents: engine === 'static' ? 'auto' : 'none', touchAction: engine === 'static' ? 'none' : undefined }}
      {...(staticHandlers ?? {})}
    >
      {offlineCanvas ? <div ref={latticeEl} className="st-ov" aria-hidden /> : null}
      <div
        ref={ringEl}
        className="st-ring"
        aria-hidden
        style={{
          display: 'none',
          border: `2px solid ${theme.colors.primary}`,
          background: scheme === 'dark' ? 'rgba(143,125,255,0.06)' : 'rgba(91,61,245,0.035)',
          boxShadow: `0 0 0 200vmax ${offlineCanvas ? canvas.outside : scheme === 'dark' ? 'rgba(0,0,0,0.18)' : 'rgba(18,19,28,0.06)'}, inset 0 0 36px ${
            scheme === 'dark' ? 'rgba(143,125,255,0.14)' : 'rgba(91,61,245,0.07)'
          }`,
        }}
      />
      {offlineCanvas ? (
        <div
          className="st-ov"
          aria-hidden
          style={{ background: `radial-gradient(ellipse 120% 90% at 50% 48%, transparent 52%, ${canvas.vignette} 100%)` }}
        />
      ) : null}
      <div ref={meEl} className="st-mk" aria-hidden style={{ display: 'none', zIndex: 2 }}>
        <div className="st-me-halo" style={{ left: -22, top: -22, width: 44, height: 44 }} />
        <div style={{ position: 'absolute', left: -11, top: -11 }}>
          <UserDot />
        </div>
      </div>
      {selectedFirst.map((item) =>
        item.type === 'cluster' ? (
          <Marker
            key={item.key}
            nodeRef={register(item.key, item.at)}
            className="st-cl"
            testID={`map.cluster.${item.clusterId}`}
            label={clusterLabel(item.count, item.sports)}
            box={Math.max(48, clusterSize(item.count))}
            anchor="center"
            onPress={() => zoomTo(item.at, item.expansionZoom)}
          >
            <ClusterMarker count={item.count} sports={item.sportCounts} accessibilityLabel={clusterLabel(item.count, item.sports)} />
          </Marker>
        ) : (
          <PointMarker key={item.key} point={item.point} selected={item.point.id === selectedId} nodeRef={register(item.key, item.at)} onPress={onPressPoint} />
        ),
      )}
      {radiusLabel ? (
        <div ref={ringLabelEl} className="st-ring-label" aria-hidden style={{ opacity: 0, zIndex: 5 }}>
          <RingLabel text={radiusLabel} />
        </div>
      ) : null}
    </div>
  );

  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="none"
      onLayout={onLayout}
      style={{ flex: 1, direction: 'ltr', overflow: 'hidden', backgroundColor: offlineCanvas ? canvas.land : LAND_COLOR[scheme] }}
      {...({ dataSet: { engine } } as object)}
    >
      <View ref={containerRef} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} />
      {glHost ? createPortal(overlay, glHost) : overlay}
      {engine === 'static' ? (
        <StaticZoomControls
          top={padding.top + 64}
          zoomInLabel={zoomInLabel}
          zoomOutLabel={zoomOutLabel}
          zoomIn={() => zoomTo(staticCam.center, Math.min(18, staticCam.zoom + 1))}
          zoomOut={() => zoomTo(staticCam.center, Math.max(3, staticCam.zoom - 1))}
        />
      ) : null}
    </View>
  );
}

const easeStandard = (t: number) => {
  // cubic-bezier(0.2, 0, 0, 1) (design §7 "standard"), solved numerically.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    const x = 3 * (1 - m) ** 2 * m * 0.2 + 3 * (1 - m) * m * m * 0 + m ** 3;
    if (x < t) lo = m;
    else hi = m;
  }
  const s = (lo + hi) / 2;
  return 3 * (1 - s) * s * s + s ** 3;
};

function rank(item: ClusterItem, selectedId: string | null | undefined): number {
  if (item.type === 'cluster') return 1;
  if (item.point.id === selectedId) return 3;
  return item.point.kind === 'venue' ? 0 : item.point.state === 'live' ? 2 : 1;
}

function Marker({
  nodeRef,
  className,
  testID,
  label,
  box,
  anchor,
  tipY = 0,
  selected,
  onPress,
  children,
}: {
  nodeRef: (el: HTMLDivElement | null) => void;
  className: string;
  testID: string;
  label: string;
  /** Visual box: a number (square) or [w, h]. */
  box: number | [number, number];
  /** `tip`: bottom-centre anchor at `tipY` (teardrop); `center` otherwise. */
  anchor: 'tip' | 'center';
  tipY?: number;
  selected?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const [w, h] = typeof box === 'number' ? [box, box] : box;
  const ax = w / 2;
  const ay = anchor === 'tip' ? tipY : h / 2;
  // Hit area ≥ 48×48 around the visual (design §3).
  const hw = Math.max(48, w);
  const hh = Math.max(48, anchor === 'tip' ? tipY + 4 : h);
  const hx = -hw / 2;
  const hy = anchor === 'tip' ? -hh + 4 : -hh / 2;
  return (
    <div ref={nodeRef} className={`st-mk ${className}${selected ? ' is-sel' : ''}`} style={{ zIndex: selected ? 4 : 3 }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-pressed={selected === undefined ? undefined : selected}
        data-testid={testID}
        className="st-hit"
        style={{ left: hx, top: hy, width: hw, height: hh }}
        onClick={(e) => {
          e.stopPropagation();
          onPress();
        }}
        onKeyDown={(e: WebKey) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onPress();
          }
        }}
      >
        {/* Visual only: `inert` keeps the design-system marker's own role/label out of focus and AT. */}
        <div className="st-vis" inert style={{ left: -hx - ax, top: -hy - ay, width: w, height: h, ['--st-tip' as string]: `${ay}px` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function PointMarker({
  point,
  selected,
  nodeRef,
  onPress,
}: {
  point: MapPoint;
  selected: boolean;
  nodeRef: (el: HTMLDivElement | null) => void;
  onPress?: (p: MapPoint) => void;
}) {
  if (point.kind === 'venue') {
    const s = selected ? 34 : VENUE_SIZE;
    return (
      <Marker nodeRef={nodeRef} className="st-venue" testID={`map.pin.${point.id}`} label={point.label} box={s} anchor="center" selected={selected} onPress={() => onPress?.(point)}>
        <VenueMarker sport={point.sport} selected={selected} />
      </Marker>
    );
  }
  const state = selected ? 'selected' : point.state === 'selected' ? 'default' : point.state;
  const g = pinGeometry(state);
  return (
    <Marker
      nodeRef={nodeRef}
      className="st-pin"
      testID={`map.pin.${point.id}`}
      label={point.label}
      box={[g.box, g.h]}
      anchor="tip"
      tipY={g.tipY}
      selected={selected}
      onPress={() => onPress?.(point)}
    >
      <MapPinMarker sport={point.sport} state={state} accessibilityLabel={point.label} />
    </Marker>
  );
}

function RingLabel({ text }: { text: string }) {
  const theme = useTheme();
  const family = theme.fontFamily('semibold');
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingStart: 8,
        paddingEnd: 10,
        height: 26,
        borderRadius: 13,
        backgroundColor: theme.colors.primary,
        borderWidth: 2,
        borderColor: theme.scheme === 'dark' ? theme.colors.background : '#FFFFFF',
        boxShadow: '0px 3px 10px rgba(18,19,28,0.22)',
      }}
    >
      <GlyphIcon name="radar" size={13} color={theme.colors.onPrimary} />
      <Text
        style={{
          color: theme.colors.onPrimary,
          fontSize: 12.5,
          lineHeight: 16,
          fontWeight: theme.usesWeightedFamilies ? undefined : '700',
          fontVariant: ['tabular-nums'],
          ...(family ? { fontFamily: family } : null),
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function StaticZoomControls({
  top,
  zoomIn,
  zoomOut,
  zoomInLabel,
  zoomOutLabel,
}: {
  top: number;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomInLabel: string;
  zoomOutLabel: string;
}) {
  const theme = useTheme();
  const btn = {
    width: 44,
    height: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  return (
    <View
      style={{
        position: 'absolute',
        top,
        right: 16,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        ...theme.elevation(2),
      }}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={zoomInLabel} onPress={zoomIn} style={btn}>
        <GlyphIcon name="plus" size={18} color={theme.colors.text} />
      </Pressable>
      <View style={{ height: 1, marginHorizontal: 10, backgroundColor: theme.colors.border }} />
      <Pressable accessibilityRole="button" accessibilityLabel={zoomOutLabel} onPress={zoomOut} style={btn}>
        <View style={{ width: 14, height: 2.5, borderRadius: 2, backgroundColor: theme.colors.text }} />
      </Pressable>
    </View>
  );
}
