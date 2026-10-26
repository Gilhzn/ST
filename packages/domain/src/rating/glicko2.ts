/**
 * Glicko-2 (Mark Glickman, "Example of the Glicko-2 system", 2012), exactly:
 * step 2 scale conversion, steps 3–4 `v` and `Δ`, step 5 volatility by the
 * Illinois (regula falsi) iteration with ε = 1e-6, steps 6–8 update. Plus the
 * product rules (GLK-001..006):
 * - team games: each player is rated against each opposing team's composite
 *   (mean r, RMS RD); outcome is win/draw/loss only, never the margin;
 * - weekly rating periods; idle periods inflate RD lazily (`φ² + n·σ²`, capped
 *   at the initial RD);
 * - players under `glickoFreezeBelowReliability` are frozen (no update) but
 *   their fixed rating still counts for opponents;
 * - shown only with reliability ≥ 80 %, ≥ 10 games and RD < 100, else
 *   provisional; level = clamp((r − 900) / 200, 0, 7) with one decimal.
 */
import type {
  EpochMs,
  FormatFamily,
  GameId,
  GlickoParams,
  IsoDateTime,
  MatchOutcome,
  RatingUpdate,
  SkillRating,
  SportId,
  UserId,
} from '../types';
import { DAY_MS, toIso } from '../time';
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from '../config';

/** Glicko → Glicko-2 scale factor (400 / ln 10). */
export const GLICKO2_SCALE = 173.7178;
/** Convergence tolerance of the volatility iteration. */
export const GLICKO2_EPSILON = 0.000001;

/** One game result against one opponent (or opposing composite). */
export interface GlickoResult {
  opponent: Pick<GlickoParams, 'r' | 'rd'>;
  /** 1 win, 0.5 draw, 0 loss. */
  score: 0 | 0.5 | 1;
}

export function scoreOf(outcome: MatchOutcome): 0 | 0.5 | 1 {
  return outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
}

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** RD after `periods` rating periods without games: `√(φ² + n·σ²)`, capped at `maxRd`. */
export function inflateRd(player: GlickoParams, periods: number, maxRd: number): number {
  if (periods <= 0) return player.rd;
  const phi = player.rd / GLICKO2_SCALE;
  const inflated = Math.sqrt(phi * phi + periods * player.sigma * player.sigma) * GLICKO2_SCALE;
  return Math.min(maxRd, inflated);
}

/**
 * One Glicko-2 rating-period update. With no results only RD grows
 * (step 6 with `σ' = σ`), capped at `maxRd`.
 */
