/**
 * Waitlist promotion (GAME-044 / GAME-045). Waitlisted players were already
 * approved by the host "if a spot frees up", so a freed spot is *offered*:
 * - more than `waitlistLongThresholdHours` to start → the next player gets
 *   `waitlistConfirmLongMinutes` to accept (`standard`);
 * - between that and `waitlistFlashFillHours` → `waitlistConfirmShortMinutes` (`short`);
 * - under `waitlistFlashFillHours` → **flash fill**: everyone on the list is
 *   notified at once and the first to accept takes the spot (`flash`);
 * Offers are announced with the `waitlist_offer` notification; acceptance with `waitlist_promoted`.
 * - at/after the start nothing is offered (`closed`).
 * An unanswered offer expires and the next player is offered on the next pass.
 * Order: regulars of a recurring game first, then `waitlistRank`, `requestedAt`, `userId`.
 * Acceptance is transactional in SQL (row lock); {@link acceptWaitlistOffer} is the rule.
 */
import {
  DEFAULT_TRUST_CONFIG,
  type EpochMs,
  type ErrorCode,
  type Game,
  type IsoDateTime,
  type Participant,
  type Result,
  type TrustConfig,
  type UserId,
  type Effect,
  type WaitlistOfferMode,
} from '../types';
import { HOUR_MS, MINUTE_MS, toEpochMs, toIso } from '../time';

/** Offer window for a vacancy, or `closed` once the game has started. */
export type WaitlistMode = WaitlistOfferMode | 'closed';

/** A `waitlist_offers` row (surfaced on `Participant.offeredAt/offerExpiresAt/offerMode`). */
export interface WaitlistOffer {
  userId: UserId;
  offeredAt: IsoDateTime;
  acceptBy: IsoDateTime;
  mode: WaitlistOfferMode;
}

export type WaitlistParticipant = Pick<Participant, 'userId' | 'status' | 'waitlistRank' | 'requestedAt'>;

export interface WaitlistInput {
  game: Pick<Game, 'id' | 'capacity' | 'status' | 'startsAt'>;
  participants: readonly WaitlistParticipant[];
  /** Offers already made for open spots (current round). */
  offers?: readonly WaitlistOffer[];
  /** Regulars of the recurring series, who go first. */
  regularIds?: readonly UserId[];
}

export interface WaitlistPlan {
  mode: WaitlistMode;
  freeSpots: number;
  /** New offers to record. */
  offers: WaitlistOffer[];
  /** One `Notify` per new offer. */
  effects: Effect[];
}

/** Promotion mode for a vacancy at `now`. */
export function waitlistMode(startsAt: IsoDateTime, now: EpochMs, config: TrustConfig = DEFAULT_TRUST_CONFIG): WaitlistMode {
  const lead = toEpochMs(startsAt) - now;
  if (lead <= 0) return 'closed';
  if (lead < config.waitlistFlashFillHours * HOUR_MS) return 'flash';
  if (lead <= config.waitlistLongThresholdHours * HOUR_MS) return 'short';
  return 'standard';
}

/** Waitlisted participants in promotion order. */
export function orderWaitlist(
  participants: readonly WaitlistParticipant[],
  regularIds: readonly UserId[] = [],
): WaitlistParticipant[] {
  const regular = new Set(regularIds);
  return participants
    .filter((p) => p.status === 'waitlisted')
    .slice()
    .sort((a, b) => {
      const ra = regular.has(a.userId) ? 0 : 1;
      const rb = regular.has(b.userId) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      const wa = a.waitlistRank ?? Number.MAX_SAFE_INTEGER;
      const wb = b.waitlistRank ?? Number.MAX_SAFE_INTEGER;
      if (wa !== wb) return wa - wb;
      const ta = toEpochMs(a.requestedAt);
      const tb = toEpochMs(b.requestedAt);
      if (ta !== tb) return ta - tb;
      return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
    });
}

/** Next 1-based rank for a newly waitlisted participant. */
export function nextWaitlistRank(participants: readonly Pick<Participant, 'status' | 'waitlistRank'>[]): number {
  return Math.max(0, ...participants.filter((p) => p.status === 'waitlisted').map((p) => p.waitlistRank ?? 0)) + 1;
}

/** Approved count vs capacity. */
export function freeSpots(game: Pick<Game, 'capacity'>, participants: readonly Pick<Participant, 'status'>[]): number {
  return Math.max(0, game.capacity - participants.filter((p) => p.status === 'approved').length);
}

