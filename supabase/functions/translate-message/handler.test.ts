import { describe, expect, it } from 'vitest';
import type { Locale, TranslationProvider } from '@st/domain';
import type { Translator } from '#shared/translate';
import { allowAll, body, fakeAuth, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { handle, type TranslateDeps, type TranslateResponse, type TranslateStore, type VisibleMessage } from './handler';

const MSG = uuid(7);
class Store implements TranslateStore {
  message: VisibleMessage | null = { id: MSG, body: 'נשמיד אותם הערב', lang: 'he', moderation: 'allow', retractedAt: null };
  cache = new Map<string, { text: string; provider: TranslationProvider }>();
  tokens: string[] = [];
  loadVisibleMessage = async (token: string) => { this.tokens.push(token); return this.message; };
  getUserLocale = async (): Promise<Locale> => 'en';
  getCached = async (id: string, t: Locale) => this.cache.get(`${id}:${t}`) ?? null;
  saveCached = async (id: string, t: Locale, text: string, provider: TranslationProvider) => { this.cache.set(`${id}:${t}`, { text, provider }); };
}

const tr = (provider: TranslationProvider, result: string | Error, supports = true) => {
  const t = { provider, calls: 0, supports: () => supports, translate: async () => { t.calls++; if (result instanceof Error) throw result; return { text: result, detectedSource: 'he' }; } };
  return t satisfies Translator;
};

function setup(chain = [tr('google', 'We will crush them tonight'), tr('deepl', 'deepl'), tr('llm', 'llm')]) {
  const store = new Store();
  const deps: TranslateDeps = { auth: fakeAuth({ tok: uuid(10) }), store, translators: chain, timeoutMs: 50, rateLimiter: allowAll, clock: mutableClock(0), log: memoryLogger(), cors: { allowedOrigins: [] } };
  const call = (b: Record<string, unknown> = { messageId: MSG }) => handle(post('translate-message', b, { token: 'tok' }), deps);
  return { store, deps, call, chain };
}

describe('translate-message', () => {
  it('translates into the profile locale, reads the message as the caller, and caches', async () => {
    const { call, store, chain } = setup();
    const a = await body<TranslateResponse>(await call());
    expect(a).toEqual({ messageId: MSG, target: 'en', text: 'We will crush them tonight', provider: 'google', cached: false, sameLanguage: false });
    expect(store.tokens).toEqual(['tok']);
    const b = await body<TranslateResponse>(await call());
    expect(b).toMatchObject({ cached: true, provider: 'google' });
    expect(chain[0]!.calls).toBe(1);
  });

  it('falls back Google → DeepL → LLM', async () => {
    const { call } = setup([tr('google', new Error('quota')), tr('deepl', new Error('500')), tr('llm', 'slang-aware')]);
    expect(await body(await call({ messageId: MSG, target: 'fr' }))).toMatchObject({ provider: 'llm', text: 'slang-aware', target: 'fr' });
  });

  it('all providers down → 503 unavailable (the app hides the button)', async () => {
    const { call } = setup([tr('google', new Error('x')), tr('llm', new Error('y'))]);
    const res = await call();
    expect(res.status).toBe(503);
    expect(await body(res)).toEqual({ code: 'unavailable' });
  });

  it('same language returns the original without a provider call', async () => {
    const { call, chain } = setup();
    expect(await body(await call({ messageId: MSG, target: 'he' }))).toMatchObject({ sameLanguage: true, provider: null, text: 'נשמיד אותם הערב' });
    expect(chain[0]!.calls).toBe(0);
  });

  it('does not translate invisible, retracted or still-pending messages', async () => {
    const { call, store } = setup();
    store.message = { ...store.message!, moderation: 'pending' };
    expect(await body(await call())).toMatchObject({ code: 'conflict', details: { reason: 'moderation_pending' } });
    store.message = { ...store.message, moderation: 'allow', retractedAt: '2026-01-01T00:00:00.000Z' };
    expect((await call()).status).toBe(404);
    store.message = null;
    expect((await call()).status).toBe(404);
  });

  it('validates target locale', async () => {
    const { call } = setup();
    expect((await call({ messageId: MSG, target: 'klingon' })).status).toBe(400);
  });
});
