/**
 * Type facade: Metro picks `geofence.native.ts` or `geofence.web.ts` (no-op).
 * Stage-1 wake-up geofencing is feature-flagged (EXPO_PUBLIC_FEATURE_GEOFENCE,
 * default off) and is a convenience only; check-in is verified in the foreground.
 */
import type { GeofenceCopy, GeofenceSyncResult, GeofenceTarget } from './geofence.types';

export type { GeofenceCopy, GeofenceSyncResult, GeofenceTarget } from './geofence.types';
export declare const GEOFENCE_TASK: string;
export declare function isGeofenceEnabled(): boolean;
/** Requests "Always" location. Call only after the prominent background-location disclosure. */
export declare function requestBackgroundLocation(): Promise<boolean>;
/** Watches up to 3 upcoming games (≤ 150 m regions); replaces any previous set. */
export declare function syncGeofences(targets: readonly GeofenceTarget[], copy: GeofenceCopy): Promise<GeofenceSyncResult>;
export declare function stopGeofences(): Promise<void>;
