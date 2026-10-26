/**
 * Native map: @maplibre/maplibre-react-native v11.
 *
 * - Basemap: `useBasemap` (OpenFreeMap positron, localized labels, dark re-tint; offline canvas
 *   with `EXPO_PUBLIC_MAP_OFFLINE=1`).
 * - Radius ring: GeoJSON fill + line layers (GPU). Its label is a `Marker` view, so no glyphs
 *   are ever needed.
 * - Pins: games are clustered on the JS side with the same supercluster index as web
 *   (`cluster.ts`); only clusters/pins inside the padded viewport are mounted as `Marker`
 *   views (tens, not thousands, even with 2,000+ games), drawn by the same marker components
 *   as web (`markers.tsx`). Selection scales the pin about its tip; live pins pulse
 *   (static ring with reduced motion).
 * The list view is the accessible alternative to the map (design §11).
 */
import { Camera, GeoJSONSource, Layer, Map as MLMap, Marker, type CameraRef, type LngLatBounds } from '@maplibre/maplibre-react-native';
import type { LatLng } from '@st/domain';
import { useTheme } from '@st/ui';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';

import { buildClusterIndex, type ClusterItem } from './cluster';
import { cameraDurationMs, type MapPoint, type MapViewProps } from './Map.types';
import { ClusterMarker, clusterSize, GlyphIcon, MapPinMarker, PIN_H, PIN_TIP_Y, PIN_W, SELECTED_SCALE, UserDot, VenueMarker } from './markers';
import { circlePolygon, distanceKm, usesOfflineStyle } from './style';
import { useBasemap } from './useBasemap';

function padBbox([w, s, e, n]: LngLatBounds): [number, number, number, number] {
  const dx = (e - w) / 2;
  const dy = (n - s) / 2;
  return [Math.max(-180, w - dx), Math.max(-85, s - dy), Math.min(180, e + dx), Math.min(85, n + dy)];
}

function initialBounds(center: LatLng, zoom: number): LngLatBounds {
  const span = 360 / 2 ** zoom;
  return [center.lng - span, center.lat - span / 2, center.lng + span, center.lat + span / 2];
}

export function Map({
  points,
  center,
  zoom,
  cameraKey = 0,
  padding,
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
  testID,
}: MapViewProps) {
  const theme = useTheme();
  const basemap = useBasemap(scheme, theme.locale);
  const camera = useRef<CameraRef>(null);
  const [view, setView] = useState<{ bounds: LngLatBounds; zoom: number }>(() => ({ bounds: initialBounds(center, zoom), zoom }));
  const index = useMemo(() => buildClusterIndex(points), [points]);
  const items = useMemo(() => index.query(padBbox(view.bounds), view.zoom), [index, view]);
  const pad = useMemo(() => ({ top: padding?.top ?? 0, bottom: padding?.bottom ?? 0, left: 0, right: 0 }), [padding?.top, padding?.bottom]);

  // Controlled camera: only moves when the requested target changes.
  const lastCamera = useRef<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const key = `${center.lat},${center.lng},${zoom},${cameraKey},${pad.top},${pad.bottom}`;
    if (lastCamera.current === null) {
      lastCamera.current = key;
      return; // initialViewState handles the first frame
    }
    if (lastCamera.current === key) return;
    lastCamera.current = key;
    const [w, s, e, n] = viewRef.current.bounds;
    const dist = distanceKm({ lat: (s + n) / 2, lng: (w + e) / 2 }, center);
    const duration = cameraDurationMs(dist, zoom - viewRef.current.zoom, theme.reducedMotion);
    const stop = { center: [center.lng, center.lat] as [number, number], zoom, padding: pad, duration };
    if (dist > 30 && duration > 0) camera.current?.flyTo(stop);
    else camera.current?.easeTo(stop);
  }, [center.lat, center.lng, zoom, cameraKey, pad, theme.reducedMotion]);

  const ring = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: radiusKm ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(center, radiusKm)] } }] : [],
    }),
    [center, radiusKm],
  );

  const zoomTo = (at: LatLng, z: number) =>
    camera.current?.easeTo({ center: [at.lng, at.lat], zoom: z, duration: theme.reducedMotion ? 0 : 520 });

  const lastIntZoom = useRef(Math.round(zoom));

  return (
    <View style={{ flex: 1 }} testID={testID} accessibilityLabel={accessibilityLabel}>
      <MLMap
        style={{ flex: 1 }}
        mapStyle={basemap.style}
        attribution={!usesOfflineStyle()}
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
        onPress={() => onPressMap?.()}
        onRegionIsChanging={(e) => {
          const z = Math.round(e.nativeEvent.zoom);
          if (z !== lastIntZoom.current) {
            lastIntZoom.current = z;
            setView({ bounds: e.nativeEvent.bounds, zoom: e.nativeEvent.zoom });
          }
        }}
        onRegionDidChange={(e) => {
          setView({ bounds: e.nativeEvent.bounds, zoom: e.nativeEvent.zoom });
          if (!e.nativeEvent.userInteraction) return;
          const [lng, lat] = e.nativeEvent.center;
          onRegionChange?.({ center: { lat, lng }, zoom: e.nativeEvent.zoom });
        }}
      >
        <Camera ref={camera} initialViewState={{ center: [center.lng, center.lat], zoom, padding: pad }} />

        <GeoJSONSource id="radius" data={ring}>
          <Layer type="fill" id="radius-fill" paint={{ 'fill-color': theme.colors.primary, 'fill-opacity': scheme === 'dark' ? 0.08 : 0.06 }} />
          <Layer type="line" id="radius-glow" paint={{ 'line-color': theme.colors.primary, 'line-width': 8, 'line-opacity': 0.14, 'line-blur': 4 }} />
          <Layer type="line" id="radius-line" paint={{ 'line-color': theme.colors.primary, 'line-width': 2 }} />
        </GeoJSONSource>

        {radiusKm && radiusLabel ? (
          <Marker id="radius-label" lngLat={[center.lng, center.lat + radiusKm / 110.574]} anchor="center">
            <RingLabel text={radiusLabel} />
          </Marker>
        ) : null}

        {userLocation ? (
          <Marker id="me" lngLat={[userLocation.lng, userLocation.lat]} anchor="center">
            <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Pulse size={44} color={scheme === 'dark' ? 'rgba(79,157,255,0.35)' : 'rgba(26,115,232,0.25)'} />
              <UserDot />
            </View>
          </Marker>
        ) : null}

        {items.map((item) => renderItem(item, selectedId, onPressPoint, zoomTo, clusterLabel))}
      </MLMap>
    </View>
  );
}

