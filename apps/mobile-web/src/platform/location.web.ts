/**
 * Web location via the browser Geolocation API. The browser prompt is shown by
 * the first `getCurrentPosition`, so `requestLocationPermission` is that call;
 * show the in-app disclosure first (compliance §5.3).
 */
import type { GpsSample } from '@st/domain';

import type { LocationPermission, PositionFix, SampleOptions } from './location.types';

export type { LocationPermission, PositionFix, SampleOptions } from './location.types';

function geo(): Geolocation | null {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : null;
}

export async function getLocationPermission(): Promise<LocationPermission> {
  if (!geo()) return 'unavailable';
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (!status) return 'undetermined';
    return status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

function read(highAccuracy: boolean): Promise<PositionFix | null> {
  const g = geo();
  if (!g) return Promise.resolve(null);
  return new Promise((resolve) => {
    g.getCurrentPosition(
      (p) =>
        resolve({
          location: { lat: p.coords.latitude, lng: p.coords.longitude },
          accuracyM: p.coords.accuracy,
          timestamp: p.timestamp,
        }),
      () => resolve(null),
      { enableHighAccuracy: highAccuracy, timeout: 15_000, maximumAge: highAccuracy ? 0 : 60_000 },
    );
  });
}

export async function requestLocationPermission(): Promise<LocationPermission> {
  if (!geo()) return 'unavailable';
  const fix = await read(false);
  return fix ? 'granted' : 'denied';
}

export function getCurrentPosition(options: { highAccuracy?: boolean } = {}): Promise<PositionFix | null> {
  return read(options.highAccuracy ?? false);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function collectGpsSamples({ count = 3, spacingMs = 5500, onSample, signal }: SampleOptions = {}): Promise<GpsSample[]> {
  const out: GpsSample[] = [];
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) break;
    if (i > 0) await wait(spacingMs);
    const fix = await read(true);
    if (!fix) break;
    const sample: GpsSample = { lat: fix.location.lat, lng: fix.location.lng, accuracyM: fix.accuracyM, timestamp: fix.timestamp };
    out.push(sample);
    onSample?.(sample, i);
  }
  return out;
}
