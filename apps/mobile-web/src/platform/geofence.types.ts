import type { GameId, IsoDateTime, LatLng } from '@st/domain';

/** A joined game to wake up near (stage 1 of the two-stage check-in). */
export interface GeofenceTarget {
  gameId: GameId;
  location: LatLng;
  startsAt: IsoDateTime;
}

/** Localized local-notification copy, captured while the UI (and i18n) is running. */
export interface GeofenceCopy {
  title: string;
  body: string;
}

export type GeofenceSyncResult = 'started' | 'stopped' | 'disabled' | 'permission_required' | 'unavailable';
