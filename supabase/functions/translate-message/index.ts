// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { buildContext, translators } from '../_shared/wiring.ts';
import { handle, type TranslateDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const key = env.get('ANTHROPIC_API_KEY');
const anthropic = key ? new Anthropic({ apiKey: key, maxRetries: 0 }).messages : undefined;
const ctx = buildContext(env, 'translate-message');
const deps: TranslateDeps = {
  auth: ctx.auth,
  store: ctx.store,
  translators: translators(env, { anthropic }),
  timeoutMs: 4000,
  rateLimiter: ctx.rateLimiter,
  clock: ctx.clock,
  log: ctx.log,
  cors: ctx.cors,
};

Deno.serve((req) => handle(req, deps));
