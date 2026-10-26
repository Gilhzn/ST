import { describe, expect, it } from 'vitest';
import { createTrustState, type ChatEvent, type ChatMessage, type Effect, type ModerationVerdict } from '@st/domain';
import { staticConfig } from '#shared/config';
import type { ModerationProvider } from '#shared/moderation';
import { MemoryRateLimiter } from '#shared/runtime';
import { allowAll, body, fakeAuth, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { handle, type ChatContext, type NewChatMessage, type RetainedMessage, type SendMessageDeps, type SendMessageResponse, type SendMessageStore } from './handler';

const NOW = Date.parse('2026-11-10T17:00:00.000Z');
const GAME = uuid(1);
const ALICE = uuid(10);

class MemoryChatStore implements SendMessageStore {
  ctx: ChatContext | null = {
    game: { id: GAME, endsAt: '2026-11-10T20:00:00.000Z', status: 'scheduled' },
    isMember: true,
    sender: { chatMutedUntil: null, permanentlyBanned: false, deleted: false, createdAt: '2026-01-01T00:00:00.000Z', locale: 'he' },
  };
  messages: ChatMessage[] = [];
  retained: RetainedMessage[] = [];
  effects: Effect[] = [];
  broadcasts: { gameId: string; event: ChatEvent }[] = [];
  failBroadcast = false;
  loadChatContext = async () => this.ctx;
  findByClientMsgId = async (u: string, c: string) => this.messages.find((m) => m.senderId === u && m.clientMsgId === c) ?? null;
  countMessagesSince = async (u: string, since: string) => this.messages.filter((m) => m.senderId === u && m.createdAt >= since).length;
  countIdenticalSince = async (u: string, b: string, since: string) => this.messages.filter((m) => m.senderId === u && m.body === b && m.createdAt >= since).length;
  recentHistory = async () => this.messages.slice(-5).map((m) => ({ senderId: m.senderId, body: m.body }));
  insertMessage = async (m: NewChatMessage): Promise<ChatMessage> => {
    const msg: ChatMessage = { id: uuid(100 + this.messages.length), gameId: m.gameId, senderId: m.senderId, body: m.body, lang: m.lang, clientMsgId: m.clientMsgId, moderation: m.moderation, retractedAt: null, createdAt: new Date(NOW).toISOString(), expiresAt: '2026-11-10T23:00:00.000Z' };
    this.messages.push(msg);
    return msg;
  };
  retain = async (m: RetainedMessage) => { this.retained.push(m); };
  loadChatTrustState = async (userId: string) => createTrustState(userId, { chatBlocks: this.retained.map((r) => ({ gameId: r.gameId, at: r.retainedAt })) });
  applyEffects = async (e: readonly Effect[]) => { this.effects.push(...e); };
  broadcast = async (gameId: string, event: ChatEvent) => {
    if (this.failBroadcast) throw new Error('realtime down');
    this.broadcasts.push({ gameId, event });
  };
}

const verdict = (decision: ModerationVerdict['decision'], categories: ModerationVerdict['categories'] = []): ModerationVerdict => ({ decision, categories, source: 'omni', reasonKey: null });
const fixed = (name: 'omni' | 'llm', v: ModerationVerdict | 'hang'): ModerationProvider => ({
  name,
  classify: (_i, signal) => (v === 'hang' ? new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) : Promise.resolve({ ...v, source: name })),
});

function setup(providers: ModerationProvider[] = [fixed('omni', verdict('allow')), fixed('llm', verdict('allow'))]) {
  const store = new MemoryChatStore();
  const log = memoryLogger();
  const clock = mutableClock(NOW);
  const deps: SendMessageDeps = {
    auth: fakeAuth({ 'tok-alice': ALICE }),
    store,
    moderation: { providers, timeoutMs: 30 },
    config: staticConfig(),
    rateLimiter: allowAll,
    clock,
    log,
    cors: { allowedOrigins: ['https://app.test'] },
  };
  const send = (b: Record<string, unknown>, token = 'tok-alice') => handle(post('send-message', { gameId: GAME, clientMsgId: `c-${Math.random()}`, ...b }, { token }), deps);
  return { store, log, clock, deps, send };
}

