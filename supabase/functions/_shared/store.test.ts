import { describe, expect, it } from 'vitest';
import { createStore } from '#shared/store';
import type { Filter, SupabaseClient } from '#shared/supabase';

type Call = { op: string; table: string; filters?: readonly Filter[]; body?: unknown; opts?: unknown };

function fakeClient(responses: Record<string, unknown[]>, calls: Call[], label = 'admin'): SupabaseClient {
  const take = (table: string) => (responses[table]?.shift() ?? []) as Record<string, unknown>[];
  return {
    rpc: async (fn, args) => { calls.push({ op: `${label}.rpc`, table: fn, body: args }); return take(`rpc:${fn}`) as never; },
    select: async (table, o) => { calls.push({ op: `${label}.select`, table, filters: o?.filters }); return take(table) as never; },
    insert: async (table, rows, opts) => { calls.push({ op: `${label}.insert`, table, body: rows, opts }); return take(`insert:${table}`) as never; },
    update: async (table, filters, patch) => { calls.push({ op: `${label}.update`, table, filters, body: patch }); return take(`update:${table}`) as never; },
    remove: async (table, filters) => { calls.push({ op: `${label}.remove`, table, filters }); return 1; },
    deleteAuthUser: async (id) => { calls.push({ op: `${label}.deleteAuthUser`, table: id }); },
    broadcast: async (m) => { calls.push({ op: `${label}.broadcast`, table: 'realtime', body: m }); },
  };
}

describe('Supabase store', () => {
  it('applies effects through the service-role apply_effects RPC and broadcasts on private game channels', async () => {
    const calls: Call[] = [];
    const store = createStore({ admin: fakeClient({}, calls), asUser: () => fakeClient({}, calls, 'user') });
    await store.applyEffects([{ type: 'MuteChat', userId: 'u', until: '2026-11-11T00:00:00.000Z' }]);
    await store.applyEffects([]);
    await store.broadcast('g1', { type: 'retracted', messageId: 'm', at: 't' });
    expect(calls).toEqual([
      { op: 'admin.rpc', table: 'apply_effects', body: { p_effects: [{ type: 'MuteChat', userId: 'u', until: '2026-11-11T00:00:00.000Z' }] } },
      { op: 'admin.broadcast', table: 'realtime', body: [{ topic: 'game:g1', event: 'retracted', payload: { type: 'retracted', messageId: 'm', at: 't' }, private: true }] },
    ]);
  });

  it('reads the check-in pin and runs delete_my_account as the user (RLS)', async () => {
    const calls: Call[] = [];
    const user = fakeClient({ game_views: [[{ id: 'g', status: 'scheduled', starts_at: '2026-11-10 18:00:00+00', ends_at: '2026-11-10 20:00:00+00', lat: 32.1, lng: 34.8 }]] }, calls, 'user');
    const store = createStore({ admin: fakeClient({}, calls), asUser: () => user });
    await expect(store.loadGame('jwt', 'g')).resolves.toEqual({ id: 'g', status: 'scheduled', startsAt: '2026-11-10T18:00:00.000Z', endsAt: '2026-11-10T20:00:00.000Z', location: { lat: 32.1, lng: 34.8 } });
    await store.deleteMyAccount('jwt');
    expect(calls.map((c) => c.op)).toEqual(['user.select', 'user.rpc']);
  });

  it('records check-in verdicts through record_checkin_verdict', async () => {
    const calls: Call[] = [];
    const store = createStore({ admin: fakeClient({ 'rpc:record_checkin_verdict': [{ outcome: 'verified' }] as never }, calls), asUser: () => fakeClient({}, calls) });
    const verdict = { outcome: 'verified' as const, method: 'gps' as const, distanceM: 3, signals: [] };
    await store.recordVerdict('g', 'u', verdict);
    expect(calls[0]).toEqual({ op: 'admin.rpc', table: 'record_checkin_verdict', body: { p_game_id: 'g', p_user_id: 'u', p_verdict: verdict } });
  });

  it('updates payments with compare-and-set filters', async () => {
    const calls: Call[] = [];
    const store = createStore({ admin: fakeClient({ 'update:payments': [[{ id: 'p' }]] }, calls), asUser: () => fakeClient({}, calls) });
    const ok = await store.updatePayment('p', { status: 'succeeded', depositState: 'setup', providerRef: null }, { status: 'requires_capture', depositState: 'held', providerRef: 'pi_1', step: 'hold' });
    expect(ok).toBe(true);
    expect(calls[0]).toEqual({
      op: 'admin.update',
      table: 'payments',
      filters: [['id', 'eq', 'p'], ['status', 'eq', 'succeeded'], ['deposit_state', 'eq', 'setup'], ['provider_ref', 'is', null]],
      body: { status: 'requires_capture', deposit_state: 'held', provider_ref: 'pi_1', step: 'hold' },
    });
  });

  it('loads the chat trust state with normalised timestamps (dedupes the just-retained block)', async () => {
    const calls: Call[] = [];
    const store = createStore({
      admin: fakeClient({ sanctions: [[]], moderation_retained: [[{ game_id: 'g', retained_at: '2026-11-10 17:00:00+00' }]] }, calls),
      asUser: () => fakeClient({}, calls),
    });
    const { DEFAULT_TRUST_CONFIG } = await import('@st/domain');
    const st = await store.loadChatTrustState('u', Date.parse('2026-11-10T17:00:00.000Z'), DEFAULT_TRUST_CONFIG);
    expect(st.chatBlocks).toEqual([{ gameId: 'g', at: '2026-11-10T17:00:00.000Z' }]);
  });
});
