// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { buildContext, moderationProviders } from '../_shared/wiring.ts';
import { handle, type SendMessageDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const key = env.get('ANTHROPIC_API_KEY');
const anthropic = key ? new Anthropic({ apiKey: key, maxRetries: 0 }).messages : undefined;
const ctx = buildContext(env, 'send-message');
const deps: SendMessageDeps = {
  auth: ctx.auth,
  store: ctx.store,
  moderation: { providers: moderationProviders(env, { anthropic }) },
  config: ctx.config,
  rateLimiter: ctx.rateLimiter,
  clock: ctx.clock,
  log: ctx.log,
  cors: ctx.cors,
};

Deno.serve((req) => handle(req, deps));
