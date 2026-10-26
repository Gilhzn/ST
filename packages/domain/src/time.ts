import type { EpochMs, IsoDateTime } from './types';

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Parses an ISO-8601 timestamp to epoch ms. Throws `RangeError` on an invalid
 * value so a bad timestamp can never silently compare as `NaN` (which would
 * make every window check false).
 */
export function toEpochMs(iso: IsoDateTime): EpochMs {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid ISO timestamp: ${iso}`);
  return ms;
}

/** Formats epoch ms as an ISO-8601 UTC timestamp (`toISOString()` format). */
export function toIso(ms: EpochMs): IsoDateTime {
  return new Date(ms).toISOString();
}

/** `iso + deltaMs`, as ISO. */
export function addMs(iso: IsoDateTime, deltaMs: number): IsoDateTime {
  return toIso(toEpochMs(iso) + deltaMs);
}
