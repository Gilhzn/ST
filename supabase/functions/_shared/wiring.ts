/**
 * Production wiring: builds real dependencies from environment variables.
 * Runtime-agnostic (env is injected), so it is type-checked and unit-tested in
 * Node; each function's `index.ts` passes `Deno.env` and the npm SDK clients.
 */
import { DEFAULT_TRUST_CONFIG } from '@st/domain';
import { FakeProvider, StripeProvider, type StripeClientLike } from '@st/payments';
import type { AnthropicMessagesLike } from '#shared/anthropic';
import { createGoTrueVerifier, type AuthVerifier } from '#shared/auth';
import { cachedConfig, type ConfigSource } from '#shared/config';
import type { ProviderRegistry } from '#shared/deposit';
import type { CorsOptions } from '#shared/http';
import { createLogger, type Logger } from '#shared/log';
import { createClaudeClassifier, createOmniModerator, type ModerationProvider } from '#shared/moderation';
import { MemoryRateLimiter, systemClock, type Clock, type RateLimiter } from '#shared/runtime';
import { createStore, type Store } from '#shared/store';
import { createSupabaseClient } from '#shared/supabase';
import { createClaudeTranslator, createDeepLTranslator, createGoogleTranslator, type Translator } from '#shared/translate';

export interface Env {
  get(name: string): string | undefined;
}

/** Optional SDK clients constructed in `index.ts` (npm specifiers live only there). */
export interface Sdks {
  anthropic?: AnthropicMessagesLike;
  stripe?: StripeClientLike;
}

export interface BaseContext {
  log: Logger;
  clock: Clock;
  store: Store;
  auth: AuthVerifier;
  config: ConfigSource;
  cors: CorsOptions;
  rateLimiter: RateLimiter;
  /** Accepted bearer secrets for internal (cron / webhook) callers. */
  internalSecrets: string[];
}

function required(env: Env, name: string): string {
  const v = env.get(name);
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

export function buildContext(env: Env, functionName: string): BaseContext {
  const url = required(env, 'SUPABASE_URL');
  const anonKey = required(env, 'SUPABASE_ANON_KEY');
  const serviceKey = required(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const log = createLogger({ base: { fn: functionName } });
  const clock = systemClock;
  const admin = createSupabaseClient({ url, apiKey: serviceKey });
  const store = createStore({ admin, asUser: (accessToken) => createSupabaseClient({ url, apiKey: anonKey, accessToken }) });
  const origins = (env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const internal = env.get('FUNCTIONS_INTERNAL_SECRET');
  return {
    log,
    clock,
    store,
    auth: createGoTrueVerifier({ url, anonKey }),
    config: cachedConfig(() => admin.rpc('trust_config_json'), clock, log),
    // Native apps send no Origin; the web app's origins must be listed (no wildcard in production).
    cors: { allowedOrigins: origins.length > 0 ? origins : [] },
    rateLimiter: new MemoryRateLimiter(clock),
    internalSecrets: [serviceKey, ...(internal ? [internal] : [])],
  };
}

export function moderationProviders(env: Env, sdks: Sdks): ModerationProvider[] {
  const providers: ModerationProvider[] = [];
  const openai = env.get('OPENAI_API_KEY');
  if (openai) providers.push(createOmniModerator({ apiKey: openai }));
  if (sdks.anthropic) providers.push(createClaudeClassifier({ messages: sdks.anthropic }));
  return providers;
}

/** Google → DeepL → Claude (CHAT-030). Unconfigured providers are skipped. */
export function translators(env: Env, sdks: Sdks): Translator[] {
  const chain: Translator[] = [];
  const google = env.get('GOOGLE_TRANSLATE_KEY');
  const deepl = env.get('DEEPL_KEY');
  if (google) chain.push(createGoogleTranslator({ apiKey: google }));
  if (deepl) chain.push(createDeepLTranslator({ apiKey: deepl }));
  if (sdks.anthropic) chain.push(createClaudeTranslator({ messages: sdks.anthropic }));
  return chain;
}

/** Payment adapters. `PAYMENTS_FAKE=1` adds the in-memory fake (never in production). */
export function paymentProviders(env: Env, sdks: Sdks): ProviderRegistry {
  const registry: { stripe?: StripeProvider; fake?: FakeProvider } = {};
  if (sdks.stripe) registry.stripe = new StripeProvider({ client: sdks.stripe, webhookSecret: env.get('STRIPE_WEBHOOK_SECRET') });
  if (env.get('PAYMENTS_FAKE') === '1') registry.fake = new FakeProvider({ webhookSecret: env.get('FAKE_WEBHOOK_SECRET') ?? 'whsec_fake' });
  return registry;
}

/** Moderation timeout: `trust_config.moderation_timeout_ms` (1.5 s by default). */
export const DEFAULT_MODERATION_TIMEOUT_MS = DEFAULT_TRUST_CONFIG.moderationTimeoutMs;
