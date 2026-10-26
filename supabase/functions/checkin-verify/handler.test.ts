import { describe, expect, it } from 'vitest';
import { offsetMeters, type CheckInVerdict } from '@st/domain';
import { staticConfig } from '#shared/config';
import { allowAll, body, fakeAuth, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { handle, type CheckinDeps, type CheckinGame, type CheckinStore, type IntegrityVerifier } from './handler';

const START = Date.parse('2026-11-10T18:00:00.000Z');
const NOW = START - 10 * 60_000;
const GAME = uuid(1);
const PIN = { lat: 32.0853, lng: 34.7818 };

class Store implements CheckinStore {
  game: CheckinGame | null = { id: GAME, status: 'scheduled', startsAt: new Date(START).toISOString(), endsAt: new Date(START + 2 * 3_600_000).toISOString(), location: PIN };
  participant: { status: 'approved' | 'requested'; attendance: 'unknown' | 'verified' } | null = { status: 'approved', attendance: 'unknown' };
  recorded: CheckInVerdict[] = [];
  loadGame = async () => this.game;
  loadParticipant = async () => this.participant;
  recordVerdict = async (_g: string, _u: string, v: CheckInVerdict) => { this.recorded.push(v); return v; };
}

function setup(integrity: IntegrityVerifier = { verify: async () => 'unavailable' }) {
  const store = new Store();
  const log = memoryLogger();
  const deps: CheckinDeps = { auth: fakeAuth({ tok: uuid(10) }), store, integrity, config: staticConfig(), rateLimiter: allowAll, clock: mutableClock(NOW), log, cors: { allowedOrigins: [] } };
  const call = (b: Record<string, unknown>) => handle(post('checkin-verify', { gameId: GAME, ...b }, { token: 'tok' }), deps);
  return { store, call, log };
}

const near = (north: number, t: number, extra: Record<string, unknown> = {}) => ({ ...offsetMeters(PIN, north, 0), accuracyM: 8, timestamp: t, ...extra });

describe('checkin-verify', () => {
  it('happy path: two accurate fixes near the pin → verified and recorded', async () => {
    const { call, store, log } = setup();
    const res = await call({ samples: [near(10, NOW - 20_000), near(12, NOW - 10_000)] });
    expect(res.status).toBe(200);
    const v = await body<CheckInVerdict>(res);
    expect(v).toMatchObject({ outcome: 'verified', method: 'gps', signals: [] });
    expect(store.recorded).toHaveLength(1);
    const logs = JSON.stringify(log.records);
    expect(logs).not.toContain(String(PIN.lat).slice(0, 6));
  });

  it('mock location (spoofing) → rejected with QR / peer / host fallbacks, never a sanction', async () => {
    const { call, store } = setup();
    const v = await body<CheckInVerdict>(await call({ samples: [near(10, NOW - 20_000, { isMock: true }), near(12, NOW - 10_000)] }));
    expect(v).toEqual({ outcome: 'rejected', method: 'gps', reason: 'suspected_spoofing', fallbacks: ['qr', 'peer', 'host'], signals: ['mock_location'] });
    expect(store.recorded[0]).toEqual(v);
  });

  it('too far → retryable rejection', async () => {
    const { call } = setup();
    expect(await body(await call({ samples: [near(400, NOW - 20_000), near(402, NOW - 10_000)] }))).toMatchObject({ outcome: 'rejected', reason: 'too_far', fallbacks: ['gps', 'qr', 'peer', 'host'] });
  });

  it('failed device integrity downgrades to fallbacks', async () => {
    const { call } = setup({ verify: async () => 'fail' });
    const v = await body<CheckInVerdict>(await call({ samples: [near(10, NOW - 20_000), near(12, NOW - 10_000)], integrity: { platform: 'android', token: 'play-integrity-token' } }));
    expect(v).toMatchObject({ outcome: 'rejected', reason: 'suspected_spoofing', fallbacks: ['qr', 'peer', 'host'] });
  });

  it('non-participants and hidden pins get not_participant (not recorded); missing game → 404', async () => {
    const { call, store } = setup();
    store.participant = { status: 'requested', attendance: 'unknown' };
    expect(await body(await call({ samples: [near(10, NOW - 20_000), near(12, NOW - 10_000)] }))).toMatchObject({ reason: 'not_participant' });
    expect(store.recorded).toHaveLength(0);
    store.game = null;
    expect((await call({ samples: [] })).status).toBe(404);
  });

  it('already verified is idempotent', async () => {
    const { call, store } = setup();
    store.participant = { status: 'approved', attendance: 'verified' };
    expect(await body(await call({ samples: [] }))).toMatchObject({ outcome: 'verified' });
    expect(store.recorded).toHaveLength(0);
  });

  it('validates samples', async () => {
    const { call } = setup();
    expect((await call({ samples: [{ lat: 91, lng: 0, accuracyM: 5, timestamp: 1 }] })).status).toBe(400);
    expect((await call({ samples: Array.from({ length: 11 }, (_, i) => near(1, NOW - i)) })).status).toBe(400);
    expect((await call({ samples: [{ ...near(1, NOW), isMock: 'yes' }] })).status).toBe(400);
  });
});
