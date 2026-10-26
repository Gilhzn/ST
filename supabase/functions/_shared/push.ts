/**
 * Push senders: Expo Push API (iOS/Android via Expo Notifications) and a Web
 * Push seam (later phase; web relies on the in-app inbox in the MVP).
 */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string | number | boolean | null>;
}

export type PushTicket =
  | { status: 'ok'; id: string | null }
  | { status: 'error'; error: string; message: string };

export interface PushSender {
  /** Sends one batch (≤ {@link EXPO_BATCH_LIMIT}); returns one ticket per message, in order. */
  send(batch: readonly PushMessage[]): Promise<PushTicket[]>;
}

/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH_LIMIT = 100;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function isExpoPushToken(token: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token);
}

export function createExpoPushSender(options: { accessToken?: string; fetch?: typeof fetch; timeoutMs?: number }): PushSender {
  const doFetch = options.fetch ?? fetch;
  return {
    async send(batch) {
      if (batch.length > EXPO_BATCH_LIMIT) throw new Error('batch too large');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 10_000);
      try {
        const res = await doFetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
          },
          body: JSON.stringify(batch.map((m) => ({ ...m, sound: 'default', priority: 'high' }))),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`expo push HTTP ${res.status}`);
        const body = (await res.json()) as { data?: unknown };
        const data = Array.isArray(body.data) ? body.data : [];
        return batch.map((_, i): PushTicket => {
          const t = (data[i] ?? {}) as { status?: unknown; id?: unknown; message?: unknown; details?: { error?: unknown } };
          if (t.status === 'ok') return { status: 'ok', id: typeof t.id === 'string' ? t.id : null };
          return {
            status: 'error',
            error: typeof t.details?.error === 'string' ? t.details.error : 'Unknown',
            message: typeof t.message === 'string' ? t.message.slice(0, 200) : '',
          };
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Web Push seam. The MVP stub reports every message as unsupported (in-app inbox only). */
export interface WebPushSender {
  send(subscription: string, message: Omit<PushMessage, 'to'>): Promise<'sent' | 'gone' | 'unsupported'>;
}

export const webPushStub: WebPushSender = {
  send: () => Promise.resolve('unsupported'),
};
