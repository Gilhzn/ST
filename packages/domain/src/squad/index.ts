/**
 * Smart squad balancing (GAME-061):
 * 1. Scarce positions first ({@link SCARCE_POSITIONS}, e.g. goalkeepers): for each,
 *   ⌊count/teams⌋·teams of its best players are snake-drafted so every team gets
 *   exactly ⌊count/teams⌋.
 * 2. Snake draft of everyone else by rating; equal ratings are ordered by a
 *   seeded mulberry32 shuffle (input order never matters: players are first
 *   sorted by `userId`).
 * 3. Simulated annealing over pairwise swaps (`iterations`, default 3000;
 *   geometric cooling) with O(1)-in-n delta updates, minimising
 *   `cost = spread² + 10·positionDeficits + 100·sizeImbalance`, where `spread` is
 *   max − min team rating sum, `positionDeficits` = Σ over teams and positions of
 *   max(0, ⌊count(position)/teams⌋ − count in team), and `sizeImbalance` =
 *   max(0, largest − smallest team − 1). Swaps keep sizes, and a swap that would
 *   create a *scarce* position deficit is never accepted (hard constraint).
 * The best state seen is returned, so the result never costs more than the
 * step 1–2 draft ({@link snakeDraft}). Deterministic for a given seed.
 */
import {
  SCARCE_POSITIONS,
  SPORT_POSITIONS,
  type PositionId,
  type SportId,
  type Stars,
  type UserId,
  type UserSport,
} from '../types';
import { mulberry32, randomInt, shuffle, type Rng } from '../rng';

export const DEFAULT_PLAYER_RATING = 3;
export const DEFAULT_ANNEALING_ITERATIONS = 3000;
/** Weights of the self-assessed attributes in a player's rating. */
export const RATING_WEIGHTS = { overall: 0.5, speed: 0.25, control: 0.25 } as const;

export interface SquadPlayer {
  userId: UserId;
  /** Typically 1–5. */
  rating: number;
  /** Preferred positions, most preferred first. */
  positions: readonly PositionId[];
}

export interface BalanceOptions {
  teams: number;
  sport: SportId;
  seed: number;
  iterations?: number;
}

export interface SquadMember {
  userId: UserId;
  rating: number;
  /** Position the player fills for balancing (scarce preference first), or `null`. */
  role: PositionId | null;
}

export interface BalanceResult {
  teams: SquadMember[][];
  cost: number;
  ratingSums: number[];
  spread: number;
  positionDeficits: number;
  sizeImbalance: number;
}

/** Rating from self-assessed attributes; falls back to `selfSkill`, then {@link DEFAULT_PLAYER_RATING}. */
export function ratingFromUserSport(us?: Pick<UserSport, 'attributes' | 'selfSkill'> | null): number {
  if (!us) return DEFAULT_PLAYER_RATING;
  const a = us.attributes as Partial<Record<'overall' | 'speed' | 'control', Stars>> | undefined;
  if (a && a.overall !== undefined && a.speed !== undefined && a.control !== undefined) {
    return RATING_WEIGHTS.overall * a.overall + RATING_WEIGHTS.speed * a.speed + RATING_WEIGHTS.control * a.control;
  }
  return us.selfSkill ?? DEFAULT_PLAYER_RATING;
}

/**
 * Builds a {@link SquadPlayer}; `hostAdjustment` is the host's private level
 * correction (GAME-060), the result is clamped to 1–5.
 */
export function toSquadPlayer(userId: UserId, us?: UserSport | null, hostAdjustment = 0): SquadPlayer {
  const rating = Math.min(5, Math.max(1, ratingFromUserSport(us) + hostAdjustment));
  return { userId, rating, positions: us ? [...us.positions] : [] };
}

function roleOf(p: SquadPlayer, sport: SportId): PositionId | null {
  const valid = SPORT_POSITIONS[sport] as readonly PositionId[];
  const scarce = (SCARCE_POSITIONS[sport] ?? []) as readonly PositionId[];
  return p.positions.find((x) => scarce.includes(x)) ?? p.positions.find((x) => valid.includes(x)) ?? null;
}

interface Prepared {
  order: SquadPlayer[];
  roles: (PositionId | null)[];
  rng: Rng;
}

function prepare(players: readonly SquadPlayer[], opts: BalanceOptions): Prepared {
  if (!Number.isInteger(opts.teams) || opts.teams < 1) throw new RangeError('teams must be a positive integer');
  const ids = new Set(players.map((p) => p.userId));
  if (ids.size !== players.length) throw new RangeError('duplicate userId in players');
  const clean = players.map((p) => ({ ...p, rating: Number.isFinite(p.rating) ? p.rating : DEFAULT_PLAYER_RATING }));
  const canonical = clean.slice().sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const rng = mulberry32(opts.seed);
  const order = shuffle(canonical, rng).sort((a, b) => b.rating - a.rating); // stable: ties keep shuffled order
  return { order, roles: order.map((p) => roleOf(p, opts.sport)), rng };
}

