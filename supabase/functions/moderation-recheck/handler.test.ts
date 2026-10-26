import { describe, expect, it } from 'vitest';
import { createTrustState, type ChatEvent, type ChatMessage, type Effect, type ModerationVerdict } from '@st/domain';
import { staticConfig } from '#shared/config';
import type { ModerationProvider } from '#shared/moderation';
import { INTERNAL_SECRET, body, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { handle, type PendingMessage, type RecheckDeps, type RecheckStore } from './handler';

const NOW = Date.parse('2026-11-10T17:00:00.000Z');
const msg = (n: number, createdAt = '2026-11-10T16:59:00.000Z'): ChatMessage => ({
  id: uuid(n), gameId: uuid(1), senderId: uuid(10), body: `message ${n}`, lang: 'en', clientMsgId: `c${n}`, moderation: 'pending', retractedAt: null, createdAt, expiresAt: '2026-11-10T23:00:00.000Z',
});

class Store implements RecheckStore {
  pending: PendingMessage[] = [];
  moderation = new Map<string, string>();
  retracted: string[] = [];
  retained: unknown[] = [];
  effects: Effect[] = [];
  events: ChatEvent[] = [];
  loadPending = async (ids: readonly string[]) => this.pending.filter((p) => ids.includes(p.message.id));
  setModeration = async (id: string, d: string) => { this.moderation.set(id, d); };
  retract = async (id: string) => { if (this.retracted.includes(id)) return false; this.retracted.push(id); return true; };
  retain = async (m: unknown) => { this.retained.push(m); };
  loadChatTrustState = async (u: string) => createTrustState(u);
  applyEffects = async (e: readonly Effect[]) => { this.effects.push(...e); };
  broadcast = async (_g: string, e: ChatEvent) => { this.events.push(e); };
}

function deps(verdicts: Record<string, ModerationVerdict['decision'] | 'hang'>, store = new Store()): RecheckDeps & { store: Store } {
  const provider = (name: 'omni' | 'llm'): ModerationProvider => ({
    name,
    classify: (input, signal) => {
      const d = verdicts[input.text] ?? 'allow';
      if (d === 'hang') return new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new Error('abort'))));
      return Promise.resolve({ decision: d, categories: d === 'allow' ? [] : ['harassment'], source: name, reasonKey: null });
    },
  });
  return { internalSecrets: [INTERNAL_SECRET], store, moderation: { providers: [provider('omni'), provider('llm')], timeoutMs: 20 }, config: staticConfig(), clock: mutableClock(NOW), log: memoryLogger() };
}

const call = (d: RecheckDeps, ids: string[], token = INTERNAL_SECRET) => handle(post('moderation-recheck', { messageIds: ids }, { token }), d);

describe('moderation-recheck', () => {
  it('internal callers only', async () => {
    expect((await call(deps({}), [uuid(1)], 'user-jwt')).status).toBe(401);
  });

  it('allow/nudge update the stored verdict; block retracts, retains and broadcasts', async () => {
    const d = deps({ 'message 2': 'nudge', 'message 3': 'block' });
    d.store.pending = [2, 3, 4].map((n) => ({ message: msg(n), senderLocale: 'en' as const, history: [] }));
    d.store.pending[2]!.message.body = 'message 4';
    const res = await body(await call(d, [uuid(2), uuid(3), uuid(4)]));
    expect(res).toMatchObject({ checked: 3, nudged: 1, retracted: 1, allowed: 1 });
    expect(d.store.moderation.get(uuid(2))).toBe('nudge');
    expect(d.store.retracted).toEqual([uuid(3)]);
    expect(d.store.events).toEqual([{ type: 'retracted', messageId: uuid(3), at: new Date(NOW).toISOString() }]);
    expect(d.store.retained).toHaveLength(1);
  });

  it('still unavailable: stays pending, escalates to human review after 10 minutes', async () => {
    const d = deps({ 'message 5': 'hang', 'message 6': 'hang' });
    d.store.pending = [
      { message: msg(5), senderLocale: 'en', history: [] },
      { message: msg(6, '2026-11-10T16:40:00.000Z'), senderLocale: 'en', history: [] },
    ];
    const res = await body(await call(d, [uuid(5), uuid(6)]));
    expect(res).toMatchObject({ stillPending: 2, escalated: 1 });
    expect(d.store.effects[0]).toMatchObject({ type: 'EnqueueReview', item: { kind: 'chat_recheck', dedupeKey: `chat_recheck:${uuid(6)}` } });
  });

  it('validates the batch', async () => {
    expect((await call(deps({}), ['nope'])).status).toBe(400);
  });
});
