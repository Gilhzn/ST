import type { LatLng } from '@st/domain';

/**
 * Quick city search for when location is off (design §13.3 "Location denied:
 * city search"). Names are proper nouns (data, not UI copy); a geocoder
 * replaces this list when the search service ships.
 */
export const SEED_CITIES: readonly { id: string; name: string; center: LatLng }[] = [
  { id: 'tlv', name: 'Tel Aviv', center: { lat: 32.0779, lng: 34.7745 } },
  { id: 'lon', name: 'London', center: { lat: 51.5074, lng: -0.1278 } },
  { id: 'mad', name: 'Madrid', center: { lat: 40.4168, lng: -3.7038 } },
  { id: 'sao', name: 'São Paulo', center: { lat: -23.5617, lng: -46.6559 } },
  { id: 'tyo', name: 'Tokyo', center: { lat: 35.6762, lng: 139.6503 } },
  { id: 'nyc', name: 'New York', center: { lat: 40.758, lng: -73.9855 } },
  { id: 'bom', name: 'Mumbai', center: { lat: 19.076, lng: 72.8777 } },
  { id: 'par', name: 'Paris', center: { lat: 48.8566, lng: 2.3522 } },
];

/** Map centre before a location fix: Dizengoff Square, Tel Aviv (seed city; also the e2e geolocation). */
export const DEFAULT_MAP_CENTER: LatLng = { lat: 32.0779, lng: 34.7745 };
