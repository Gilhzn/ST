/**
 * Client-side clustering shared by web and native (supercluster, ADR 0002).
 * Only games are clustered; venues are returned unclustered at high zoom.
 */
import Supercluster, { type ClusterProperties as SCClusterProperties } from 'supercluster';
import type { LatLng, SportId } from '@st/domain';

import { VENUE_MIN_ZOOM, type MapPoint } from './Map.types';

export type ClusterItem =
  | { type: 'point'; key: string; point: MapPoint; at: LatLng }
  | { type: 'cluster'; key: string; clusterId: number; count: number; sports: SportId[]; at: LatLng; expansionZoom: number };

interface PointProps {
  index: number;
}
interface ClusterProps {
  sports: SportId[];
}

export interface ClusterIndex {
  query(bbox: [west: number, south: number, east: number, north: number], zoom: number): ClusterItem[];
}

export function buildClusterIndex(points: readonly MapPoint[]): ClusterIndex {
  const games = points.filter((p) => p.kind === 'game');
  const venues = points.filter((p) => p.kind === 'venue');
  const index = new Supercluster<PointProps, ClusterProps>({
    radius: 46,
    maxZoom: 16,
    map: (props) => ({ sports: [games[props.index]?.sport].filter((s): s is SportId => !!s) }),
    reduce: (acc, props) => {
      for (const s of props.sports) if (!acc.sports.includes(s) && acc.sports.length < 3) acc.sports.push(s);
    },
  });
  index.load(
    games.map((p, i) => ({
      type: 'Feature' as const,
      properties: { index: i },
      geometry: { type: 'Point' as const, coordinates: [p.location.lng, p.location.lat] },
    })),
  );

  return {
    query(bbox, zoom) {
      const z = Math.round(zoom);
      const out: ClusterItem[] = [];
      for (const f of index.getClusters(bbox, z)) {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        const props = f.properties as Partial<SCClusterProperties> & Partial<ClusterProps> & Partial<PointProps>;
        if (props.cluster && typeof props.cluster_id === 'number') {
          out.push({
            type: 'cluster',
            key: `c-${props.cluster_id}`,
            clusterId: props.cluster_id,
            count: props.point_count ?? 0,
            sports: props.sports ?? [],
            at: { lat, lng },
            expansionZoom: Math.min(18, index.getClusterExpansionZoom(props.cluster_id)),
          });
        } else if (typeof props.index === 'number') {
          const point = games[props.index];
          if (point) out.push({ type: 'point', key: point.id, point, at: point.location });
        }
      }
      if (zoom >= VENUE_MIN_ZOOM) {
        const [w, s, e, n] = bbox;
        for (const v of venues) {
          const { lat, lng } = v.location;
          if (lat >= s && lat <= n && lng >= w && lng <= e) out.unshift({ type: 'point', key: v.id, point: v, at: v.location });
        }
      }
      return out;
    },
  };
}
