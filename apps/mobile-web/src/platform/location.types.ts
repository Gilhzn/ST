import type { GpsSample, LatLng } from '@st/domain';

/**
 * - `granted`: foreground (when-in-use) location allowed.
 * - `undetermined`: never asked; show the prominent disclosure before the OS prompt.
 * - `denied`: refused (the map falls back to city search; check-in to QR/peer/host).
 * - `unavailable`: no location services on this device/browser.
 */
export type LocationPermission = 'granted' | 'undetermined' | 'denied' | 'unavailable';

export interface PositionFix {
  location: LatLng;
  accuracyM: number;
  timestamp: number;
  isMock?: boolean;
}

export interface SampleOptions {
  /** Samples to take (domain default: 3, minimum 2). */
  count?: number;
  /** Minimum spacing between samples (domain: ≥ 5 s). */
  spacingMs?: number;
  onSample?: (sample: GpsSample, index: number) => void;
  signal?: { aborted: boolean };
}
