import type { GameId, IsoDateTime, TrustEvent, UserId } from '../types';

/**
 * Emitted at attendance finalisation for every late canceller (TRUST-020(b) /
 * TRUST-021). The late-cancel yellow card is decided here, not at cancel time,
 * so no card exists when a waitlisted player filled the spot before the start
 * and checked in.
 * TODO(contract): add to `TrustEvent` in types.ts.
 */
export interface LateCancelFinalizedEvent {
  type: 'LateCancelFinalized';
  gameId: GameId;
  userId: UserId;
  startsAt: IsoDateTime;
  cancelledAt: IsoDateTime;
  /** A waitlisted replacement was promoted into the spot before `startsAt` and checked in. */
  refilled: boolean;
}

/** Every event the domain trust engine accepts: the contract's plus local additions. */
export type DomainTrustEvent = TrustEvent | LateCancelFinalizedEvent;
