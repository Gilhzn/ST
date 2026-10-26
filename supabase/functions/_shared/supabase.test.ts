import { describe, expect, it } from 'vitest';
import { buildQuery, createSupabaseClient } from '#shared/supabase';

function recorder(responses: { status?: number; body?: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: [] };
    return Promise.resolve(new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status ?? 200 }));
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('supabase client', () => {
  it('encodes filters safely', () => {
    expect(buildQuery([['id', 'eq', 'a b'], ['x', 'in', ['p"q', 3]], ['r', 'is', null]], { select: '*' })).toBe(
      '?id=eq.a+b&x=in.%28%22p%5C%22q%22%2C3%29&r=is.null&select=*',
    );
    expect(() => buildQuery([['bad;col', 'eq', 1]])).toThrow();
  });

  it('calls RPCs with the service key and maps ST: errors', async () => {
    const { calls, fetchFn } = recorder([{ body: { applied: 2 } }, { status: 400, body: { message: 'ST:forbidden: permanent_ban is moderator-only' } }]);
    const db = createSupabaseClient({ url: 'https://p.supabase.co/', apiKey: 'service', fetch: fetchFn });
    await expect(db.rpc('apply_effects', { p_effects: [] })).resolves.toEqual({ applied: 2 });
    expect(calls[0]?.url).toBe('https://p.supabase.co/rest/v1/rpc/apply_effects');
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe('Bearer service');
    await expect(db.rpc('apply_effects', {})).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('acts as the user when given an access token', async () => {
    const { calls, fetchFn } = recorder([{ body: [{ id: 1 }] }]);
    const db = createSupabaseClient({ url: 'https://p.supabase.co', apiKey: 'anon', accessToken: 'jwt', fetch: fetchFn });
    await db.select('game_views', { columns: 'id,lat', filters: [['id', 'eq', 'g1']], limit: 1, order: { column: 'id', ascending: false } });
    expect(calls[0]?.url).toBe('https://p.supabase.co/rest/v1/game_views?id=eq.g1&select=id%2Clat&order=id.desc&limit=1');
    expect((calls[0]?.init.headers as Record<string, string>)['apikey']).toBe('anon');
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe('Bearer jwt');
  });

  it('upserts with ignore-duplicates, refuses unfiltered writes, broadcasts and deletes auth users idempotently', async () => {
    const { calls, fetchFn } = recorder([{ body: [] }, {}, { status: 404, body: { msg: 'User not found' } }]);
    const db = createSupabaseClient({ url: 'https://p.supabase.co', apiKey: 'service', fetch: fetchFn });
    await db.insert('payment_events', { id: 'evt' }, { onConflict: 'id', ignoreDuplicates: true });
    expect((calls[0]?.init.headers as Record<string, string>)['prefer']).toBe('return=representation,resolution=ignore-duplicates');
    expect(calls[0]?.url).toContain('on_conflict=id');
    await expect(db.update('payments', [], {})).rejects.toThrow(/unfiltered/);
    await expect(db.remove('payments', [])).rejects.toThrow(/unfiltered/);
    await db.broadcast([{ topic: 'game:1', event: 'message', payload: { a: 1 }, private: true }]);
    expect(calls[1]?.url).toBe('https://p.supabase.co/realtime/v1/api/broadcast');
    await expect(db.deleteAuthUser('u1')).resolves.toBeUndefined();
  });

  it('maps network failures to unavailable', async () => {
    const db = createSupabaseClient({ url: 'https://p', apiKey: 'k', fetch: (() => Promise.reject(new Error('down'))) as unknown as typeof fetch });
    await expect(db.select('x')).rejects.toMatchObject({ code: 'unavailable' });
  });
});
