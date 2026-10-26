import type { TrustEvent } from '../types';

/**
 * Emitted at attendance finalisation for every late canceller (TRUST-020(b) /
 * TRUST-021). Part of the contract `TrustEvent` since v2.
 */
export type LateCancelFinalizedEvent = Extract<TrustEvent, { type: 'LateCancelFinalized' }>;

/**
 * @deprecated Since contract v2 every event the engine accepts is in
 * `TrustEvent`; use that. Kept as an alias for existing callers.
 */
export type DomainTrustEvent = TrustEvent;