describe('send-message', () => {
  it('requires authentication', async () => {
    const { send } = setup();
    expect((await send({ body: 'hi' }, 'nope')).status).toBe(401);
  });

  it('allow → stored and broadcast on game:<id>; bidi controls stripped before storage', async () => {
    const { send, store } = setup();
    const res = await send({ body: 'מי מביא \u202Eכדור\u202C?', lang: 'he' });
    expect(res.status).toBe(200);
    const b = await body<SendMessageResponse>(res);
    expect(b.verdict.decision).toBe('allow');
    expect(b.message?.body).toBe('מי מביא כדור?');
    expect(store.messages[0]?.lang).toBe('he');
    expect(store.broadcasts).toEqual([{ gameId: GAME, event: { type: 'message', message: b.message } }]);
  });

  it('rejects non-members, muted users, banned users and closed chats', async () => {
    const { send, store, clock } = setup();
    store.ctx = { ...store.ctx!, isMember: false };
    expect((await send({ body: 'hi' })).status).toBe(403);
    store.ctx = { ...store.ctx, isMember: true, sender: { ...store.ctx.sender, chatMutedUntil: '2026-11-11T00:00:00.000Z' } };
    const muted = await send({ body: 'hi' });
    expect(muted.status).toBe(403);
    expect(await body(muted)).toEqual({ code: 'chat_muted', details: { mutedUntil: '2026-11-11T00:00:00.000Z' } });
    store.ctx = { ...store.ctx, sender: { ...store.ctx.sender, chatMutedUntil: null, permanentlyBanned: true } };
    expect(await body(await send({ body: 'hi' }))).toEqual({ code: 'account_banned' });
    store.ctx = { ...store.ctx, sender: { ...store.ctx.sender, permanentlyBanned: false } };
    clock.set(Date.parse('2026-11-10T20:00:00.000Z'));
    expect(await body(await send({ body: 'hi' }))).toMatchObject({ code: 'game_not_open' });
    store.ctx = null;
    expect((await send({ body: 'hi' })).status).toBe(404);
  });

  it('validates input', async () => {
    const { send, deps } = setup();
    expect((await send({ body: '' })).status).toBe(400);
    expect((await send({ body: 'x'.repeat(1001) })).status).toBe(400);
    expect((await handle(post('send-message', { gameId: 'not-a-uuid', body: 'x', clientMsgId: 'c' }, { token: 'tok-alice' }), deps)).status).toBe(400);
  });

  it('nudge → not sent until confirmed; confirmed nudge is stored as nudge', async () => {
    const { send, store } = setup([fixed('omni', verdict('nudge', ['profanity'])), fixed('llm', verdict('nudge', ['profanity']))]);
    const first = await body<SendMessageResponse>(await send({ body: 'damn ref', clientMsgId: 'n1' }));
    expect(first).toMatchObject({ requiresConfirmation: true, message: null, verdict: { decision: 'nudge', reasonKey: 'moderation.nudge.profanity' } });
    expect(store.messages).toHaveLength(0);
    const second = await body<SendMessageResponse>(await send({ body: 'damn ref', clientMsgId: 'n1', confirmNudge: true }));
    expect(second.requiresConfirmation).toBe(false);
    expect(second.message?.moderation).toBe('nudge');
    expect(store.retained).toHaveLength(0);
  });

  it('block → not delivered, retained 90 days, counted; the 3rd block in 7 days mutes for 24h', async () => {
    const { send, store, clock, log } = setup([fixed('omni', verdict('allow')), fixed('llm', verdict('block', ['threat']))]);
    const r1 = await body<SendMessageResponse>(await send({ body: 'I will break your legs' }));
    expect(r1).toMatchObject({ message: null, mutedUntil: null, verdict: { decision: 'block', reasonKey: 'moderation.block.threat' } });
    expect(store.messages).toHaveLength(0);
    expect(store.broadcasts).toHaveLength(0);
    expect(store.retained[0]).toMatchObject({ body: 'I will break your legs', categories: ['threat'], expiresAt: '2027-02-08T17:00:00.000Z' });
    clock.advance(60_000);
    await send({ body: 'second threat' });
    clock.advance(60_000);
    const r3 = await body<SendMessageResponse>(await send({ body: 'third threat' }));
    expect(r3.mutedUntil).toBe('2026-11-11T17:02:00.000Z');
    expect(store.effects.map((e) => e.type)).toEqual(expect.arrayContaining(['IssueSanction', 'MuteChat', 'Notify']));
    const logs = JSON.stringify(log.records);
    expect(logs).not.toContain('break your legs');
    expect(logs).not.toContain('third threat');
  });

  it('providers time out → delivered as pending for the async re-check', async () => {
    const { send, store } = setup([fixed('omni', 'hang'), fixed('llm', 'hang')]);
    const b = await body<SendMessageResponse>(await send({ body: 'see you at 8' }));
    expect(b.verdict).toMatchObject({ decision: 'pending', source: 'fallback' });
    expect(store.messages[0]?.moderation).toBe('pending');
    expect(store.broadcasts).toHaveLength(1);
  });

  it('is idempotent per clientMsgId (offline retry) and survives broadcast failure', async () => {
    const { send, store, log } = setup();
    store.failBroadcast = true;
    const a = await body<SendMessageResponse>(await send({ body: 'hello', clientMsgId: 'same' }));
    const b = await body<SendMessageResponse>(await send({ body: 'hello', clientMsgId: 'same' }));
    expect(b.message?.id).toBe(a.message?.id);
    expect(store.messages).toHaveLength(1);
    expect(log.records.some((r) => r.event === 'chat.broadcast_failed')).toBe(true);
  });

  it('rate limits: per-isolate burst limiter and the database count (20/min)', async () => {
    const { send, deps, store } = setup();
    deps.rateLimiter = new MemoryRateLimiter(deps.clock);
    for (let i = 0; i < 20; i++) expect((await send({ body: `m${i}` })).status).toBe(200);
    expect((await send({ body: 'm21' })).status).toBe(429);
    deps.rateLimiter = allowAll;
    expect((await send({ body: 'm22' })).status).toBe(429);
    expect(store.messages).toHaveLength(20);
  });

  it('5 identical messages → spam block', async () => {
    const { send, clock } = setup();
    for (let i = 0; i < 4; i++) {
      expect((await body<SendMessageResponse>(await send({ body: 'JOIN MY LEAGUE' }))).verdict.decision).toBe('allow');
      clock.advance(1000);
    }
    expect((await body<SendMessageResponse>(await send({ body: 'JOIN MY LEAGUE' }))).verdict).toMatchObject({ decision: 'block', categories: ['spam'] });
  });

  it('no links from accounts younger than 7 days', async () => {
    const { send, store } = setup();
    store.ctx = { ...store.ctx!, sender: { ...store.ctx!.sender, createdAt: '2026-11-08T00:00:00.000Z' } };
    const res = await send({ body: 'join https://spam.example now' });
    expect(res.status).toBe(403);
    expect(await body(res)).toEqual({ code: 'forbidden', details: { reason: 'links_new_account' } });
    expect((await send({ body: 'meet at gate 3' })).status).toBe(200);
  });

  it('answers CORS preflight for allowed origins', async () => {
    const { deps } = setup();
    const res = await handle(new Request('https://fn.test/send-message', { method: 'OPTIONS', headers: { origin: 'https://app.test' } }), deps);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.test');
  });
});
