/**
 * Native foreground location (expo-location). Only when-in-use is requested
 * here; background ("Always") is only for the feature-flagged geofence wake-up.
 * Always show the prominent disclosure (`LocationDisclosure`) before
 * `requestLocationPermission()` (compliance §5, Play User Data policy).
 */
import type { GpsSample } from '@st/domain';
import * as Location from 'expo-location';

import type { LocationPermission, PositionFix, SampleOptions } from './location.types';

export type { LocationPermission, PositionFix, SampleOptions } from './location.types';

function toPermission(res: Location.LocationPermissionResponse): LocationPermission {
  if (res.status === Location.PermissionStatus.GRANTED) return 'granted';
  if (res.status === Location.PermissionStatus.UNDETERMINED || res.canAskAgain) return 'undetermined';
  return 'denied';
}

export async function getLocationPermission(): Promise<LocationPermission> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) return 'unavailable';
    return toPermission(await Location.getForegroundPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

/** Triggers the OS dialog. Call only after the in-app disclosure was accepted. */
export async function requestLocationPermission(): Promise<LocationPermission> {
  try {
    const res = await Location.requestForegroundPermissionsAsync();
    return res.status === Location.PermissionStatus.GRANTED ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function getCurrentPosition(options: { highAccuracy?: boolean } = {}): Promise<PositionFix | null> {
  try {
    const fix = await Location.getCurrentPositionAsync({
      accuracy: options.highAccuracy ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
    });
    return {
      location: { lat: fix.coords.latitude, lng: fix.coords.longitude },
      accuracyM: fix.coords.accuracy ?? 9999,
      timestamp: fix.timestamp,
      isMock: fix.mocked,
    };
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Collects spaced, precise GPS samples for stage-2 check-in (verified server side). */
export async function collectGpsSamples({ count = 3, spacingMs = 5500, onSample, signal }: SampleOptions = {}): Promise<GpsSample[]> {
  const out: GpsSample[] = [];
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) break;
    if (i > 0) await wait(spacingMs);
    const fix = await getCurrentPosition({ highAccuracy: true });
    if (!fix) break;
    const sample: GpsSample = { lat: fix.location.lat, lng: fix.location.lng, accuracyM: fix.accuracyM, timestamp: fix.timestamp, isMock: fix.isMock };
    out.push(sample);
    onSample?.(sample, i);
  }
  return out;
}
