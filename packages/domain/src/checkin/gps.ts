/**
 * Stage-2 GPS check-in verification (foreground, precise, server side).
 *
 * Order of checks (first failure wins, so the reason is deterministic):
 * 1. `outside_window`: `now` outside `startsAt − 30 min … endsAt`.
 * 2. `suspected_spoofing`: any {@link SpoofSignal}. Signals only route the user
 *    to QR / peer / host fallbacks; they never produce a sanction.
 * 3. `insufficient_samples`: fewer than `gpsMinSamples` samples.
 * 4. `low_accuracy`: fewer than `gpsMinSamples` samples with `accuracyM ≤ gpsMaxAccuracyM`.
 * 5. `samples_too_close`: no chain of `gpsMinSamples` accurate samples spaced ≥ `gpsMinSampleSpacingSeconds`.
 * 6. `insufficient_samples`: no such chain also fitting inside `gpsSampleWindowSeconds`.
 * 7. `too_far`: a chosen sample is farther than `gpsBaseRadiusM + accuracyM` from the venue.
 * 8. `spread_too_large`: chosen samples spread ≥ `gpsMaxSpreadM`.
 */
import {
  DEFAULT_TRUST_CONFIG,
  type CheckInMethod,
  type CheckInRejectReason,
  type CheckInVerdict,
  type EpochMs,
  type GpsSample,
  type LatLng,
  type SpoofSignal,
  type TrustConfig,
} from '../types';
import { haversineMeters, maxPairwiseDistanceMeters, speedKmh } from '../geo';
import { isCheckInOpen, type GameWindow } from '../games/windows';
import { SECOND_MS } from '../time';

/**
 * Tolerated difference between a sample's device timestamp and the server
 * clock (future), and extra staleness beyond `gpsSampleWindowSeconds` (past),
 * to absorb upload latency. Beyond it the `clock_skew` signal is raised.
 */
export const GPS_CLOCK_SKEW_TOLERANCE_MS = 120 * SECOND_MS;

/**
 * Samples that are bit-identical in position with `accuracyM` at or below this
 * are treated as synthetic (real receivers jitter); raises `inconsistent_spread`.
 */
export const GPS_SYNTHETIC_ACCURACY_M = 1;

/** Fallbacks offered after a GPS failure that a retry might fix. */
export const GPS_RETRY_FALLBACKS: readonly CheckInMethod[] = ['gps', 'qr', 'peer', 'host'];
/** Fallbacks offered when spoofing is suspected (no GPS retry). */
export const NON_GPS_FALLBACKS: readonly CheckInMethod[] = ['qr', 'peer', 'host'];

function reject(
  reason: CheckInRejectReason,
  fallbacks: readonly CheckInMethod[],
  signals: readonly SpoofSignal[] = [],
): CheckInVerdict {
  return { outcome: 'rejected', method: 'gps', reason, fallbacks, signals };
}

/**
 * Spoofing heuristics. `lastKnown` is the previous trusted fix for this user
 * (e.g. from an earlier attempt), used for the impossible-speed check.
 * Speed between two fixes subtracts both accuracy radii first, so jitter of
 * accurate fixes cannot trip the threshold.
 */
