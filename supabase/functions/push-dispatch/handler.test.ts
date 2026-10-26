import { describe, expect, it } from 'vitest';
import type { Locale, Notification } from '@st/domain';
import { createLocalizer } from '#shared/i18n';
import type { PushMessage, PushSender, PushTicket } from '#shared/push';
import { INTERNAL_SECRET, body, memoryLogger, post, uuid } from '../_test/helpers';
import { handle, type PushDeps, type PushStore, type PushToken } from './handler';

const catalogs = {
  en: { join_approved: { title: 'You’re in', body: 'The host approved you for {gameTitle}.' } },
  he: { join_approved: { title: 'אושרת', body: 'המארגן אישר אותך ל-{gameTitle}.' } },
};

class Store implements PushStore {
  notifications: Notification[] = [];
  tokens: PushToken[] = [];
  deleted: string[] = [];
  locales = new Map<string, Locale>();
  loadNotifications = async (ids: readonly string[]) => this.notifications.filter((n) => ids.includes(n.id));
  loadLocales = async () => this.locales;
  loadTokens = async (users: readonly string[]) => this.tokens.filter((t) => users.includes(t.userId));
  deleteTokens = async (t: readonly string[]) => { this.deleted.push(...t); return t.length; };
}

class Expo implements PushSender {
  batches: PushMessage[][] = [];
  dead = new Set<string>();
  send = async (batch: readonly PushMessage[]): Promise<PushTicket[]> => {
    this.batches.push([...batch]);
    return batch.map((m) => (this.dead.has(m.to) ? { status: 'error', error: 'DeviceNotRegistered', message: 'gone' } : { status: 'ok', id: m.to }));
  };
}

const notif = (n: number, userId: string): Notification => ({ id: uuid(n), userId, kind: 'join_approved', params: { gameTitle: 'Padel' }, gameId: uuid(1), sanctionId: null, readAt: null, createdAt: '2026-11-12T12:00:00.000Z' });

function setup() {
  const store = new Store();
  const expo = new Expo();
  let webCalls = 0;
  const deps: PushDeps = { internalSecrets: [INTERNAL_SECRET], store, expo, webPush: { send: async () => { webCalls++; return 'unsupported'; } }, localizer: createLocalizer(catalogs), log: memoryLogger() };
  return { store, expo, deps, webCalls: () => webCalls, call: (b: unknown, token = INTERNAL_SECRET) => handle(post('push-dispatch', b, { token }), deps) };
}

describe('push-dispatch', () => {
  it('renders in the recipient locale from a database-webhook insert', async () => {
    const { store, expo, call } = setup();
    store.locales.set(uuid(10), 'he');
    store.tokens.push({ userId: uuid(10), token: 'ExponentPushToken[a]', platform: 'ios' });
    const r = await body(await call({ type: 'INSERT', table: 'notifications', record: { id: uuid(50), user_id: uuid(10), kind: 'join_approved', params: { gameTitle: 'Padel' }, game_id: uuid(1), created_at: '2026-11-12T12:00:00+00:00' } }));
    expect(r).toMatchObject({ notifications: 1, sent: 1, failed: 0 });
    expect(expo.batches[0]?.[0]).toEqual({ to: 'ExponentPushToken[a]', title: 'אושרת', body: 'המארגן אישר אותך ל-Padel.', data: { notificationId: uuid(50), kind: 'join_approved', gameId: uuid(1), sanctionId: null } });
  });

  it('batches ≤ 100 per Expo request and removes DeviceNotRegistered tokens', async () => {
    const { store, expo, call } = setup();
    for (let i = 0; i < 250; i++) {
      store.notifications.push(notif(1000 + i, uuid(2000 + i)));
      store.tokens.push({ userId: uuid(2000 + i), token: `ExponentPushToken[t${i}]`, platform: 'android' });
    }
    expo.dead.add('ExponentPushToken[t7]').add('ExponentPushToken[t180]');
    const r = await body(await call({ notificationIds: store.notifications.map((n) => n.id) }));
    expect(expo.batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(r).toMatchObject({ notifications: 250, sent: 248, failed: 2, removedTokens: 2 });
    expect(store.deleted.sort()).toEqual(['ExponentPushToken[t180]', 'ExponentPushToken[t7]']);
  });

  it('web tokens go to the Web Push stub; non-Expo native tokens are skipped; English fallback', async () => {
    const { store, expo, call, webCalls } = setup();
    store.notifications.push(notif(1, uuid(10)));
    store.tokens.push({ userId: uuid(10), token: 'https://push.example/sub', platform: 'web' }, { userId: uuid(10), token: 'raw-fcm-token', platform: 'android' }, { userId: uuid(10), token: 'ExponentPushToken[z]', platform: 'android' });
    const r = await body(await call({ notificationIds: [uuid(1)] }));
    expect(r).toMatchObject({ sent: 1, webSkipped: 1 });
    expect(webCalls()).toBe(1);
    expect(expo.batches[0]?.[0]?.title).toBe('You’re in');
  });

  it('a failed Expo batch counts as failed without throwing', async () => {
    const { store, expo, call } = setup();
    store.notifications.push(notif(1, uuid(10)));
    store.tokens.push({ userId: uuid(10), token: 'ExponentPushToken[a]', platform: 'ios' });
    expo.send = async () => { throw new Error('expo down'); };
    expect(await body(await call({ notificationIds: [uuid(1)] }))).toMatchObject({ sent: 0, failed: 1 });
  });

  it('internal callers only, and validates the body', async () => {
    const { call } = setup();
    expect((await call({ notificationIds: [] }, 'nope')).status).toBe(401);
    expect((await call({ hello: 1 })).status).toBe(400);
  });
});
