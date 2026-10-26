/**
 * rating-period: weekly Glicko-2 rating periods (GLK-001..005). Internal callers only (pg_cron).
 *
 * POST {}  → { updates, levelChanges, notified, push }
 *
 * 1. `run_rating_period()` (service role) processes every complete, unprocessed
 *    weekly period in SQL (golden-vector parity with the domain
 *    `processRatingPeriod`; advisory-locked and idempotent) and returns the
 *    number of rating updates.
 * 2. The updates of periods processed in the last {@link LOOKBACK_MS} are read
 *    back (`rating_updates` ⋈ `skill_ratings` ⋈ reliability) and, for every
 *    *displayed* rating (GLK-004: not provisional, not frozen) whose level moved
 *    (GLK-005, one decimal), a notification is written: "Your level is now 3.4"
 *    (`notifications:rating_level_changed`, params `sport`, `formatFamily`,
 *    `level`, `previousLevel`), deduped per user, sport, family and period.
 *    Reading back by period (not by "this run") makes a retry after a failed
 *    notification step complete it without duplicates.
 * 3. Newly inserted notifications go to `push-dispatch` (unless `PUSH_VIA_WEBHOOK=1`).
 */
import {
  glickoLevel,
  isProvisional,
  type FormatFamily,
  type IsoDateTime,
  type Phase15Config,
  type SportId,
  type UserId,
} from '@st/domain';
import { requireInternalCaller } from '#shared/auth';
import { pushNotifications, type PushDispatcher, type PushDispatchResult } from '#shared/functions-client';
import { json, route } from '#shared/http';
import type { Logger } from '#shared/log';
import type { Clock } from '#shared/runtime';

/** One `rating_updates` row with the player's current display inputs. */
export interface RatingChange {
  userId: UserId;
  sport: SportId;
  formatFamily: FormatFamily;
  /** ISO week `YYYY-Www`. */
  period: string;
  rBefore: number;
  rAfter: number;
  /** GLK-004: excluded from updates (reliability < 70 %). */
  frozen: boolean;
  /** Current `skill_ratings.games` / `rd` and `profiles.reliability_score` (GLK-004 display gate). */
  games: number;
  rd: number;
  reliability: number | null;
}

export interface NewNotificationRow {
  userId: UserId;
  kind: string;
  params: Readonly<Record<string, string | number>>;
  dedupeKey: string;
}

export interface RatingPeriodStore {
  /** `run_rating_period()` (service role). Returns the number of rating updates written. */
  runRatingPeriod(): Promise<number>;
  /** Updates of rating periods processed at or after `processedSince`, oldest period first. */
  recentRatingChanges(processedSince: IsoDateTime): Promise<RatingChange[]>;
  /** `phase15_config` (display thresholds). */
  loadPhase15Config(): Promise<Phase15Config>;
  /** Inserts notifications (`on conflict (dedupe_key) do nothing`); returns ids of the rows actually inserted. */
  notifyMany(rows: readonly NewNotificationRow[]): Promise<string[]>;
}

export interface RatingPeriodDeps {
  internalSecrets: readonly string[];
  store: RatingPeriodStore;
  push: PushDispatcher | null;
  clock: Clock;
  log: Logger;
}

/** Notification kind for a displayed level change (`notification_kind` enum value + `notifications:<kind>` copy). */
export const RATING_LEVEL_KIND = 'rating_level_changed';
/** Periods processed this long ago are still (re)notified; dedupe keys make it idempotent. */
export const LOOKBACK_MS = 8 * 86_400_000;

/**
 * One notification per user, sport and family whose displayed level moved, from
 * the first `rBefore` to the last `rAfter` in `changes` (several periods may be
 * processed in one run). Provisional and frozen ratings are never announced.
 */
export function levelNotifications(changes: readonly RatingChange[], config: Phase15Config): NewNotificationRow[] {
  const byKey = new Map<string, RatingChange[]>();
  for (const c of changes) {
    const k = `${c.userId}|${c.sport}|${c.formatFamily}`;
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }
  const out: NewNotificationRow[] = [];
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
    const first = sorted[0] as RatingChange;
    const last = sorted[sorted.length - 1] as RatingChange;
    if (last.frozen || !Number.isFinite(last.rAfter)) continue;
    if (isProvisional({ games: last.games, rd: last.rd }, last.reliability, config)) continue;
    const before = glickoLevel(first.rBefore);
    const after = glickoLevel(last.rAfter);
    if (before === after) continue;
    out.push({
      userId: last.userId,
      kind: RATING_LEVEL_KIND,
      // Strings so ICU renders exactly one decimal in every locale ("3.4", never "3.40" or "3").
      params: { sport: last.sport, formatFamily: last.formatFamily, level: after.toFixed(1), previousLevel: before.toFixed(1) },
      dedupeKey: `rating_level:${last.userId}:${last.sport}:${last.formatFamily}:${last.period}`,
    });
  }
  return out;
}

export async function handle(req: Request, deps: RatingPeriodDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'] }, async () => {
    requireInternalCaller(req, deps.internalSecrets);
    const now = deps.clock.now();
    const updates = await deps.store.runRatingPeriod();
    const [changes, config] = await Promise.all([deps.store.recentRatingChanges(new Date(now - LOOKBACK_MS).toISOString()), deps.store.loadPhase15Config()]);
    const rows = levelNotifications(changes, config);
    const ids = rows.length > 0 ? await deps.store.notifyMany(rows) : [];
    let push: PushDispatchResult | { error: string } | { skipped: 'webhook' } | null = null;
    if (ids.length > 0) push = deps.push ? await pushNotifications(deps.push, ids, deps.log) : { skipped: 'webhook' };
    deps.log.info('rating_period.ran', { updates, recentChanges: changes.length, levelChanges: rows.length, notified: ids.length });
    return json({ updates, levelChanges: rows.length, notified: ids.length, push });
  });
}
