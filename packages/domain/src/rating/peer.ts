/**
 * Peer attribute ratings (RATE-001..005). Ratings are never used for
 * sanctions (RATE-005); they feed the private player summary and the host's
 * 1–5 balancing band.
 *
 * Aggregation per attribute (RATE-003/004):
 * 1. pair decay: the k-th rating from the same rater within
 *    `peerPairDecayWindowDays` (counting itself) weighs
 *    `peerPairDecayFactor^max(0, k − peerPairDecayAfter)`;
 * 2. reciprocal max pairs ("10/10" clusters): an all-5 rating answered by an
 *    all-5 rating from the ratee to the rater within the same window is
 *    multiplied by `peerReciprocalWeight`;
 * 3. trimming: ratings farther than `peerOutlierSigma` weighted standard
 *    deviations from the weighted consensus are dropped (single pass);
 * 4. Bayesian mean with the self-assessment as prior of weight
 *    `peerSelfPriorWeight`: `(W₀·prior + Σ w·x) / (W₀ + Σ w)`.
 * Means and weights are rounded to 4 decimals (stable across TS and SQL).
 */
import {
  PLAYER_RATING_ATTRIBUTES,
  type Block,
  type EpochMs,
  type ErrorCode,
  type GameId,
  type IsoDateTime,
  type PeerAttributeSummary,
  type PeerRating,
  type PeerRatingInput,
  type PeerSkillSummary,
  type PlayerRatingAttribute,
  type RatingEligibility,
  type RatingIneligibleReason,
  type Result,
  type SkillAttributes,
  type SportId,
  type Stars,
  type UserId,
} from '../types';
import { DAY_MS, HOUR_MS, toEpochMs, toIso } from '../time';
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from '../config';

export interface RaterContext {
  userId: UserId;
  /** Reliability score 0..1, `null` while `new`. */
  reliability: number | null;
  /** Verified games in this sport (this game included). */
  verifiedGamesInSport: number;
  hasActiveSanction: boolean;
  /** The rater checked in to this game. */
  verifiedInGame: boolean;
}

export interface PeerEligibilityInput {
  game: { endsAt: IsoDateTime };
  rater: RaterContext;
  /** Verified attendees of the game. */
  verifiedUserIds: readonly UserId[];
  blocks: readonly Pick<Block, 'blockerId' | 'blockedId'>[];
  /** Co-players the rater already rated in this game. */
  alreadyRated: readonly UserId[];
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * RATE-001/002 gates, all reported in this order: `not_verified`,
 * `low_reliability` (< `peerRaterMinReliability`, or new), `too_few_games`
 * (< `peerRaterMinVerifiedGames`; AC-RATE-002), `active_sanction`,
 * `window_not_open` (before `endsAt`), `window_closed` (after `endsAt +
 * peerRatingWindowHours`). Rateable co-players exclude the rater, blocked
 * pairs (either direction) and those already rated.
 */
export function peerRatingEligibility(input: PeerEligibilityInput, config: DomainConfig = DEFAULT_DOMAIN_CONFIG, now: EpochMs): RatingEligibility {
  const { rater } = input;
  const end = toEpochMs(input.game.endsAt);
  const closes = end + config.peerRatingWindowHours * HOUR_MS;
  const reasons: RatingIneligibleReason[] = [];
  if (!rater.verifiedInGame) reasons.push('not_verified');
  if (rater.reliability === null || rater.reliability < config.peerRaterMinReliability) reasons.push('low_reliability');
  if (rater.verifiedGamesInSport < config.peerRaterMinVerifiedGames) reasons.push('too_few_games');
  if (rater.hasActiveSanction) reasons.push('active_sanction');
  if (now < end) reasons.push('window_not_open');
  if (now > closes) reasons.push('window_closed');
  const remaining = Math.max(0, config.peerRatingMaxRatees - input.alreadyRated.length);
  const canRate = reasons.length === 0 && remaining > 0;
  const blocked = new Set<UserId>();
  for (const b of input.blocks) {
    if (b.blockerId === rater.userId) blocked.add(b.blockedId);
    if (b.blockedId === rater.userId) blocked.add(b.blockerId);
  }
  const done = new Set(input.alreadyRated);
  const rateable = canRate
    ? [...new Set(input.verifiedUserIds)].filter((u) => u !== rater.userId && !blocked.has(u) && !done.has(u)).sort()
    : [];
  return {
    canRate,
    reasons,
    verifiedGamesInSport: rater.verifiedGamesInSport,
    requiredGames: config.peerRaterMinVerifiedGames,
    windowClosesAt: toIso(closes),
    remainingRatees: remaining,
    rateableUserIds: rateable,
  };
}

const isStar = (v: unknown): v is Stars => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;

/**
 * Validates a submission against its eligibility. Rejects `outside_window`
 * (window gates), `forbidden` (other gates, or a ratee not rateable),
 * `validation` (empty, more than the remaining ratees, duplicates, unknown
 * attribute for the sport, score not an integer 1–5).
 */
export function validatePeerRatings(eligibility: RatingEligibility, sport: SportId, inputs: readonly PeerRatingInput[]): Result<true, ErrorCode> {
  if (eligibility.reasons.includes('window_closed') || eligibility.reasons.includes('window_not_open')) return { ok: false, error: 'outside_window' };
  if (!eligibility.canRate) return { ok: false, error: 'forbidden' };
  if (inputs.length === 0 || inputs.length > eligibility.remainingRatees) return { ok: false, error: 'validation' };
  if (new Set(inputs.map((i) => i.rateeId)).size !== inputs.length) return { ok: false, error: 'validation' };
  const allowed = PLAYER_RATING_ATTRIBUTES[sport] as readonly string[];
  for (const i of inputs) {
    if (!eligibility.rateableUserIds.includes(i.rateeId)) return { ok: false, error: 'forbidden' };
    const entries = Object.entries(i.scores);
    if (entries.length === 0) return { ok: false, error: 'validation' };
    for (const [k, v] of entries) if (!allowed.includes(k) || !isStar(v)) return { ok: false, error: 'validation' };
  }
  return { ok: true, value: true };
}

/** Rows to insert for a validated submission. */
export function buildPeerRatings(gameId: GameId, sport: SportId, raterId: UserId, inputs: readonly PeerRatingInput[], now: EpochMs): PeerRating[] {
  return inputs.map((i) => ({ gameId, sport, raterId, rateeId: i.rateeId, scores: { ...i.scores }, createdAt: toIso(now) }));
}

/** Self-assessment used as the Bayesian prior. */
export interface SelfPrior {
  selfSkill: Stars;
  /** Per peer attribute; missing attributes fall back to `selfSkill`. */
  attributes?: Readonly<Partial<Record<string, number>>>;
}

/** Maps the MVP self-assessment (speed, control, overall) onto peer attributes. */
export function selfPriorFrom(selfSkill: Stars, attributes?: Partial<SkillAttributes> | null): SelfPrior {
  const a = attributes ?? {};
  const map: Record<string, number | undefined> = {
    overall: a.overall,
    speed: a.speed,
    pace: a.speed,
    athleticism: a.speed,
    movement: a.speed,
    ball_control: a.control,
    handling: a.control,
  };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) if (v !== undefined) out[k] = v;
  return { selfSkill, attributes: out };
}