export function glicko2Update(player: GlickoParams, results: readonly GlickoResult[], tau: number, maxRd = Infinity): GlickoParams {
  if (results.length === 0) return { r: player.r, rd: inflateRd(player, 1, maxRd), sigma: player.sigma };
  const mu = (player.r - 1500) / GLICKO2_SCALE;
  const phi = player.rd / GLICKO2_SCALE;
  let vInv = 0;
  let sum = 0;
  for (const res of results) {
    const muJ = (res.opponent.r - 1500) / GLICKO2_SCALE;
    const gJ = g(res.opponent.rd / GLICKO2_SCALE);
    const e = expected(mu, muJ, res.opponent.rd / GLICKO2_SCALE);
    vInv += gJ * gJ * e * (1 - e);
    sum += gJ * (res.score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;
  const sigma = newVolatility(phi, player.sigma, v, delta, tau);
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;
  return { r: GLICKO2_SCALE * muNew + 1500, rd: Math.min(maxRd, GLICKO2_SCALE * phiNew), sigma };
}

/** Step 5: σ' by the Illinois algorithm. */
function newVolatility(phi: number, sigma: number, v: number, delta: number, tau: number): number {
  const a = Math.log(sigma * sigma);
  const d2 = delta * delta;
  const p2 = phi * phi;
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (d2 - p2 - v - ex)) / (2 * (p2 + v + ex) * (p2 + v + ex)) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (d2 > p2 + v) {
    B = Math.log(d2 - p2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 1000 && Math.abs(B - A) > GLICKO2_EPSILON; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/** GLK-002: a team's composite opponent: mean r, RMS RD (σ = mean σ). */
export function teamComposite(members: readonly GlickoParams[]): GlickoParams {
  if (members.length === 0) throw new RangeError('empty team');
  let r = 0;
  let rd2 = 0;
  let s = 0;
  for (const m of members) {
    r += m.r;
    rd2 += m.rd * m.rd;
    s += m.sigma;
  }
  const n = members.length;
  return { r: r / n, rd: Math.sqrt(rd2 / n), sigma: s / n };
}

/** GLK-005: `clamp((r − 900) / 200, 0, 7)` rounded to one decimal. */
export function glickoLevel(r: number): number {
  const level = Math.min(7, Math.max(0, (r - 900) / 200));
  return Math.round(level * 10) / 10;
}

/** GLK-004: true unless reliability ≥ min, games ≥ min and RD < max. `null` reliability (new user) is provisional. */
export function isProvisional(
  rating: Pick<SkillRating, 'games' | 'rd'>,
  reliability: number | null | undefined,
  config: Pick<DomainConfig, 'glickoDisplayMinReliability' | 'glickoDisplayMinGames' | 'glickoDisplayMaxRd'> = DEFAULT_DOMAIN_CONFIG,
): boolean {
  return !(
    reliability != null &&
    reliability >= config.glickoDisplayMinReliability &&
    rating.games >= config.glickoDisplayMinGames &&
    rating.rd < config.glickoDisplayMaxRd
  );
}

/**
 * GLK-004: reliability below the freeze threshold excludes a player from updates.
 * A `null`/missing reliability (a new user with fewer than `reliabilityMinGames`
 * commitments) is frozen too (security review #2 L4): throwaway accounts cannot
 * move ratings before they have a reliability record. Frozen players still count
 * for opponents with their fixed (or initial) rating.
 */
export function isFrozen(reliability: number | null | undefined, config: Pick<DomainConfig, 'glickoFreezeBelowReliability'> = DEFAULT_DOMAIN_CONFIG): boolean {
  return reliability == null || reliability < config.glickoFreezeBelowReliability;
}

/** GLK-001: format family per sport and players per side; `null` for unrated sports (running). */
export function formatFamilyFor(sport: SportId, playersPerSide: number): FormatFamily | null {
  switch (sport) {
    case 'football':
      return playersPerSide <= 7 ? 'small_sided' : 'full_sided';
    case 'basketball':
      return playersPerSide <= 3 ? 'half_court' : 'full_court';
    case 'tennis':
    case 'padel':
      return playersPerSide <= 1 ? 'singles' : 'doubles';
    case 'volleyball':
      return playersPerSide <= 2 ? 'pairs' : 'teams';
    case 'running':
      return null;
  }
}

// ---------------------------------------------------------------- rating periods

/** Monday 1970-01-05T00:00Z, the origin of period indices. */
const PERIOD_ORIGIN = Date.UTC(1970, 0, 5);

/** Index of the rating period containing `epochMs` (UTC, periods start on Mondays). */
export function ratingPeriodIndex(epochMs: EpochMs, periodDays = 7): number {
  return Math.floor((epochMs - PERIOD_ORIGIN) / (periodDays * DAY_MS));
}

function isoWeekLabel(mondayMs: EpochMs): string {
  const thursday = new Date(mondayMs + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Key of a period: ISO week `YYYY-Www` for 7-day periods, else `P<days>-<index>`. */
export function ratingPeriodKey(index: number, periodDays = 7): string {
  return periodDays === 7 ? isoWeekLabel(PERIOD_ORIGIN + index * 7 * DAY_MS) : `P${periodDays}-${index}`;
}

/** Inverse of {@link ratingPeriodKey}; throws `RangeError` for a malformed key. */
export function parseRatingPeriodKey(key: string, periodDays = 7): number {
  if (periodDays === 7) {
    const m = /^(\d{4})-W(\d{2})$/.exec(key);
    if (!m) throw new RangeError(`Invalid period key: ${key}`);
    const jan4 = Date.UTC(Number(m[1]), 0, 4);
    const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
    return Math.round((monday + (Number(m[2]) - 1) * 7 * DAY_MS - PERIOD_ORIGIN) / (7 * DAY_MS));
  }
  const m = /^P(\d+)-(-?\d+)$/.exec(key);
  if (!m || Number(m[1]) !== periodDays) throw new RangeError(`Invalid period key: ${key}`);
  return Number(m[2]);
}

/** A GLK-003-eligible game to rate (callers filter with `gameRatingEligibility`). */
export interface RatedGameInput {
  gameId: GameId;
  sport: SportId;
  formatFamily: FormatFamily;
  endsAt: IsoDateTime;
  /** Players per side (verified participants as published before kickoff). */
  teams: readonly (readonly UserId[])[];
  /** One score per side; only the order matters (win/draw/loss). */
  teamScores: readonly number[];
}

export interface RatingPeriodInput {
  /** Period key (see {@link ratingPeriodKey}). */
  period: string;
  games: readonly RatedGameInput[];
  /** Current rows of the involved players (any sport/family; matched by key). */
  ratings: readonly SkillRating[];
  /** Reliability score 0..1 per user (`null`/missing = new → frozen, L4). */
  reliability: Readonly<Record<UserId, number | null>>;
}

export interface RatingPeriodOutput {
  updates: RatingUpdate[];
  /** New rows for every non-frozen updated player. */
  ratings: SkillRating[];
}

function initial(config: DomainConfig): GlickoParams {
  return { r: config.glickoInitialRating, rd: config.glickoInitialRd, sigma: config.glickoInitialSigma };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Processes one rating period (idempotent: players whose `lastPeriod` is this
 * period or later are skipped). All games use the ratings at the start of the
 * period. Output is sorted by sport, family, then user id.
 */
export function processRatingPeriod(input: RatingPeriodInput, config: DomainConfig = DEFAULT_DOMAIN_CONFIG, now: EpochMs): RatingPeriodOutput {
  const days = config.glickoRatingPeriodDays;
  const periodIdx = parseRatingPeriodKey(input.period, days);
  const rowKey = (sport: string, family: string, user: string) => `${sport}|${family}|${user}`;
  const rows = new Map(input.ratings.map((r) => [rowKey(r.sport, r.formatFamily, r.userId), r]));
  const groups = new Map<string, RatedGameInput[]>();
  for (const game of input.games) {
    const k = `${game.sport}|${game.formatFamily}`;
    groups.set(k, [...(groups.get(k) ?? []), game]);
  }
  const out: RatingPeriodOutput = { updates: [], ratings: [] };
  for (const k of [...groups.keys()].sort(cmp)) {
    const games = groups.get(k) as RatedGameInput[];
    const { sport, formatFamily } = games[0] as RatedGameInput;
    const start = new Map<UserId, GlickoParams>();
    const skip = new Set<UserId>();
    const paramsOf = (u: UserId): GlickoParams => {
      let p = start.get(u);
      if (!p) {
        const row = rows.get(rowKey(sport, formatFamily, u));
        if (!row) p = initial(config);
        else {
          const last = row.lastPeriod === null ? null : parseRatingPeriodKey(row.lastPeriod, days);
          if (last !== null && last >= periodIdx) skip.add(u);
          const idle = last === null ? 0 : periodIdx - last - 1;
          p = { r: row.r, rd: inflateRd(row, idle, config.glickoInitialRd), sigma: row.sigma };
        }
        start.set(u, p);
      }
      return p;
    };
    const results = new Map<UserId, GlickoResult[]>();
    const played = new Map<UserId, number>();
    for (const game of games) {
      if (game.teams.length !== game.teamScores.length) throw new RangeError(`teams/scores mismatch in ${game.gameId}`);
      const composites = game.teams.map((team) => teamComposite(team.map(paramsOf)));
      game.teams.forEach((team, i) => {
        for (const u of team) {
          played.set(u, (played.get(u) ?? 0) + 1);
          const list = results.get(u) ?? [];
          game.teams.forEach((_, j) => {
            if (j === i) return;
            const diff = (game.teamScores[i] as number) - (game.teamScores[j] as number);
            list.push({ opponent: composites[j] as GlickoParams, score: diff > 0 ? 1 : diff < 0 ? 0 : 0.5 });
          });
          results.set(u, list);
        }
      });
    }
    for (const u of [...results.keys()].sort(cmp)) {
      if (skip.has(u)) continue;
      const row = rows.get(rowKey(sport, formatFamily, u));
      const stored: GlickoParams = row ? { r: row.r, rd: row.rd, sigma: row.sigma } : initial(config);
      const rel = input.reliability[u];
      const dedupeKey = `rating:${u}:${sport}:${formatFamily}:${input.period}`;
      if (isFrozen(rel, config)) {
        out.updates.push({ userId: u, sport, formatFamily, period: input.period, before: stored, after: stored, gamesAdded: 0, frozen: true, dedupeKey });
        continue;
      }
      const after = glicko2Update(start.get(u) as GlickoParams, results.get(u) as GlickoResult[], config.glickoTau, config.glickoInitialRd);
      const gamesAdded = played.get(u) as number;
      const games = (row?.games ?? 0) + gamesAdded;
      out.updates.push({ userId: u, sport, formatFamily, period: input.period, before: stored, after, gamesAdded, frozen: false, dedupeKey });
      out.ratings.push({
        userId: u,
        sport,
        formatFamily,
        ...after,
        games,
        provisional: isProvisional({ games, rd: after.rd }, rel, config),
        level: glickoLevel(after.r),
        lastPeriod: input.period,
        updatedAt: toIso(now),
      });
    }
  }
  return out;
}

/**
 * The rating as of `now` for display: RD inflated for idle periods since
 * `lastPeriod`, provisional flag and level recomputed with the current reliability.
 */
export function currentSkillRating(row: SkillRating, reliability: number | null, config: DomainConfig = DEFAULT_DOMAIN_CONFIG, now: EpochMs): SkillRating {
  const days = config.glickoRatingPeriodDays;
  const idle = row.lastPeriod === null ? 0 : ratingPeriodIndex(now, days) - parseRatingPeriodKey(row.lastPeriod, days) - 1;
  const rd = inflateRd(row, idle, config.glickoInitialRd);
  return { ...row, rd, provisional: isProvisional({ games: row.games, rd }, reliability, config), level: glickoLevel(row.r) };
}
