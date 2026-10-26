/**
 * Spherical geometry helpers on WGS-84 coordinates. Distances use the
 * haversine formula on a sphere of the IUGG mean Earth radius; PostGIS
 * `geography` uses the spheroid, so results can differ by up to ~0.5 %. Trust
 * rules that need TS ≡ SQL parity must not sit on a distance boundary.
 */
import type { EpochMs, LatLng } from '../types';

/** IUGG mean Earth radius in metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

const DEG = Math.PI / 180;

/** Axis-aligned bounding box in degrees. When `west > east` the box crosses the antimeridian. */
export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** True when `p` is a finite coordinate with |lat| ≤ 90 and |lng| ≤ 180. */
export function isValidLatLng(p: LatLng): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** Wraps a longitude into `[-180, 180)`. */
export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Great-circle distance in metres (haversine). Symmetric, ≥ 0, 0 iff same point. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** True when `point` is within `radiusM` metres of `center` (inclusive). */
export function isWithinRadius(center: LatLng, point: LatLng, radiusM: number): boolean {
  return haversineMeters(center, point) <= radiusM;
}

/**
 * Smallest lat/lng box containing the circle of `radiusKm` around `center`
 * (a cheap pre-filter before an exact distance check). Near a pole the box
 * spans every longitude; across the antimeridian `west > east`.
 */
export function bboxAround(center: LatLng, radiusKm: number): BBox {
  if (!(radiusKm >= 0)) throw new RangeError('radiusKm must be ≥ 0');
  const angular = (radiusKm * 1000) / EARTH_RADIUS_M; // radians
  const latR = center.lat * DEG;
  let south = (latR - angular) / DEG;
  let north = (latR + angular) / DEG;
  if (north >= 90 || south <= -90) {
    south = Math.max(south, -90);
    north = Math.min(north, 90);
    return { south, west: -180, north, east: 180 };
  }
  const dLng = Math.asin(Math.min(1, Math.sin(angular) / Math.cos(latR))) / DEG;
  if (dLng >= 180) return { south, west: -180, north, east: 180 };
  return { south, west: normalizeLng(center.lng - dLng), north, east: normalizeLng(center.lng + dLng) };
}

/** True when `p` lies inside `box` (handles antimeridian-crossing boxes). */
export function bboxContains(box: BBox, p: LatLng): boolean {
  if (p.lat < box.south || p.lat > box.north) return false;
  if (box.west <= box.east) return p.lng >= box.west && p.lng <= box.east;
  return p.lng >= box.west || p.lng <= box.east;
}

/**
 * Moves `p` by `northM` metres north and `eastM` metres east (local tangent
 * plane approximation, accurate to < 0.1 % for offsets below ~10 km).
 */
export function offsetMeters(p: LatLng, northM: number, eastM: number): LatLng {
  const lat = p.lat + northM / EARTH_RADIUS_M / DEG;
  const lng = p.lng + eastM / (EARTH_RADIUS_M * Math.cos(p.lat * DEG)) / DEG;
  return { lat, lng: normalizeLng(lng) };
}

/** A timestamped position (e.g. a `GpsSample`). */
export interface TimedPoint extends LatLng {
  timestamp: EpochMs;
}

/**
 * Average speed between two timed points in km/h, independent of direction.
 * Equal timestamps give `0` for the same place and `Infinity` otherwise.
 * `slackM` (e.g. the sum of both accuracy radii) is subtracted from the
 * distance first so that GPS jitter alone cannot look like movement.
 */
export function speedKmh(a: TimedPoint, b: TimedPoint, slackM = 0): number {
  const d = Math.max(0, haversineMeters(a, b) - slackM);
  const dtMs = Math.abs(b.timestamp - a.timestamp);
  if (dtMs === 0) return d === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (d / 1000) / (dtMs / 3_600_000);
}

/** Largest distance between any two points in metres (0 for fewer than two points). */
export function maxPairwiseDistanceMeters(points: readonly LatLng[]): number {
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = haversineMeters(points[i] as LatLng, points[j] as LatLng);
      if (d > max) max = d;
    }
  }
  return max;
}

/**
 * Spherical centroid (mean of unit vectors), robust across the antimeridian.
 * Returns `null` for an empty list.
 */
export function centroid(points: readonly LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const lat = p.lat * DEG;
    const lng = p.lng * DEG;
    x += Math.cos(lat) * Math.cos(lng);
    y += Math.cos(lat) * Math.sin(lng);
    z += Math.sin(lat);
  }
  const hyp = Math.sqrt(x * x + y * y);
  return { lat: Math.atan2(z, hyp) / DEG, lng: normalizeLng(Math.atan2(y, x) / DEG) };
}

/**
 * Snaps a point to a grid of roughly `cellM` metres (default 500 m) to produce
 * the public `Game.approxLocation` for games with a hidden exact location.
 * Deterministic, so everyone sees the same approximate pin.
 */
export function approximateLocation(p: LatLng, cellM = 500): LatLng {
  const latStep = cellM / EARTH_RADIUS_M / DEG;
  const lat = Math.round(p.lat / latStep) * latStep;
  const cos = Math.max(Math.cos(lat * DEG), 1e-6);
  const lngStep = Math.min(360, latStep / cos);
  const lng = Math.round(p.lng / lngStep) * lngStep;
  return { lat: Math.max(-90, Math.min(90, lat)), lng: normalizeLng(lng) };
}