export interface PeerAggregateInput {
  userId: UserId;
  sport: SportId;
  self: SelfPrior;
  /** Ratings the user received in this sport. */
  received: readonly PeerRating[];
  /** Ratings the user gave (reciprocity detection). */
  given: readonly PeerRating[];
}

function allMax(r: PeerRating): boolean {
  const v = Object.values(r.scores);
  return v.length > 0 && v.every((x) => x === 5);
}

/** RATE-003 weights (decay × reciprocity) per received rating, aligned with `input.received`. */
export function peerRatingWeights(input: PeerAggregateInput, config: DomainConfig = DEFAULT_DOMAIN_CONFIG): number[] {
  const window = config.peerPairDecayWindowDays * DAY_MS;
  const times = input.received.map((r) => toEpochMs(r.createdAt));
  return input.received.map((r, i) => {
    const t = times[i] as number;
    let k = 0;
    input.received.forEach((o, j) => {
      const tj = times[j] as number;
      if (o.raterId === r.raterId && tj <= t && tj > t - window && (tj < t || j <= i)) k++;
    });
    let w = Math.pow(config.peerPairDecayFactor, Math.max(0, k - config.peerPairDecayAfter));
    if (
      allMax(r) &&
      input.given.some((g) => g.rateeId === r.raterId && allMax(g) && Math.abs(toEpochMs(g.createdAt) - t) <= window)
    ) {
      w *= config.peerReciprocalWeight;
    }
    return w;
  });
}

/** RATE-004 summary (private to the player; hosts see only `band`). */
export function aggregatePeerRatings(input: PeerAggregateInput, config: DomainConfig = DEFAULT_DOMAIN_CONFIG): PeerSkillSummary {
  const weights = peerRatingWeights(input, config);
  const attrs: Partial<Record<PlayerRatingAttribute, PeerAttributeSummary>> = {};
  const raters = new Set<UserId>();
  for (const attr of PLAYER_RATING_ATTRIBUTES[input.sport] as readonly PlayerRatingAttribute[]) {
    const samples: { x: number; w: number; rater: UserId }[] = [];
    input.received.forEach((r, i) => {
      const x = (r.scores as Partial<Record<string, number>>)[attr];
      const w = weights[i] as number;
      if (x !== undefined && w > 0) samples.push({ x, w, rater: r.raterId });
    });
    const prior = input.self.attributes?.[attr] ?? input.self.selfSkill;
    let kept = samples;
    if (samples.length > 0) {
      const W = samples.reduce((s, p) => s + p.w, 0);
      const mean = samples.reduce((s, p) => s + p.w * p.x, 0) / W;
      const sd = Math.sqrt(samples.reduce((s, p) => s + p.w * (p.x - mean) ** 2, 0) / W);
      if (sd > 0) kept = samples.filter((p) => Math.abs(p.x - mean) <= config.peerOutlierSigma * sd + 1e-12);
    }
    const ew = kept.reduce((s, p) => s + p.w, 0);
    const sum = kept.reduce((s, p) => s + p.w * p.x, 0);
    for (const p of kept) raters.add(p.rater);
    attrs[attr] = {
      mean: round4((config.peerSelfPriorWeight * prior + sum) / (config.peerSelfPriorWeight + ew)),
      evidenceWeight: round4(ew),
      ratingsUsed: kept.length,
    };
  }
  const overall = (attrs.overall as PeerAttributeSummary).mean;
  return {
    userId: input.userId,
    sport: input.sport,
    attributes: attrs,
    band: Math.min(5, Math.max(1, Math.round(overall))) as Stars,
    raterCount: raters.size,
  };
}
