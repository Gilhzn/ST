import { describe, expect, it } from 'vitest';
import { DEFAULT_PHASE15_CONFIG, StError } from '@st/domain';
import type { PushDispatcher } from '#shared/functions-client';
import { INTERNAL_SECRET, body, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { handle, levelNotifications, type NewNotificationRow, type RatingChange, type RatingPeriodDeps } from './handler';

const NOW = Date.parse('2026-11-11T03:00:00.000Z');
const A = uuid(10);
const B = uuid(11);
const C = uuid(12);
const D = uuid(13);

/** Displayed by default: reliability 0.9, 12 games, RD 80. */
const change = (userId: string, rBefore: number, rAfter: number, extra: Partial<RatingChange> = {}): RatingChange => ({
  userId, sport: 'football', formatFamily: 'small_sided', period: '2026-W45', rBefore, rAfter, frozen: false, games: 12, rd: 80, reliability: 0.9, ...extra,
});

const DEFAULT_CHANGES = [
  change(A, 1550, 1580), // 3.3 → 3.4: notified
  change(B, 1600, 1601), // 3.5 → 3.5: no change
  change(C, 1500, 1700, { games: 4 }), // provisional (< 10 games)
  change(D, 1300, 1300, { frozen: true, reliability: 0.6 }), // frozen
];

function setup(changes: RatingChange[] = DEFAULT_CHANGES) {
  const notifications = new Map<string, NewNotificationRow & { id: string }>();
  const since: string[] = [];
  const dispatched: string[][] = [];
  let runs = 0;
  let fail = false;
  const push: PushDispatcher = { dispatch: async (ids) => { dispatched.push([...ids]); return { notifications: ids.length, sent: ids.length, failed: 0 }; } };
  const deps: RatingPeriodDeps = {
    internalSecrets: [INTERNAL_SECRET],
    store: {
      runRatingPeriod: async () => {
        runs++;
        if (fail) throw new StError('unavailable', 'db');
        return runs === 1 ? changes.length : 0;
      },
      recentRatingChanges: async (s) => {
        since.push(s);
        return changes;
      },
      loadPhase15Config: async () => DEFAULT_PHASE15_CONFIG,
      notifyMany: async (rows) => {
        const ids: string[] = [];
        for (const r of rows) {
          if (notifications.has(r.dedupeKey)) continue;
          const id = uuid(800 + notifications.size);
          notifications.set(r.dedupeKey, { ...r, id });
          ids.push(id);
        }
        return ids;
      },
    },
    push,
    clock: mutableClock(NOW),
    log: memoryLogger(),
  };
  const run = (token = INTERNAL_SECRET) => handle(post('rating-period', {}, { token }), deps);
  return { deps, run, notifications, since, dispatched, runs: () => runs, fail: () => { fail = true; } };
}

describe('rating-period', () => {
  it('internal callers only', async () => {
    const t = setup();
    expect((await t.run('nope')).status).toBe(401);
    expect(t.runs()).toBe(0);
  });

  it('runs the period job, then notifies displayed level changes ("Your level is now 3.4") and pushes them', async () => {
    const t = setup();
    const res = await t.run();
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ updates: 4, levelChanges: 1, notified: 1, push: { notifications: 1, sent: 1, failed: 0 } });
    expect(t.since).toEqual([new Date(NOW - 8 * 86_400_000).toISOString()]);
    expect([...t.notifications.values()]).toEqual([
      { id: uuid(800), userId: A, kind: 'rating_level_changed', params: { sport: 'football', formatFamily: 'small_sided', level: '3.4', previousLevel: '3.3' }, dedupeKey: `rating_level:${A}:football:small_sided:2026-W45` },
    ]);
    expect(t.dispatched).toEqual([[uuid(800)]]);
  });

  it('idempotent: a re-run neither duplicates notifications nor pushes again', async () => {
    const t = setup();
    await t.run();
    expect(await body(await t.run())).toEqual({ updates: 0, levelChanges: 1, notified: 0, push: null });
    expect(t.notifications.size).toBe(1);
    expect(t.dispatched).toHaveLength(1);
  });

  it('several periods in one run → one notification from the first level to the last', () => {
    const rows = levelNotifications([change(A, 1580, 1610, { period: '2026-W45' }), change(A, 1550, 1580, { period: '2026-W44' })], DEFAULT_PHASE15_CONFIG);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ params: { level: '3.6', previousLevel: '3.3' }, dedupeKey: `rating_level:${A}:football:small_sided:2026-W45` });
    // RD too high or reliability unknown → provisional → silent.
    expect(levelNotifications([change(A, 1550, 1700, { rd: 120 })], DEFAULT_PHASE15_CONFIG)).toEqual([]);
    expect(levelNotifications([change(A, 1550, 1700, { reliability: null })], DEFAULT_PHASE15_CONFIG)).toEqual([]);
  });

  it('webhook mode skips the direct push; DB failure → 503', async () => {
    const t = setup();
    t.deps.push = null;
    expect(await body(await t.run())).toMatchObject({ notified: 1, push: { skipped: 'webhook' } });
    const f = setup();
    f.fail();
    expect((await f.run()).status).toBe(503);
    expect(f.notifications.size).toBe(0);
  });
});
