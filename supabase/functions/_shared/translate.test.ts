import { describe, expect, it, vi } from 'vitest';
import type { AnthropicMessagesLike } from '#shared/anthropic';
import { createClaudeTranslator, createDeepLTranslator, createGoogleTranslator, isSameLanguage, translateWithFallback, type Translator } from '#shared/translate';

const req = { text: 'נשמיד אותם', target: 'en' as const, source: 'he' };
const fake = (provider: Translator['provider'], impl: () => Promise<string>, supports = true): Translator & { calls: number } => {
  const t = { provider, calls: 0, supports: () => supports, translate: async () => { t.calls++; return { text: await impl(), detectedSource: 'he' }; } };
  return t;
};

describe('translators', () => {
  it('Google v2 request shape', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: { translations: [{ translatedText: 'We will crush them', detectedSourceLanguage: 'iw' }] } })));
    const g = createGoogleTranslator({ apiKey: 'g-key', fetch: fetchFn as unknown as typeof fetch });
    await expect(g.translate({ ...req, target: 'zh-Hant' }, new AbortController().signal)).resolves.toEqual({ text: 'We will crush them', detectedSource: 'iw' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('translation.googleapis.com/language/translate/v2?key=g-key');
    expect(JSON.parse(String(init.body))).toMatchObject({ q: req.text, target: 'zh-TW', format: 'text' });
  });

  it('DeepL uses the free host for :fx keys and does not claim Hindi', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ translations: [{ text: 'hi', detected_source_language: 'HE' }] })));
    const d = createDeepLTranslator({ apiKey: 'abc:fx', fetch: fetchFn as unknown as typeof fetch });
    expect(d.supports('hi')).toBe(false);
    expect(d.supports('he')).toBe(true);
    await d.translate({ ...req, target: 'pt' }, new AbortController().signal);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api-free.deepl.com/v2/translate');
    expect((init.headers as Record<string, string>)['authorization']).toBe('DeepL-Auth-Key abc:fx');
    expect(JSON.parse(String(init.body))).toEqual({ text: [req.text], target_lang: 'PT-BR' });
  });

  it('Claude fallback returns the structured translation', async () => {
    const messages: AnthropicMessagesLike = { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"translation":"We will crush them","source_language":"he"}' }] }) };
    await expect(createClaudeTranslator({ messages }).translate(req, new AbortController().signal)).resolves.toEqual({ text: 'We will crush them', detectedSource: 'he' });
  });
});

describe('translateWithFallback', () => {
  it('Google → DeepL → LLM, first success wins', async () => {
    const g = fake('google', async () => { throw new Error('quota'); });
    const d = fake('deepl', async () => 'from deepl');
    const l = fake('llm', async () => 'from llm');
    const r = await translateWithFallback([g, d, l], req, 50);
    expect(r).toMatchObject({ provider: 'deepl', text: 'from deepl', failed: [{ provider: 'google', reason: 'error' }] });
    expect(l.calls).toBe(0);
  });

  it('skips providers that do not support the target and treats timeouts as failures', async () => {
    const g = fake('google', () => new Promise(() => undefined));
    const d = fake('deepl', async () => 'x', false);
    const l = fake('llm', async () => 'from llm');
    const r = await translateWithFallback([g, d, l], { ...req, target: 'hi' }, 20);
    expect(r).toMatchObject({ provider: 'llm', failed: [{ provider: 'google', reason: 'timeout' }] });
    expect(d.calls).toBe(0);
  });

  it('returns null when every provider fails', async () => {
    expect(await translateWithFallback([fake('google', async () => '  ')], req, 20)).toBeNull();
  });

  it('detects same-language pairs', () => {
    expect(isSameLanguage('he', 'he')).toBe(true);
    expect(isSameLanguage('iw', 'he')).toBe(true);
    expect(isSameLanguage('pt-BR', 'pt')).toBe(true);
    expect(isSameLanguage('zh-TW', 'zh-Hant')).toBe(true);
    expect(isSameLanguage('zh-TW', 'zh-Hans')).toBe(false);
    expect(isSameLanguage(null, 'en')).toBe(false);
  });
});