/** The outcome of a host approval: `approved` while there is room, else `waitlisted`. */
export function decideJoinOutcome(approvedCount: number, capacity: number): 'approved' | 'waitlisted' {
  return approvedCount < capacity ? 'approved' : 'waitlisted';
}

/** Plans offers for the free spots at `now`. Pure: the caller records the returned offers. */
export function promoteFromWaitlist(
  input: WaitlistInput,
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): WaitlistPlan {
  const { game } = input;
  const mode = input.game.status === 'scheduled' ? waitlistMode(game.startsAt, now, config) : 'closed';
  const spots = freeSpots(game, input.participants);
  const plan: WaitlistPlan = { mode, freeSpots: spots, offers: [], effects: [] };
  if (mode === 'closed' || spots === 0) return plan;
  const queue = orderWaitlist(input.participants, input.regularIds);
  const waitlisted = new Set(queue.map((p) => p.userId));
  const offers = (input.offers ?? []).filter((o) => waitlisted.has(o.userId));
  const active = new Set(offers.filter((o) => toEpochMs(o.acceptBy) > now).map((o) => o.userId));
  const everOffered = new Set(offers.map((o) => o.userId));
  const start = toEpochMs(game.startsAt);
  let candidates: WaitlistParticipant[];
  let acceptBy: EpochMs;
  if (mode === 'flash') {
    candidates = queue.filter((p) => !active.has(p.userId));
    acceptBy = start;
  } else {
    const slots = Math.max(0, spots - active.size);
    candidates = queue.filter((p) => !everOffered.has(p.userId)).slice(0, slots);
    const minutes = mode === 'standard' ? config.waitlistConfirmLongMinutes : config.waitlistConfirmShortMinutes;
    acceptBy = Math.min(now + minutes * MINUTE_MS, start);
  }
  for (const p of candidates) {
    const offer: WaitlistOffer = { userId: p.userId, offeredAt: toIso(now), acceptBy: toIso(acceptBy), mode };
    plan.offers.push(offer);
    plan.effects.push({
      type: 'Notify',
      userId: p.userId,
      kind: 'waitlist_offer',
      params: { offer: 1, mode, acceptBy: offer.acceptBy },
      gameId: game.id,
      sanctionDedupeKey: null,
    });
  }
  return plan;
}

/**
 * A waitlisted player accepts an offer. Errors: `game_not_open` (not scheduled
 * or started), `not_found` (not waitlisted / no offer), `outside_window` (offer
 * expired), `game_full` (someone else took the spot). On success: `PromoteWaitlist`,
 * a confirmation, and — when this filled the last spot — a "spot taken, you are
 * still on the list" notice to other players holding active offers.
 */
export function acceptWaitlistOffer(input: WaitlistInput, userId: UserId, now: EpochMs): Result<Effect[], ErrorCode> {
  const { game } = input;
  if (game.status !== 'scheduled' || now >= toEpochMs(game.startsAt)) return { ok: false, error: 'game_not_open' };
  const me = input.participants.find((p) => p.userId === userId && p.status === 'waitlisted');
  const offer = (input.offers ?? []).filter((o) => o.userId === userId).pop();
  if (!me || !offer) return { ok: false, error: 'not_found' };
  if (toEpochMs(offer.acceptBy) < now) return { ok: false, error: 'outside_window' };
  const spots = freeSpots(game, input.participants);
  if (spots === 0) return { ok: false, error: 'game_full' };
  const effects: Effect[] = [
    { type: 'PromoteWaitlist', gameId: game.id, userId },
    { type: 'Notify', userId, kind: 'waitlist_promoted', params: { mode: offer.mode }, gameId: game.id, sanctionDedupeKey: null },
  ];
  if (spots === 1) {
    const others = [
      ...new Set(
        (input.offers ?? [])
          .filter((o) => o.userId !== userId && toEpochMs(o.acceptBy) >= now)
          .filter((o) => input.participants.some((p) => p.userId === o.userId && p.status === 'waitlisted'))
          .map((o) => o.userId),
      ),
    ].sort();
    for (const other of others) {
      effects.push({ type: 'Notify', userId: other, kind: 'join_waitlisted', params: { spotTaken: 1 }, gameId: game.id, sanctionDedupeKey: null });
    }
  }
  return { ok: true, value: effects };
}
