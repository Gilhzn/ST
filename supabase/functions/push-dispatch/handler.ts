/**
 * push-dispatch: delivers `notifications` rows as push messages (best effort;
 * the row is the record and the in-app inbox reads it). Internal callers only
 * (database webhook on `notifications` insert, or a batch from pg_cron).
 *
 * POST { type: 'INSERT', table: 'notifications', record } | { notificationIds: uuid[] }
 * → { notifications, sent, failed, removedTokens, webSkipped }
 *
 * - Copy is rendered per recipient locale from `notifications:<kind>.title|body`
 *   (ICU params from the row), falling back to English.
 * - Expo messages are sent in batches of ≤ 100; tickets with
 *   `DeviceNotRegistered` delete the token. Web Push is a stub in the MVP.
 * - Payloads carry ids and kinds only, never user-generated content.
 */
import { StError, isLocale, type Locale, type Notification, type NotificationKind, type UserId } from '@st/domain';
import { requireInternalCaller } from '#shared/auth';
import { json, readJson, route } from '#shared/http';
import type { Localizer } from '#shared/i18n';
import type { Logger } from '#shared/log';
import { EXPO_BATCH_LIMIT, chunk, isExpoPushToken, type PushMessage, type PushSender, type WebPushSender } from '#shared/push';
import { iso } from '#shared/rows';
import { arrayField, isUuid } from '#shared/validate';

export interface PushToken {
  userId: UserId;
  token: string;
  platform: 'ios' | 'android' | 'web';
}

export interface PushStore {
  loadNotifications(ids: readonly string[]): Promise<Notification[]>;
  loadLocales(userIds: readonly UserId[]): Promise<Map<UserId, Locale>>;
  loadTokens(userIds: readonly UserId[]): Promise<PushToken[]>;
  deleteTokens(tokens: readonly string[]): Promise<number>;
}

export interface PushDeps {
  internalSecrets: readonly string[];
  store: PushStore;
  expo: PushSender;
  webPush: WebPushSender;
  localizer: Localizer;
  log: Logger;
}

export const MAX_NOTIFICATIONS = 500;

function notificationFromRecord(record: Record<string, unknown>): Notification {
  return {
    id: String(record['id']),
    userId: String(record['user_id']),
    kind: String(record['kind']) as NotificationKind,
    params: (record['params'] && typeof record['params'] === 'object' ? record['params'] : {}) as Notification['params'],
    gameId: record['game_id'] ? String(record['game_id']) : null,
    sanctionId: record['sanction_id'] ? String(record['sanction_id']) : null,
    readAt: null,
    createdAt: iso(record['created_at'] ?? new Date(0).toISOString()),
  };
}

export async function handle(req: Request, deps: PushDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'] }, async () => {
    requireInternalCaller(req, deps.internalSecrets);
    const input = await readJson(req, 256 * 1024);

    let notifications: Notification[];
    if (input['table'] === 'notifications' && input['type'] === 'INSERT' && input['record'] && typeof input['record'] === 'object') {
      notifications = [notificationFromRecord(input['record'] as Record<string, unknown>)];
    } else if (input['notificationIds'] !== undefined) {
      const ids = arrayField(input, 'notificationIds', MAX_NOTIFICATIONS).filter(isUuid);
      notifications = ids.length > 0 ? await deps.store.loadNotifications(ids) : [];
    } else {
      throw new StError('validation', 'expected a notifications webhook or notificationIds');
    }

    const userIds = [...new Set(notifications.map((n) => n.userId))];
    const [locales, tokens] = userIds.length > 0 ? await Promise.all([deps.store.loadLocales(userIds), deps.store.loadTokens(userIds)]) : [new Map<UserId, Locale>(), []];
    const byUser = new Map<UserId, PushToken[]>();
    for (const t of tokens) byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t]);

    const expoMessages: PushMessage[] = [];
    let webSkipped = 0;
    for (const n of notifications) {
      const locale = locales.get(n.userId);
      const copy = deps.localizer.notification(isLocale(locale) ? locale : null, n.kind, n.params);
      const data = { notificationId: n.id, kind: n.kind, gameId: n.gameId, sanctionId: n.sanctionId };
      for (const t of byUser.get(n.userId) ?? []) {
        if (t.platform === 'web') {
          const r = await deps.webPush.send(t.token, { title: copy.title, body: copy.body, data });
          if (r !== 'sent') webSkipped++;
        } else if (isExpoPushToken(t.token)) {
          expoMessages.push({ to: t.token, title: copy.title, body: copy.body, data });
        }
      }
    }

    let sent = 0;
    let failed = 0;
    const dead = new Set<string>();
    for (const batch of chunk(expoMessages, EXPO_BATCH_LIMIT)) {
      try {
        const tickets = await deps.expo.send(batch);
        tickets.forEach((t, i) => {
          if (t.status === 'ok') sent++;
          else {
            failed++;
            if (t.error === 'DeviceNotRegistered') dead.add((batch[i] as PushMessage).to);
          }
        });
      } catch (error) {
        failed += batch.length;
        deps.log.warn('push.batch_failed', { size: batch.length, error });
      }
    }
    const removedTokens = dead.size > 0 ? await deps.store.deleteTokens([...dead]) : 0;
    const result = { notifications: notifications.length, sent, failed, removedTokens, webSkipped };
    deps.log.info('push.dispatched', { notifications: result.notifications, sent, failed, cleanedDevices: removedTokens, webSkipped });
    return json(result);
  });
}