export function detectSpoofSignals(
  samples: readonly GpsSample[],
  now: EpochMs,
  lastKnown?: GpsSample | null,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): SpoofSignal[] {
  const signals: SpoofSignal[] = [];
  if (samples.some((s) => s.isMock === true) || lastKnown?.isMock === true) signals.push('mock_location');

  const sorted = sortByTime(samples);
  const chain = lastKnown ? [lastKnown, ...sorted] : sorted;
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1] as GpsSample;
    const b = chain[i] as GpsSample;
    if (speedKmh(a, b, a.accuracyM + b.accuracyM) > config.gpsMaxSpeedKmh) {
      signals.push('impossible_speed');
      break;
    }
  }

  const oldestAllowed = now - config.gpsSampleWindowSeconds * SECOND_MS - GPS_CLOCK_SKEW_TOLERANCE_MS;
  const newestAllowed = now + GPS_CLOCK_SKEW_TOLERANCE_MS;
  if (samples.some((s) => s.timestamp > newestAllowed || s.timestamp < oldestAllowed)) signals.push('clock_skew');

  if (
    samples.length >= 2 &&
    samples.every(
      (s) =>
        s.lat === (samples[0] as GpsSample).lat &&
        s.lng === (samples[0] as GpsSample).lng &&
        s.accuracyM <= GPS_SYNTHETIC_ACCURACY_M,
    )
  ) {
    signals.push('inconsistent_spread');
  }
  return signals;
}

function sortByTime(samples: readonly GpsSample[]): GpsSample[] {
  return samples.slice().sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Longest chain of samples (in time order) where consecutive picks are at
 * least `spacingMs` apart and, if `windowMs` is given, the whole chain spans at
 * most `windowMs`. Greedy from each start is optimal for this interval problem.
 */
function longestSpacedChain(sorted: readonly GpsSample[], spacingMs: number, windowMs: number): GpsSample[] {
  let best: GpsSample[] = [];
  for (let start = 0; start < sorted.length; start++) {
    const first = sorted[start] as GpsSample;
    const chain = [first];
    let last = first;
    for (let i = start + 1; i < sorted.length; i++) {
      const s = sorted[i] as GpsSample;
      if (s.timestamp - first.timestamp > windowMs) break;
      if (s.timestamp - last.timestamp >= spacingMs) {
        chain.push(s);
        last = s;
      }
    }
    if (chain.length > best.length) best = chain;
  }
  return best;
}

/**
 * Verifies a GPS check-in. Pure: the caller supplies `now` (server clock) and
 * the venue pin. The returned `distanceM` is the best (smallest) distance of
 * the chosen samples, rounded to 0.1 m.
 */
export function verifyGps(
  samples: readonly GpsSample[],
  venue: LatLng,
  window: GameWindow,
  now: EpochMs,
  lastKnown?: GpsSample | null,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): CheckInVerdict {
  if (!isCheckInOpen(window, now, config)) return reject('outside_window', []);

  const signals = detectSpoofSignals(samples, now, lastKnown, config);
  if (signals.length > 0) return reject('suspected_spoofing', NON_GPS_FALLBACKS, signals);

  const min = config.gpsMinSamples;
  if (samples.length < min) return reject('insufficient_samples', GPS_RETRY_FALLBACKS);

  const accurate = sortByTime(samples.filter((s) => s.accuracyM <= config.gpsMaxAccuracyM));
  if (accurate.length < min) return reject('low_accuracy', GPS_RETRY_FALLBACKS);

  const spacingMs = config.gpsMinSampleSpacingSeconds * SECOND_MS;
  if (longestSpacedChain(accurate, spacingMs, Number.POSITIVE_INFINITY).length < min) {
    return reject('samples_too_close', GPS_RETRY_FALLBACKS);
  }
  const chain = longestSpacedChain(accurate, spacingMs, config.gpsSampleWindowSeconds * SECOND_MS);
  if (chain.length < min) return reject('insufficient_samples', GPS_RETRY_FALLBACKS);

  let best = Number.POSITIVE_INFINITY;
  for (const s of chain) {
    const d = haversineMeters(s, venue);
    if (d > config.gpsBaseRadiusM + s.accuracyM) return reject('too_far', GPS_RETRY_FALLBACKS);
    if (d < best) best = d;
  }
  if (maxPairwiseDistanceMeters(chain) >= config.gpsMaxSpreadM) return reject('spread_too_large', GPS_RETRY_FALLBACKS);

  return { outcome: 'verified', method: 'gps', distanceM: Math.round(best * 10) / 10, signals: [] };
}
