import { describe, expect, it, vi } from 'vitest';
import { chunk, createExpoPushSender, isExpoPushToken } from '#shared/push';

describe('Expo push sender', () => {
  it('posts a batch and maps tickets in order', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ status: 'ok', id: 't1' }, { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }] })),
    );
    const sender = createExpoPushSender({ accessToken: 'expo-token', fetch: fetchFn as unknown as typeof fetch });
    const tickets = await sender.send([
      { to: 'ExponentPushToken[a]', title: 't', body: 'b', data: {} },
      { to: 'ExponentPushToken[b]', title: 't', body: 'b', data: {} },
    ]);
    expect(tickets).toEqual([{ status: 'ok', id: 't1' }, { status: 'error', error: 'DeviceNotRegistered', message: 'gone' }]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer expo-token');
    await expect(sender.send(Array.from({ length: 101 }, () => ({ to: 'x', title: '', body: '', data: {} })))).rejects.toThrow(/too large/);
  });
  it('chunks and validates tokens', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(isExpoPushToken('ExponentPushToken[xyz]')).toBe(true);
    expect(isExpoPushToken('fcm:abc')).toBe(false);
  });
});
