/**
 * Native wake-up geofence (expo-location + expo-task-manager).
 *
 * - `TaskManager.defineTask` runs at module top level, as the OS may start the
 *   JS runtime in the background just to deliver a region event.
 * - On "enter" we post a local notification ("You're near — tap to check in")
 *   that deep-links to the check-in screen. Nothing is sent to the server and no
 *   sanction ever depends on this (docs/architecture.md §5.2).
 * - Off by default (EXPO_PUBLIC_FEATURE_GEOFENCE); the MVP Android manifest has
 *   no ACCESS_BACKGROUND_LOCATION (compliance GPL-01).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_TRUST_CONFIG } from '@st/domain';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import type { GeofenceCopy, GeofenceSyncResult, GeofenceTarget } from './geofence.types';

export type { GeofenceCopy, GeofenceSyncResult, GeofenceTarget } from './geofence.types';

export const GEOFENCE_TASK = 'st-checkin-geofence';
const COPY_KEY = 'st.geofence.copy';
const MAX_REGIONS = 3;
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const FALLBACK_COPY: GeofenceCopy = { title: 'Sport Talent', body: 'You’re near — tap to check in' };

export function isGeofenceEnabled(): boolean {
  return process.env.EXPO_PUBLIC_FEATURE_GEOFENCE === 'true';
}

interface GeofenceEvent {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
}

TaskManager.defineTask<GeofenceEvent>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data || data.eventType !== Location.GeofencingEventType.Enter) return;
  const gameId = data.region.identifier;
  if (!gameId) return;
  let copy = FALLBACK_COPY;
  try {
    const raw = await AsyncStorage.getItem(COPY_KEY);
    if (raw) copy = { ...FALLBACK_COPY, ...(JSON.parse(raw) as Partial<GeofenceCopy>) };
  } catch {
    // keep fallback copy
  }
  await Notifications.scheduleNotificationAsync({
    content: { title: copy.title, body: copy.body, data: { url: `/game/${gameId}/checkin` } },
    trigger: null,
  });
});

export async function requestBackgroundLocation(): Promise<boolean> {
  if (!isGeofenceEnabled()) return false;
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== Location.PermissionStatus.GRANTED) return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === Location.PermissionStatus.GRANTED;
}

export async function syncGeofences(targets: readonly GeofenceTarget[], copy: GeofenceCopy): Promise<GeofenceSyncResult> {
  if (!isGeofenceEnabled()) return 'disabled';
  try {
    if (!(await TaskManager.isAvailableAsync())) return 'unavailable';
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== Location.PermissionStatus.GRANTED) return 'permission_required';
    const now = Date.now();
    const regions: Location.LocationRegion[] = targets
      .filter((t) => {
        const start = Date.parse(t.startsAt);
        return start > now - 60 * 60 * 1000 && start < now + LOOKAHEAD_MS;
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, MAX_REGIONS)
      .map((t) => ({
        identifier: t.gameId,
        latitude: t.location.lat,
        longitude: t.location.lng,
        radius: DEFAULT_TRUST_CONFIG.wakeGeofenceRadiusM,
        notifyOnEnter: true,
        notifyOnExit: false,
      }));
    if (!regions.length) {
      await stopGeofences();
      return 'stopped';
    }
    await AsyncStorage.setItem(COPY_KEY, JSON.stringify(copy));
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    return 'started';
  } catch {
    return 'unavailable';
  }
}

export async function stopGeofences(): Promise<void> {
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } catch {
    // not started / not available
  }
}