function snakeTeam(i: number, k: number): number {
  const round = Math.floor(i / k);
  const pos = i % k;
  return round % 2 === 0 ? pos : k - 1 - pos;
}

/** Team index per player of `prep.order` (steps 1–2; `scarceFirst: false` = plain rating snake). */
function draft(prep: Prepared, opts: BalanceOptions, scarceFirst: boolean): number[] {
  const k = opts.teams;
  const teamOf = new Array<number>(prep.order.length).fill(-1);
  if (scarceFirst) {
    for (const pos of (SCARCE_POSITIONS[opts.sport] ?? []) as readonly PositionId[]) {
      const idx = prep.order.map((_, i) => i).filter((i) => prep.roles[i] === pos);
      const take = Math.floor(idx.length / k) * k;
      idx.slice(0, take).forEach((pi, n) => (teamOf[pi] = snakeTeam(n, k)));
    }
  }
  let n = 0;
  for (let i = 0; i < prep.order.length; i++) {
    if (teamOf[i] === -1) teamOf[i] = snakeTeam(n++, k);
  }
  return teamOf;
}

/** Incremental cost model. */
class Model {
  readonly k: number;
  readonly nRoles: number;
  readonly sums: number[];
  readonly sizes: number[];
  readonly cnt: number[][];
  readonly required: number[];
  readonly scarce: boolean[];
  deficit = 0;
  hard = 0;

  constructor(
    readonly ratings: readonly number[],
    readonly roleIdx: readonly number[],
    roleList: readonly PositionId[],
    scarceList: readonly PositionId[],
    readonly teamOf: number[],
    k: number,
  ) {
    this.k = k;
    this.nRoles = roleList.length;
    this.sums = new Array<number>(k).fill(0);
    this.sizes = new Array<number>(k).fill(0);
    this.cnt = Array.from({ length: k }, () => new Array<number>(roleList.length).fill(0));
    const totals = new Array<number>(roleList.length).fill(0);
    for (let i = 0; i < teamOf.length; i++) {
      const t = teamOf[i] as number;
      this.sums[t] = (this.sums[t] as number) + (ratings[i] as number);
      this.sizes[t] = (this.sizes[t] as number) + 1;
      const r = roleIdx[i] as number;
      if (r >= 0) {
        (this.cnt[t] as number[])[r] = ((this.cnt[t] as number[])[r] as number) + 1;
        totals[r] = (totals[r] as number) + 1;
      }
    }
    this.required = totals.map((c) => Math.floor(c / k));
    this.scarce = roleList.map((r) => scarceList.includes(r));
    for (let t = 0; t < k; t++) {
      for (let r = 0; r < this.nRoles; r++) {
        const d = this.def(t, r, 0);
        this.deficit += d;
        if (this.scarce[r]) this.hard += d;
      }
    }
  }

  def(t: number, r: number, delta: number): number {
    return Math.max(0, (this.required[r] as number) - ((this.cnt[t] as number[])[r] as number) - delta);
  }

  spread(sums: readonly number[] = this.sums): number {
    let max = -Infinity;
    let min = Infinity;
    for (const s of sums) {
      if (s > max) max = s;
      if (s < min) min = s;
    }
    return max - min;
  }

  sizeImbalance(): number {
    return Math.max(0, Math.max(...this.sizes) - Math.min(...this.sizes) - 1);
  }

  cost(spread = this.spread(), deficit = this.deficit): number {
    return spread * spread + 10 * deficit + 100 * this.sizeImbalance();
  }

  /** Deficit deltas (total, hard) of swapping players i and j (different teams). */
  swapDeficitDelta(i: number, j: number): [number, number] {
    const ri = this.roleIdx[i] as number;
    const rj = this.roleIdx[j] as number;
    if (ri === rj) return [0, 0];
    const a = this.teamOf[i] as number;
    const b = this.teamOf[j] as number;
    let total = 0;
    let hard = 0;
    const add = (t: number, r: number, delta: number) => {
      if (r < 0) return;
      const d = this.def(t, r, -delta) - this.def(t, r, 0);
      total += d;
      if (this.scarce[r]) hard += d;
    };
    add(a, ri, -1);
    add(a, rj, +1);
    add(b, rj, -1);
    add(b, ri, +1);
    return [total, hard];
  }

