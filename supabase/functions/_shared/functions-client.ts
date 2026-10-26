/**
 * Calls another Edge Function as an internal caller (service role bearer), e.g.
 * the job wrappers handing fresh notifications to `push-dispatch`.
 */
import { StError } from '@st/domain';
import type { Logger } from '#shared/log';
import { chunk } from '#shared/push';

export interface PushDispatchResult {
  notifications: number;
  sent: number;
  failed: number;
}

/** Port: hands notification ids to `push-dispatch` (`{ notificationIds }`). */
export interface PushDispatcher {
  dispatch(notificationIds: readonly string[]): Promise<PushDispatchResult>;
}

export function createPushDispatcher(options: { url: string; serviceKey: string; fetch?: typeof fetch; timeoutMs?: number }): PushDispatcher {
  const doFetch = options.fetch ?? fetch;
  const endpoint = `${options.url.replace(/\/+$/, '')}/functions/v1/push-dispatch`;
  return {
    async dispatch(notificationIds) {
      if (notificationIds.length === 0) return { notifications: 0, sent: 0, failed: 0 };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 20_000);
      try {
        const res = await doFetch(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${options.serviceKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ notificationIds }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new StError('unavailable', `push-dispatch ${res.status}`);
        const b = (await res.json()) as Partial<PushDispatchResult>;
        return { notifications: Number(b.notifications) || 0, sent: Number(b.sent) || 0, failed: Number(b.failed) || 0 };
      } catch (e) {
        if (e instanceof StError) throw e;
        throw new StError('unavailable', 'push-dispatch unreachable');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Max ids per `push-dispatch` call (its `MAX_NOTIFICATIONS`). */
export const PUSH_DISPATCH_BATCH = 500;

/** Hands notification ids to push-dispatch in batches. Best effort. */
export async function pushNotifications(push: PushDispatcher, ids: readonly string[], log: Logger): Promise<PushDispatchResult | { error: string }> {
  const total: PushDispatchResult = { notifications: 0, sent: 0, failed: 0 };
  try {
    for (const batch of chunk([...ids], PUSH_DISPATCH_BATCH)) {
      const r = await push.dispatch(batch);
      total.notifications += r.notifications;
      total.sent += r.sent;
      total.failed += r.failed;
    }
    return total;
  } catch (error) {
    log.warn('jobs.push_failed', { error });
    return { error: error instanceof StError ? error.code : 'unknown' };
  }
}
