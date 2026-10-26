/**
 * Native map: @maplibre/maplibre-react-native v11. Games are a clustered
 * GeoJSONSource drawn with style layers (GPU, cheap for 2,000+ pins); venues are
 * an unclustered source shown from VENUE_MIN_ZOOM. Sport colors and the "full"
 * hollow state follow PinBadge semantics; the list view is the accessible
 * alternative to the map (design §11).
 */
import { Camera, GeoJSONSource, Layer, Map as MLMap, type CameraRef, type GeoJSONSourceRef } from '@maplibre/maplibre-react-native';
import type { SportId } from '@st/domain';
import { sportColors, useTheme } from '@st/ui';
import { useMemo, useRef } from 'react';
import { View } from 'react-native';

import { circlePolygon, mapStyleFor, usesBlankStyle } from './style';
import { VENUE_MIN_ZOOM, type MapViewProps } from './Map.types';

const SPORT_COLOR_EXPR = [
  'match',
  ['get', 'sport'],
  ...(Object.keys(sportColors) as SportId[]).flatMap((k) => [k, sportColors[k].color]),
  '#888888',
];

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
  accessibilityLabel,
  testID,
}: MapViewProps) {
  const theme = useTheme();
  const camera = useRef<CameraRef>(null);
  const games = useRef<GeoJSONSourceRef>(null);
  const style = useMemo(() => mapStyleFor(scheme), [scheme]);
  const byId = useMemo(() => new globalThis.Map(points.map((p) => [p.id, p])), [points]);

  const gameData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: points
        .filter((p) => p.kind === 'game')
        .map((p) => ({
          type: 'Feature',
          id: p.id,
          properties: { id: p.id, sport: p.sport, full: p.state === 'full', live: p.state === 'live', selected: p.id === selectedId },
          geometry: { type: 'Point', coordinates: [p.location.lng, p.location.lat] },
        })),
    }),
    [points, selectedId],
  );
  const venueData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: points
        .filter((p) => p.kind === 'venue')
        .map((p) => ({
          type: 'Feature',
          id: p.id,
          properties: { id: p.id, sport: p.sport },
          geometry: { type: 'Point', coordinates: [p.location.lng, p.location.lat] },
        })),
    }),
    [points],
  );
  const ring = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: radiusKm
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(center, radiusKm)] } }]
        : [],
    }),
    [center, radiusKm],
  );
  const me = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: userLocation
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [userLocation.lng, userLocation.lat] } }]
        : [],
    }),
    [userLocation],
  );

  return (
    <View style={{ flex: 1 }} testID={testID} accessibilityLabel={accessibilityLabel}>
      <MLMap
        style={{ flex: 1 }}
        mapStyle={style}
        attribution={!usesBlankStyle()}
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
        onRegionDidChange={(e) => {
          if (!e.nativeEvent.userInteraction) return;
          const [lng, lat] = e.nativeEvent.center;
          onRegionChange?.({ center: { lat, lng }, zoom: e.nativeEvent.zoom });
        }}
      >
        <Camera ref={camera} center={[center.lng, center.lat]} zoom={zoom} duration={theme.reducedMotion ? 0 : 400} easing="ease" />

        <GeoJSONSource id="radius" data={ring}>
          <Layer type="fill" id="radius-fill" paint={{ 'fill-color': theme.colors.primary, 'fill-opacity': 0.06 }} />
          <Layer type="line" id="radius-line" paint={{ 'line-color': theme.colors.primary, 'line-width': 2 }} />
        </GeoJSONSource>

        <GeoJSONSource
          id="venues"
          data={venueData}
          onPress={(e) => {
            const id = e.nativeEvent.features[0]?.properties?.id;
            const p = typeof id === 'string' ? byId.get(id) : undefined;
            if (p) onPressPoint?.(p);
          }}
        >
          <Layer
            type="circle"
            id="venue-pins"
            minzoom={VENUE_MIN_ZOOM}
            paint={{
              'circle-radius': 8,
              'circle-color': theme.colors.surface,
              'circle-stroke-width': 3,
              'circle-stroke-color': SPORT_COLOR_EXPR as never,
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource
          id="games"
          ref={games}
          data={gameData}
          cluster
          clusterRadius={56}
          clusterMaxZoom={15}
          onPress={async (e) => {
            const f = e.nativeEvent.features[0];
            if (!f) return;
            const props = (f.properties ?? {}) as { cluster?: boolean; cluster_id?: number; id?: string };
            if (props.cluster && typeof props.cluster_id === 'number' && f.geometry.type === 'Point') {
              const z = (await games.current?.getClusterExpansionZoom(props.cluster_id)) ?? zoom + 2;
              const [lng, lat] = f.geometry.coordinates as [number, number];
              camera.current?.easeTo({ center: [lng, lat], zoom: z, duration: theme.reducedMotion ? 0 : 400 });
              return;
            }
            const p = props.id ? byId.get(props.id) : undefined;
            if (p) onPressPoint?.(p);
          }}
        >
          <Layer
            type="circle"
            id="game-clusters"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': theme.colors.surfaceInverse,
              'circle-radius': ['step', ['get', 'point_count'], 18, 10, 22, 100, 26],
              'circle-stroke-width': 2,
              'circle-stroke-color': theme.colors.pinRing,
            }}
          />
          <Layer
            type="symbol"
            id="game-cluster-count"
            filter={['has', 'point_count']}
            layout={{ 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 14, 'text-allow-overlap': true }}
            paint={{ 'text-color': theme.colors.textInverse }}
          />
          <Layer
            type="circle"
            id="game-selected-ring"
            filter={['all', ['!', ['has', 'point_count']], ['==', ['get', 'selected'], true]]}
            paint={{ 'circle-radius': 26, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3, 'circle-stroke-color': theme.colors.primary }}
          />
          <Layer
            type="circle"
            id="game-pins"
            filter={['!', ['has', 'point_count']]}
            paint={{
              'circle-radius': 18,
              'circle-color': ['case', ['==', ['get', 'full'], true], theme.colors.surface, SPORT_COLOR_EXPR] as never,
              'circle-stroke-width': ['case', ['==', ['get', 'full'], true], 3, 2],
              'circle-stroke-color': [
                'case',
                ['==', ['get', 'full'], true],
                SPORT_COLOR_EXPR,
                ['==', ['get', 'live'], true],
                theme.colors.accent,
                theme.colors.pinRing,
              ] as never,
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="me" data={me}>
          <Layer
            type="circle"
            id="me-dot"
            paint={{ 'circle-radius': 8, 'circle-color': theme.colors.info, 'circle-stroke-width': 3, 'circle-stroke-color': theme.colors.pinRing }}
          />
        </GeoJSONSource>
      </MLMap>
    </View>
  );
}
