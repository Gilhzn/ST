/**
 * Host reliability → temporary `host_suspension` + review (never a permanent
 * loss of hosting rights; only a moderator can go further).
 *
 * Triggers (checked in this order):
 * 1. A venue created by the host was confirmed fake (moderator removed it):
 *    reason `fake_venue`, one suspension per venue.
 * 2. Average host rating ≤ `hostLowRatingMax` over ≥ `hostLowRatingMinCount`
 *    ratings: reason `low_host_rating`. Only ratings submitted after the
 *    latest `low_host_rating` suspension started count (a fresh start).
 * Nothing is issued while a host suspension is in force.
 */
import {
  DEFAULT_TRUST_CONFIG,
  type Effect,
  type EpochMs,
  type GameId,
  type IsoDateTime,
  type Sanction,
  type Stars,
  type TrustConfig,
  type UserId,
  type VenueId,
} from '../types';
import { deriveSanctionId } from '../crypto/uuid';
import { DAY_MS, toEpochMs } from '../time';
import { buildReviewItem, buildSystemSanction, isInForce, issueEffects } from './sanctions';

/** One `host_ratings` row (unique per game + rater). */
export interface HostRatingRecord {
  hostId: UserId;
  gameId: GameId;
  raterId: UserId;
  stars: Stars;
  at: IsoDateTime;
}

export interface HostReliabilityInput {
  hostId: UserId;
  ratings: readonly HostRatingRecord[];
  /** Venues created by the host that a moderator confirmed fake. */
  confirmedFakeVenueIds: readonly VenueId[];
  sanctions: readonly Sanction[];
}

export interface HostReliabilityEvaluation {
  outcome: 'none' | 'suspend' | 'already_suspended';
  reasonCode: 'fake_venue' | 'low_host_rating' | null;
  /** Ratings counted (after de-duplication and consumption). */
  ratingCount: number;
  /** Mean of counted ratings rounded to 2 decimals, or `null` when none. */
  averageRating: number | null;
  effects: Effect[];
}

function ratingKey(r: HostRatingRecord): string {
  return `${r.gameId}:${r.raterId}`;
}

export function evaluateHostReliability(
  input: HostReliabilityInput,
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): HostReliabilityEvaluation {
  const { hostId } = input;
  const own = input.sanctions.filter((s) => s.userId === hostId);
  const consumedUntil = Math.max(
    -Infinity,
    ...own.filter((s) => s.reasonCode === 'low_host_rating').map((s) => toEpochMs(s.startsAt)),
  );
  const unique = new Map<string, HostRatingRecord>();
  for (const r of input.ratings) {
    if (r.hostId !== hostId || r.raterId === hostId) continue;
    if (toEpochMs(r.at) <= consumedUntil || toEpochMs(r.at) > now) continue;
    const k = ratingKey(r);
    const prev = unique.get(k);
    if (!prev || toEpochMs(r.at) > toEpochMs(prev.at)) unique.set(k, r);
  }
  const ratings = [...unique.values()].sort(
    (a, b) => toEpochMs(a.at) - toEpochMs(b.at) || (ratingKey(a) < ratingKey(b) ? -1 : 1),
  );
  const sum = ratings.reduce((acc, r) => acc + r.stars, 0);
  const averageRating = ratings.length > 0 ? Math.round((sum / ratings.length) * 100) / 100 : null;
  const result: HostReliabilityEvaluation = {
    outcome: 'none',
    reasonCode: null,
    ratingCount: ratings.length,
    averageRating,
    effects: [],
  };

  const fakeVenue = input.confirmedFakeVenueIds
    .slice()
    .sort()
    .find((v) => !own.some((s) => s.dedupeKey === `fake_venue:${hostId}:${v}`));
  // Exact comparison on the raw mean (sum ≤ max·count) avoids rounding at the boundary.
  const lowRating = ratings.length >= config.hostLowRatingMinCount && sum <= config.hostLowRatingMax * ratings.length;
  if (fakeVenue === undefined && !lowRating) return result;

  if (own.some((s) => s.kind === 'host_suspension' && isInForce(s, now))) {
    result.outcome = 'already_suspended';
    return result;
  }
  const days = config.hostSuspensionDays;
  const reasonCode = fakeVenue !== undefined ? 'fake_venue' : 'low_host_rating';
  const last = ratings[ratings.length - 1];
  const dedupeKey =
    fakeVenue !== undefined ? `fake_venue:${hostId}:${fakeVenue}` : `low_host_rating:${hostId}:${last ? ratingKey(last) : ''}`;
  const statementParams =
    fakeVenue !== undefined
      ? { venueId: fakeVenue, days }
      : { average: averageRating ?? 0, ratings: ratings.length, days };
  const suspension = buildSystemSanction(
    {
      kind: 'host_suspension',
      userId: hostId,
      reasonCode,
      statementParams,
      durationMs: days * DAY_MS,
      dedupeKey,
    },
    now,
  );
  result.outcome = 'suspend';
  result.reasonCode = reasonCode;
  result.effects.push(...issueEffects(suspension), {
    type: 'EnqueueReview',
    item: buildReviewItem(
      {
        kind: 'host_reliability',
        priority: 'normal',
        dedupeKey,
        subjectUserId: hostId,
        venueId: fakeVenue ?? null,
        sanctionId: deriveSanctionId(dedupeKey),
        evidence: { reason: reasonCode, ratingCount: ratings.length, averageRating },
      },
      now,
    ),
  });
  return result;
}
