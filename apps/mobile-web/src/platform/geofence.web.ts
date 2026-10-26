/** Web has no geofencing; check-in uses foreground GPS or the host QR (docs/architecture.md §2). */
import type { GeofenceCopy, GeofenceSyncResult, GeofenceTarget } from './geofence.types';

export type { GeofenceCopy, GeofenceSyncResult, GeofenceTarget } from './geofence.types';

export const GEOFENCE_TASK = 'st-checkin-geofence';

export function isGeofenceEnabled(): boolean {
  return false;
}

export async function requestBackgroundLocation(): Promise<boolean> {
  return false;
}

export async function syncGeofences(_targets: readonly GeofenceTarget[], _copy: GeofenceCopy): Promise<GeofenceSyncResult> {
  return 'disabled';
}

export async function stopGeofences(): Promise<void> {}
