/**
 * Reliability % (TRUST-030/031, contract `ReliabilitySnapshot`).
 *
 * Over the last `reliabilityWindowDays` (by `endsAt` for played games, by
 * `cancelledAt` for late cancels):
 * - verified   = approved participations with attendance `verified`;
 * - no-shows   = approved participations with attendance `no_show_unverified`;
 * - late cancels = cancelled with `lateCancel`, excluding refilled ones (TRUST-021);
 * - `excused`, `unknown` and games that did not happen are not commitments.
 * `score = (verified + prior) / (verified + noShows + lateCancelWeight·lateCancels + prior)`
 * (contract formula: a late cancel adds 0.5 to the denominator).
 * Status: `red` when a non-card sanction (ban, mute, restriction, suspension) is in
 * force or score < `reliabilityRedBelow`; else `new` below `reliabilityMinGames`
 * commitments (score `null`); else `green` with no in-force yellow card and
 * score ≥ `reliabilityGreenMin`; else `yellow`.
 */
import {
  DEFAULT_TRUST_CONFIG,
  type EpochMs,
  type IsoDateTime,
  type Participant,
  type ReliabilitySnapshot,
  type Sanction,
  type TrustConfig,
} from '../types';
import { DAY_MS, toEpochMs, toIso } from '../time';
import { isInForce } from './sanctions';

/** One participation with the game end time. */
export interface ReliabilityParticipation
  extends Pick<Participant, 'gameId' | 'status' | 'attendance' | 'lateCancel' | 'cancelledAt'> {
  endsAt: IsoDateTime;
  /** TRUST-021: the spot freed by this late cancel was refilled from the waitlist. */
  lateCancelRefilled?: boolean;
  /** TRUST-011: `false` when the game was finalised as not having happened. */
  gameHappened?: boolean;
}

export function computeReliability(
  participations: readonly ReliabilityParticipation[],
  sanctions: readonly Sanction[],
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): ReliabilitySnapshot {
  const since = now - config.reliabilityWindowDays * DAY_MS;
  const inWindow = (iso: IsoDateTime | null) => iso !== null && toEpochMs(iso) > since && toEpochMs(iso) <= now;
  let verified = 0;
  let noShows = 0;
  let lateCancels = 0;
  for (const p of participations) {
    if (p.status === 'approved' && p.gameHappened !== false && inWindow(p.endsAt)) {
      if (p.attendance === 'verified') verified++;
      else if (p.attendance === 'no_show_unverified') noShows++;
    } else if (p.status === 'cancelled' && p.lateCancel && !p.lateCancelRefilled && inWindow(p.cancelledAt)) {
      lateCancels++;
    }
  }
  const commitmentCount = verified + noShows + lateCancels;
  const prior = config.reliabilityPrior;
  const score = (verified + prior) / (verified + noShows + config.reliabilityLateCancelWeight * lateCancels + prior);
  const inForce = sanctions.filter((s) => isInForce(s, now));
  const restricted = inForce.some((s) => s.kind !== 'yellow_card');
  const hasCard = inForce.some((s) => s.kind === 'yellow_card');
  const isNew = commitmentCount < config.reliabilityMinGames;
  const status = restricted
    ? 'red'
    : isNew
      ? 'new'
      : score < config.reliabilityRedBelow
        ? 'red'
        : !hasCard && score >= config.reliabilityGreenMin
          ? 'green'
          : 'yellow';
  return {
    score: isNew ? null : Math.round(score * 10_000) / 10_000,
    status,
    verifiedCount: verified,
    commitmentCount,
    lateCancelCount: lateCancels,
    noShowCount: noShows,
    computedAt: toIso(now),
  };
}
