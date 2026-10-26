import { describe, expect, it } from 'vitest';
import { StError } from '@st/domain';
import type { PushDispatcher } from '#shared/functions-client';
import { INTERNAL_SECRET, body, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { handle, type SeriesJobsDeps, type SeriesJobsResult } from './handler';

const NOW = Date.parse('2026-11-08T06:00:00.000Z');

function setup(opts: { push?: boolean } = {}) {
  const calls: string[] = [];
  const dispatched: string[][] = [];
  let generateFails = false;
  let autojoin = 3;
  const ids = Array.from({ length: 3 }, (_, i) => uuid(900 + i));
  const push: PushDispatcher = {
    dispatch: async (batch) => {
      dispatched.push([...batch]);
      return { notifications: batch.length, sent: batch.length, failed: 0 };
    },
  };
  const deps: SeriesJobsDeps = {
    internalSecrets: [INTERNAL_SECRET],
    store: {
      generateOccurrences: async () => {
        calls.push('generate');
        if (generateFails) throw new StError('unavailable', 'db');
        return 7;
      },
      alwaysInAutojoin: async () => {
        calls.push('autojoin');
        return autojoin;
      },
      notificationIdsSince: async (kinds, since, limit) => {
        calls.push(`ids:${kinds.join(',')}:${since}:${limit}`);
        return ids;
      },
    },
    push: opts.push === false ? null : push,
    clock: mutableClock(NOW),
    log: memoryLogger(),
  };
  const run = (b: unknown = {}, token = INTERNAL_SECRET) => handle(post('series-jobs', b, { token }), deps);
  return { deps, calls, dispatched, run, failGenerate: () => { generateFails = true; }, setAutojoin: (n: number) => { autojoin = n; } };
}

describe('series-jobs', () => {
  it('internal callers only', async () => {
    const { run, calls } = setup();
    expect((await run({}, 'user-jwt')).status).toBe(401);
    expect((await handle(post('series-jobs', {}), setup().deps)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('generates occurrences, runs always-in, then pushes this run’s reconfirm/release notifications via push-dispatch', async () => {
    const { run, calls, dispatched } = setup();
    const res = await run();
    expect(res.status).toBe(200);
    expect(await body<SeriesJobsResult>(res)).toEqual({ generated: 7, autojoin: 3, push: { notifications: 3, sent: 3, failed: 0 }, errors: [] });
    expect(calls).toEqual(['generate', 'autojoin', `ids:series_reconfirm,series_auto_released,roster_leave_offer:2026-11-08T05:59:55.000Z:2500`]);
    expect(dispatched).toEqual([[uuid(900), uuid(901), uuid(902)]]);
  });

  it('single jobs; nothing to push when always-in did nothing; webhook mode skips direct push', async () => {
    const a = setup();
    expect(await body(await a.run({ job: 'generate' }))).toMatchObject({ generated: 7, autojoin: null, push: null });
    expect(a.calls).toEqual(['generate']);
    const b = setup();
    b.setAutojoin(0);
    expect(await body(await b.run({ job: 'autojoin' }))).toMatchObject({ generated: null, autojoin: 0, push: null });
    expect(b.dispatched).toEqual([]);
    const c = setup({ push: false });
    expect(await body(await c.run())).toMatchObject({ push: { skipped: 'webhook' } });
    expect((await a.run({ job: 'nope' })).status).toBe(400);
  });

  it('a failing step does not stop the others; the run reports 503 for a retry', async () => {
    const t = setup();
    t.failGenerate();
    const res = await t.run();
    expect(res.status).toBe(503);
    expect(await body(res)).toMatchObject({ generated: null, autojoin: 3, errors: [{ step: 'generate_occurrences', code: 'unavailable' }] });
    expect(t.calls).toContain('autojoin');
  });

  it('push failures are best effort', async () => {
    const t = setup();
    t.deps.push = { dispatch: async () => { throw new StError('unavailable', 'down'); } };
    const res = await t.run();
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ push: { error: 'unavailable' } });
  });
});
