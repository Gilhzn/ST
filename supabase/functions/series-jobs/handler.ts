/**
 * series-jobs: cron wrapper for recurring series (GAME-010/011). Internal callers only.
 *
 * POST { job?: 'all' | 'generate' | 'autojoin' }  (default `all`)
 * → { generated, autojoin, push, errors }
 *
 * 1. `generate_occurrences()`: keeps every active series' rolling horizon (advisory-locked, idempotent).
 * 2. `always_in_autojoin()`: T−48h reconfirmation requests, T−24h releases (no card) and
 *    GAME-011 leave-the-roster offers. The RPC writes the notifications (deduped).
 * 3. Push: the `series_reconfirm` / `series_auto_released` / `roster_leave_offer`
 *    notifications created by this run are handed to `push-dispatch` in batches,
 *    unless the `notifications` INSERT webhook already delivers them
 *    (`PUSH_VIA_WEBHOOK=1`, which avoids double pushes).
 *
 * Each step runs even if an earlier one failed; any failure → 503 so the scheduler retries
 * (every step is idempotent). Push is best effort and never fails the run.
 */
import { StError, type IsoDateTime, type Phase15NotificationKind } from '@st/domain';
import { requireInternalCaller } from '#shared/auth';
import { PUSH_DISPATCH_BATCH, pushNotifications, type PushDispatcher, type PushDispatchResult } from '#shared/functions-client';
import { json, readJson, route } from '#shared/http';
import type { Logger } from '#shared/log';
import type { Clock } from '#shared/runtime';

export interface SeriesJobsStore {
  generateOccurrences(): Promise<number>;
  alwaysInAutojoin(): Promise<number>;
  /** Ids of notifications of `kinds` created at or after `since`, oldest first. */
  notificationIdsSince(kinds: readonly Phase15NotificationKind[], since: IsoDateTime, limit: number): Promise<string[]>;
}

export interface SeriesJobsDeps {
  internalSecrets: readonly string[];
  store: SeriesJobsStore;
  /** `null` when the notifications webhook delivers pushes (`PUSH_VIA_WEBHOOK=1`). */
  push: PushDispatcher | null;
  clock: Clock;
  log: Logger;
}

export const SERIES_PUSH_KINDS: readonly Phase15NotificationKind[] = ['series_reconfirm', 'series_auto_released', 'roster_leave_offer'];
/** Clock skew allowance between the function and the database when selecting this run's notifications. */
const SKEW_MS = 5_000;

type Job = 'all' | 'generate' | 'autojoin';

export interface SeriesJobsResult {
  generated: number | null;
  autojoin: number | null;
  push: PushDispatchResult | { skipped: 'webhook' } | { error: string } | null;
  errors: { step: string; code: string }[];
}

export async function handle(req: Request, deps: SeriesJobsDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'] }, async () => {
    requireInternalCaller(req, deps.internalSecrets);
    // pg_cron may send an empty body: treat anything unparseable as the default job.
    const input = await readJson(req, 4 * 1024).catch((): Record<string, unknown> => ({}));
    const job = (input['job'] ?? 'all') as Job;
    if (job !== 'all' && job !== 'generate' && job !== 'autojoin') throw new StError('validation', 'job must be all, generate or autojoin', { field: 'job' });

    const startedAt = new Date(deps.clock.now() - SKEW_MS).toISOString();
    const result: SeriesJobsResult = { generated: null, autojoin: null, push: null, errors: [] };
    const step = async (name: string, fn: () => Promise<number>): Promise<number | null> => {
      try {
        return await fn();
      } catch (err) {
        deps.log.error('series_jobs.step_failed', { step: name, error: err });
        result.errors.push({ step: name, code: err instanceof StError ? err.code : 'unknown' });
        return null;
      }
    };
    if (job !== 'autojoin') result.generated = await step('generate_occurrences', () => deps.store.generateOccurrences());
    if (job !== 'generate') result.autojoin = await step('always_in_autojoin', () => deps.store.alwaysInAutojoin());

    if (result.autojoin) {
      if (!deps.push) {
        result.push = { skipped: 'webhook' };
      } else {
        try {
          const ids = await deps.store.notificationIdsSince(SERIES_PUSH_KINDS, startedAt, 5 * PUSH_DISPATCH_BATCH);
          result.push = await pushNotifications(deps.push, ids, deps.log);
        } catch (error) {
          deps.log.warn('series_jobs.push_lookup_failed', { error });
          result.push = { error: 'unavailable' };
        }
      }
    }
    deps.log.info('series_jobs.ran', { job, generated: result.generated, autojoin: result.autojoin, push: result.push, errors: result.errors.length });
    return json(result, result.errors.length > 0 ? 503 : 200);
  });
}
