import { describe, expect, it } from 'vitest';
import { buildContext, moderationProviders, paymentProviders, translators } from '#shared/wiring';

const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });
const base = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-0123456789' };

describe('wiring', () => {
  it('requires the Supabase env and parses CORS origins and internal secrets', () => {
    expect(() => buildContext(env({}), 'x')).toThrow(/SUPABASE_URL/);
    const ctx = buildContext(env({ ...base, ALLOWED_ORIGINS: 'https://a.test, https://b.test', FUNCTIONS_INTERNAL_SECRET: 'internal-0123456789' }), 'x');
    expect(ctx.cors).toEqual({ allowedOrigins: ['https://a.test', 'https://b.test'] });
    expect(ctx.internalSecrets).toEqual(['service-role-key-0123456789', 'internal-0123456789']);
  });

  it('only enables configured providers, in the documented order', () => {
    const anthropic = { create: async () => ({ stop_reason: 'end_turn', content: [] }) };
    expect(moderationProviders(env({}), {}).map((p) => p.name)).toEqual([]);
    expect(moderationProviders(env({ OPENAI_API_KEY: 'k' }), { anthropic }).map((p) => p.name)).toEqual(['omni', 'llm']);
    expect(translators(env({ GOOGLE_TRANSLATE_KEY: 'g', DEEPL_KEY: 'd' }), { anthropic }).map((t) => t.provider)).toEqual(['google', 'deepl', 'llm']);
    expect(Object.keys(paymentProviders(env({ PAYMENTS_FAKE: '1' }), {}))).toEqual(['fake']);
    expect(Object.keys(paymentProviders(env({}), {}))).toEqual([]);
  });
});