  applySwap(i: number, j: number, dTotal: number, dHard: number): void {
    const a = this.teamOf[i] as number;
    const b = this.teamOf[j] as number;
    const ri = this.ratings[i] as number;
    const rj = this.ratings[j] as number;
    this.sums[a] = (this.sums[a] as number) - ri + rj;
    this.sums[b] = (this.sums[b] as number) - rj + ri;
    const xi = this.roleIdx[i] as number;
    const xj = this.roleIdx[j] as number;
    const ca = this.cnt[a] as number[];
    const cb = this.cnt[b] as number[];
    if (xi >= 0) {
      ca[xi] = (ca[xi] as number) - 1;
      cb[xi] = (cb[xi] as number) + 1;
    }
    if (xj >= 0) {
      cb[xj] = (cb[xj] as number) - 1;
      ca[xj] = (ca[xj] as number) + 1;
    }
    this.deficit += dTotal;
    this.hard += dHard;
    this.teamOf[i] = b;
    this.teamOf[j] = a;
  }
}

function buildModel(prep: Prepared, opts: BalanceOptions, teamOf: number[]): Model {
  const roleList = SPORT_POSITIONS[opts.sport] as readonly PositionId[];
  const scarceList = (SCARCE_POSITIONS[opts.sport] ?? []) as readonly PositionId[];
  const roleIdx = prep.roles.map((r) => (r === null ? -1 : roleList.indexOf(r)));
  return new Model(
    prep.order.map((p) => p.rating),
    roleIdx,
    roleList,
    scarceList,
    teamOf,
    opts.teams,
  );
}

function toTeams(prep: Prepared, k: number, teamOf: readonly number[]): SquadMember[][] {
  const teams: SquadMember[][] = Array.from({ length: k }, () => []);
  prep.order.forEach((p, i) =>
    (teams[teamOf[i] as number] as SquadMember[]).push({ userId: p.userId, rating: p.rating, role: prep.roles[i] ?? null }),
  );
  for (const t of teams) t.sort((a, b) => b.rating - a.rating || (a.userId < b.userId ? -1 : 1));
  return teams;
}

/** Steps 1–2 only (scarce positions first, then snake). `scarceFirst: false` gives the plain rating snake. */
export function snakeDraft(players: readonly SquadPlayer[], opts: BalanceOptions, scarceFirst = true): BalanceResult {
  const prep = prepare(players, opts);
  const teamOf = draft(prep, opts, scarceFirst);
  return summarize(prep, opts, teamOf);
}

function summarize(prep: Prepared, opts: BalanceOptions, teamOf: readonly number[]): BalanceResult {
  const m = buildModel(prep, opts, teamOf.slice());
  const spread = m.spread();
  return {
    teams: toTeams(prep, opts.teams, teamOf),
    cost: m.cost(spread),
    ratingSums: m.sums.slice(),
    spread,
    positionDeficits: m.deficit,
    sizeImbalance: m.sizeImbalance(),
  };
}

/** Balances `players` into `opts.teams` teams (see module doc). */
export function balanceTeams(players: readonly SquadPlayer[], opts: BalanceOptions): BalanceResult {
  const prep = prepare(players, opts);
  const k = opts.teams;
  const teamOf = draft(prep, opts, true);
  const n = teamOf.length;
  const model = buildModel(prep, opts, teamOf);
  let cur = model.cost();
  let best = cur;
  let bestTeamOf = teamOf.slice();
  const iterations = opts.iterations ?? DEFAULT_ANNEALING_ITERATIONS;
  if (k > 1 && n > 1 && iterations > 0) {
    const ratings = model.ratings;
    const range = Math.max(...ratings) - Math.min(...ratings);
    const t0 = Math.max(1, range * range);
    const tEnd = 0.01;
    const alpha = Math.pow(tEnd / t0, 1 / iterations);
    let temp = t0;
    const nextSums = model.sums.slice();
    for (let it = 0; it < iterations; it++, temp *= alpha) {
      const i = randomInt(prep.rng, n);
      let j = randomInt(prep.rng, n);
      for (let tries = 0; tries < 8 && model.teamOf[j] === model.teamOf[i]; tries++) j = randomInt(prep.rng, n);
      const a = model.teamOf[i] as number;
      const b = model.teamOf[j] as number;
      if (a === b) continue;
      const ri = ratings[i] as number;
      const rj = ratings[j] as number;
      if (ri === rj && model.roleIdx[i] === model.roleIdx[j]) continue;
      const [dTotal, dHard] = model.swapDeficitDelta(i, j);
      if (dHard > 0) continue;
      for (let t = 0; t < k; t++) nextSums[t] = model.sums[t] as number;
      nextSums[a] = (nextSums[a] as number) - ri + rj;
      nextSums[b] = (nextSums[b] as number) - rj + ri;
      const next = model.cost(model.spread(nextSums), model.deficit + dTotal);
      const delta = next - cur;
      if (delta <= 0 || prep.rng() < Math.exp(-delta / temp)) {
        model.applySwap(i, j, dTotal, dHard);
        cur = next;
        if (cur < best - 1e-9) {
          best = cur;
          bestTeamOf = model.teamOf.slice();
        }
      }
    }
  }
  return summarize(prep, opts, bestTeamOf);
}
