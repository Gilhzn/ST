/**
 * Host reliability → temporary `host_suspension` + review (never a permanent
 * loss of hosting rights; only a moderator can go further).
 *
 * Triggers (checked in this order):
 * 1. A venue created by the host was confirmed fake (moderator removed it):
 *    reason `fake_venue`, one suspension per venue.
 * 2. Average host rating ≤ `hostLowRatingMax` over ≥ `hostLowRatingMinCount`
 *    ratings in the last `config.hostRatingLookbackDays` days (TRUST-051(b)):
 *    reason `low_host_rating`. Only ratings submitted after the latest
 *    `low_host_rating` suspension started count (a fresh start).
 * 3. TRUST-051(c): ≥ {@link HOST_LATE_CANCELS_FOR_SUSPENSION} late game
 *    cancellations (host late-cancel cards, see {@link evaluateHostGameCancellation})
 *    in {@link HOST_LATE_CANCEL_WINDOW_DAYS} days: reason `late_cancel`, caused by the cards.
 * Not implemented here (no data in the contract yet): TRUST-051(a) "fake game"
 * by ≥ 3 checked-in reporters.
 * Nothing is issued while a host suspension is in force.
 */
import {
  DEFAULT_TRUST_CONFIG,
  type Effect,
  type EpochMs,
  type Game,
  type GameId,
  type IsoDateTime,
  type Sanction,
  type Stars,
  type TrustConfig,
  type UserId,
  type VenueId,
} from '../types';
import { deriveSanctionId } from '../crypto/uuid';
import { DAY_MS, HOUR_MS, toEpochMs } from '../time';
import { isLateCancel } from '../games/windows';
import { HOST_LATE_CANCEL_WINDOW_DAYS, HOST_LATE_CANCELS_FOR_SUSPENSION } from './constants';
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
  reasonCode: 'fake_venue' | 'low_host_rating' | 'late_cancel' | null;
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
    const at = toEpochMs(r.at);
    if (at <= consumedUntil || at > now || at <= now - config.hostRatingLookbackDays * DAY_MS) continue;
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
  const lateCards = hostLateCancelCards(own, now);
  const lateCancels = lateCards.length >= HOST_LATE_CANCELS_FOR_SUSPENSION;
  if (fakeVenue === undefined && !lowRating && !lateCancels) return result;

  if (own.some((s) => s.kind === 'host_suspension' && isInForce(s, now))) {
    result.outcome = 'already_suspended';
    return result;
  }
  const days = config.hostSuspensionDays;
  let reasonCode: NonNullable<HostReliabilityEvaluation['reasonCode']>;
  let dedupeKey: string;
  let statementParams: Readonly<Record<string, string | number>>;
  if (fakeVenue !== undefined) {
    reasonCode = 'fake_venue';
    dedupeKey = `fake_venue:${hostId}:${fakeVenue}`;
    statementParams = { venueId: fakeVenue, days };
  } else if (lowRating) {
    const last = ratings[ratings.length - 1] as HostRatingRecord;
    reasonCode = 'low_host_rating';
    dedupeKey = `low_host_rating:${hostId}:${ratingKey(last)}`;
    statementParams = { average: averageRating ?? 0, ratings: ratings.length, days };
  } else {
    const last = lateCards[lateCards.length - 1] as Sanction;
    reasonCode = 'late_cancel';
    dedupeKey = `${HOST_LATE_CANCELLATIONS_KEY}:${hostId}:${last.id}`;
    statementParams = { cancellations: lateCards.length, windowDays: HOST_LATE_CANCEL_WINDOW_DAYS, days };
  }
  const suspension = buildSystemSanction(
    {
      kind: 'host_suspension',
      userId: hostId,
      reasonCode,
      statementParams,
      durationMs: days * DAY_MS,
      causedBy: reasonCode === 'late_cancel' ? lateCards.map((c) => c.id) : [],
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
        evidence: { reason: reasonCode, ratingCount: ratings.length, averageRating, lateGameCancellations: lateCards.length },
      },
      now,
    ),
  });
  return result;
}

/** Dedupe-key prefix of the yellow card a host gets for cancelling their own game late. */
export const HOST_LATE_CANCEL_KEY = 'host_late_cancel';
/** Dedupe-key prefix of the host suspension for repeated late game cancellations. */
export const HOST_LATE_CANCELLATIONS_KEY = 'host_late_cancellations';

/** True for the host's own late-game-cancellation card (no deposit, no attendance). */
export function isHostLateCancelCard(s: Pick<Sanction, 'dedupeKey'>): boolean {
  return s.dedupeKey.startsWith(`${HOST_LATE_CANCEL_KEY}:`);
}

/**
 * Host late-cancel cards counting toward TRUST-051(c): not overturned, issued in the
 * last {@link HOST_LATE_CANCEL_WINDOW_DAYS} days and after the latest suspension
 * for late cancellations (consumed). Oldest first.
 */
function hostLateCancelCards(own: readonly Sanction[], now: EpochMs): Sanction[] {
  const consumedUntil = Math.max(
    -Infinity,
    ...own.filter((s) => s.kind === 'host_suspension' && s.reasonCode === 'late_cancel').map((s) => toEpochMs(s.startsAt)),
  );
  const since = Math.max(consumedUntil, now - HOST_LATE_CANCEL_WINDOW_DAYS * DAY_MS);
  return own
    .filter((s) => s.kind === 'yellow_card' && isHostLateCancelCard(s) && s.status !== 'overturned')
    .filter((s) => toEpochMs(s.startsAt) > since && toEpochMs(s.startsAt) <= now)
    .sort((a, b) => toEpochMs(a.startsAt) - toEpochMs(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Input to {@link evaluateHostGameCancellation}. */
export interface HostGameCancellationInput {
  game: Pick<Game, 'id' | 'hostId' | 'startsAt'>;
  /** When the host cancelled the game. */
  cancelledAt: IsoDateTime;
}

/**
 * GAME-047: a host cancelling their own game less than `lateCancelWindowHours`
 * before the start gets a disputable `late_cancel` yellow card (statement param
 * `role: 'host'`), keyed `host_late_cancel:<gameId>:<hostId>`. It counts toward
 * escalation like any card and toward host suspension (TRUST-051(c)), but never
 * settles a deposit (hosts pay none; participants' deposits are released by the
 * game cancellation itself).
 */
export function evaluateHostGameCancellation(
  input: HostGameCancellationInput,
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): { late: boolean; effects: Effect[] } {
  const { game, cancelledAt } = input;
  if (!isLateCancel(game.startsAt, cancelledAt, config)) return { late: false, effects: [] };
  const card = buildSystemSanction(
    {
      kind: 'yellow_card',
      userId: game.hostId,
      reasonCode: 'late_cancel',
      statementParams: {
        role: 'host',
        windowHours: config.lateCancelWindowHours,
        minutesBeforeStart: Math.round((toEpochMs(game.startsAt) - toEpochMs(cancelledAt)) / 60_000),
        disputeHours: config.disputeWindowHours,
      },
      durationMs: config.yellowCardLifetimeDays * DAY_MS,
      disputeMs: config.disputeWindowHours * HOUR_MS,
      gameId: game.id,
      dedupeKey: `${HOST_LATE_CANCEL_KEY}:${game.id}:${game.hostId}`,
    },
    now,
  );
  return { late: true, effects: issueEffects(card) };
}
