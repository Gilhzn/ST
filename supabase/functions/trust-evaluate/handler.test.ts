import { describe, expect, it } from 'vitest';
import { createTrustState, type DomainTrustEvent, type Effect } from '@st/domain';
import { staticConfig } from '#shared/config';
import { INTERNAL_SECRET, body, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { eventFromWebhook, handle, subjectOf, type TrustEvaluateDeps, type TrustStore } from './handler';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const USER = uuid(10);

class Store implements TrustStore {
  effects: Effect[] = [];
  loaded: { userId: string; event: DomainTrustEvent }[] = [];
  loadTrustState = async (userId: string, event: DomainTrustEvent) => { this.loaded.push({ userId, event }); return createTrustState(userId); };
  applyEffects = async (e: readonly Effect[]) => { this.effects.push(...e); };
  venueCreator = async () => uuid(20);
}

const setup = () => {
  const store = new Store();
  const deps: TrustEvaluateDeps = { internalSecrets: [INTERNAL_SECRET], store, config: staticConfig(), clock: mutableClock(NOW), log: memoryLogger() };
  return { store, call: (b: unknown, token = INTERNAL_SECRET) => handle(post('trust-evaluate', b, { token }), deps) };
};

describe('trust-evaluate', () => {
  it('internal callers only', async () => {
    expect((await setup().call({ events: [] }, 'x'.repeat(40))).status).toBe(401);
  });

  it('no-show → yellow card effects applied through apply_effects', async () => {
    const { call, store } = setup();
    const res = await body<{ processed: number; effects: Record<string, number> }>(
      await call({ events: [{ type: 'AttendanceFinalized', gameId: uuid(1), userId: USER, attendance: 'no_show_unverified', endsAt: '2026-11-10T20:00:00.000Z' }] }),
    );
    expect(res.processed).toBe(1);
    expect(res.effects['IssueSanction']).toBe(1);
    expect(store.effects.find((e) => e.type === 'IssueSanction')).toMatchObject({ sanction: { kind: 'yellow_card', reasonCode: 'no_show', userId: USER } });
  });

  it('dryRun computes without applying', async () => {
    const { call, store } = setup();
    const res = await body<{ effects: Record<string, number>; dryRun: boolean }>(
      await call({ dryRun: true, events: [{ type: 'AttendanceFinalized', gameId: uuid(1), userId: USER, attendance: 'no_show_unverified', endsAt: '2026-11-10T20:00:00.000Z' }] }),
    );
    expect(res.dryRun).toBe(true);
    expect(res.effects['IssueSanction']).toBe(1);
    expect(store.effects).toHaveLength(0);
  });

  it('accepts database-webhook payloads (user_reports insert → UserReported for the target)', async () => {
    const { call, store } = setup();
    const payload = { type: 'INSERT', table: 'user_reports', record: { id: uuid(30), reporter_id: uuid(11), target_user_id: USER, category: 'harassment', game_id: null, message_id: null, note: 'private note', created_at: '2026-11-12T11:00:00+00:00' } };
    const res = await body<{ processed: number }>(await call(payload));
    expect(res.processed).toBe(1);
    expect(store.loaded[0]).toMatchObject({ userId: USER, event: { type: 'UserReported', report: { note: null, createdAt: '2026-11-12T11:00:00.000Z' } } });
  });

  it('rejects unknown event types and reports per-event errors', async () => {
    const { call } = setup();
    expect((await call({ events: [{ type: 'Bogus' }] })).status).toBe(400);
    const res = await body<{ errors: { code: string }[] }>(await call({ events: [{ type: 'Tick', at: '2026-11-12T12:00:00.000Z' }] }));
    expect(res.errors).toEqual([{ index: 0, code: 'unsupported_subject' }]);
  });

  it('maps subjects', () => {
    expect(subjectOf({ type: 'HostRated', hostId: 'h', gameId: 'g', raterId: 'r', stars: 1, at: 'x' })).toBe('h');
    expect(eventFromWebhook({ type: 'UPDATE', table: 'user_reports', record: {} })).toBeNull();
  });
});