function renderItem(
  item: ClusterItem,
  selectedId: string | null | undefined,
  onPressPoint: MapViewProps['onPressPoint'],
  zoomTo: (at: LatLng, z: number) => void,
  clusterLabel: MapViewProps['clusterLabel'],
): ReactElement {
  if (item.type === 'cluster') {
    return (
      <Marker key={item.key} id={item.key} lngLat={[item.at.lng, item.at.lat]} anchor="center">
        <Pressable
          testID={`map.cluster.${item.clusterId}`}
          accessibilityRole="button"
          accessibilityLabel={clusterLabel(item.count, item.sports)}
          onPress={() => zoomTo(item.at, item.expansionZoom)}
          hitSlop={Math.max(0, (48 - clusterSize(item.count)) / 2)}
        >
          <ClusterMarker count={item.count} sports={item.sports} />
        </Pressable>
      </Marker>
    );
  }
  return <PointMarker key={item.key} point={item.point} selected={item.point.id === selectedId} onPress={onPressPoint} />;
}

function PointMarker({ point, selected, onPress }: { point: MapPoint; selected: boolean; onPress?: (p: MapPoint) => void }) {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(selected ? SELECTED_SCALE : 1)).current;
  useEffect(() => {
    const to = selected ? SELECTED_SCALE : 1;
    if (theme.reducedMotion) scale.setValue(to);
    else Animated.spring(scale, { toValue: to, damping: 14, stiffness: 260, mass: 0.8, useNativeDriver: true }).start();
  }, [selected, theme.reducedMotion]);

  if (point.kind === 'venue') {
    return (
      <Marker id={point.id} lngLat={[point.location.lng, point.location.lat]} anchor="center">
        <Pressable testID={`map.pin.${point.id}`} accessibilityRole="button" accessibilityLabel={point.label} onPress={() => onPress?.(point)} hitSlop={12}>
          <VenueMarker sport={point.sport} selected={selected} />
        </Pressable>
      </Marker>
    );
  }
  const live = point.state === 'live';
  // Scale about the tip: translate the pivot to the tip, scale, translate back.
  const pivot = PIN_H / 2 - PIN_TIP_Y;
  const box = PIN_H * SELECTED_SCALE;
  return (
    <Marker id={point.id} lngLat={[point.location.lng, point.location.lat]} anchor="bottom" offset={[0, PIN_H - PIN_TIP_Y]}>
      <Pressable
        testID={`map.pin.${point.id}`}
        accessibilityRole="button"
        accessibilityLabel={point.label}
        accessibilityState={{ selected }}
        onPress={() => onPress?.(point)}
        style={{ width: PIN_W * SELECTED_SCALE, height: box, alignItems: 'center', justifyContent: 'flex-end' }}
      >
        <View style={{ width: PIN_W, height: PIN_H }}>
          {live ? (
            <View style={{ position: 'absolute', left: PIN_W / 2 - 20, top: 17 - 20 }}>
              <Pulse size={40} color={theme.colors.accent} />
            </View>
          ) : null}
          <Animated.View style={{ transform: [{ translateY: -pivot }, { scale }, { translateY: pivot }] }}>
            <MapPinMarker sport={point.sport} state={selected ? 'selected' : point.state === 'selected' ? 'default' : point.state} />
          </Animated.View>
        </View>
      </Pressable>
    </Marker>
  );
}

function Pulse({ size, color }: { size: number; color: string }) {
  const theme = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (theme.reducedMotion) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 2000, easing: Easing.out(Easing.cubic), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [theme.reducedMotion]);
  const style = theme.reducedMotion
    ? { opacity: 0.35, transform: [{ scale: 1.15 }] }
    : { opacity: t.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.7, 0, 0] }), transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.9] }) }] };
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
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
      }}
    >
      <GlyphIcon name="radar" size={13} color={theme.colors.onPrimary} />
      <Text style={{ color: theme.colors.onPrimary, fontSize: 12.5, fontWeight: theme.usesWeightedFamilies ? undefined : '700', ...(family ? { fontFamily: family } : null) }}>
        {text}
      </Text>
    </View>
  );
}
