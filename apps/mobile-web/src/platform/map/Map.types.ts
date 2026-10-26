/**
 * Shared contract of the platform map (`Map.web.tsx` uses maplibre-gl, `Map.native.tsx`
 * uses @maplibre/maplibre-react-native). Maps never mirror in RTL (design §9.2).
 */
import type { LatLng, SportId } from '@st/domain';

export type MapPinState = 'default' | 'selected' | 'full' | 'live';

/** One marker. Games are clustered; venues show only when zoomed in (design §13.3). */
export interface MapPoint {
  id: string;
  kind: 'game' | 'venue';
  sport: SportId;
  location: LatLng;
  state: MapPinState;
  /** Localized spoken label, e.g. "Football game, 6 of 10 players, today 18:00". */
  label: string;
}

export interface MapRegion {
  center: LatLng;
  zoom: number;
}

/** Screen space covered by floating UI (search bar, sheet). The camera centres in what's left. */
export interface MapPadding {
  top: number;
  bottom: number;
}

export interface MapViewProps {
  points: readonly MapPoint[];
  /**
   * Controlled camera target. The camera moves when `center`/`zoom` change or when
   * `cameraKey` changes (re-centre on the same spot after the user panned away).
   */
  center: LatLng;
  zoom: number;
  cameraKey?: number;
  padding?: MapPadding;
  /** Draws the search radius ring (km) around `center`. */
  radiusKm?: number | null;
  /** Localized ring label, e.g. "5 km". */
  radiusLabel?: string;
  /** User location dot. */
  userLocation?: LatLng | null;
  selectedId?: string | null;
  scheme: 'light' | 'dark';
  onPressPoint?: (point: MapPoint) => void;
  /** Tap on empty map (clears the selection). */
  onPressMap?: () => void;
  /** Fires after the user pans/zooms (not for programmatic camera moves). */
  onRegionChange?: (region: MapRegion) => void;
  /** Localized label for a cluster ("12 games: football, tennis. Double-tap to zoom in."). */
  clusterLabel: (count: number, sports: readonly SportId[]) => string;
  /** Accessible name of the map region. */
  accessibilityLabel: string;
  /** Localized labels for the zoom buttons (shown when the map has no gesture zoom). */
  zoomInLabel: string;
  zoomOutLabel: string;
  testID?: string;
}

/** Venue pins appear from this zoom level (design §13.3). */
export const VENUE_MIN_ZOOM = 14;

/** Camera zoom that roughly fits a search radius on a phone-sized viewport. */
export function zoomForRadius(radiusKm: number): number {
  return Math.max(3, Math.min(16, 13.15 - Math.log2(Math.max(0.5, radiusKm))));
}

/** Camera move duration: long hops fly, short ones ease (design §7, reduced motion = instant). */
export function cameraDurationMs(distanceKm: number, zoomDelta: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  if (distanceKm > 50) return 1400;
  return Math.min(900, 450 + Math.abs(zoomDelta) * 120 + Math.min(distanceKm, 20) * 15);
}
