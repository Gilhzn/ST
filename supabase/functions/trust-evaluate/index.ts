// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
import { buildContext } from '../_shared/wiring.ts';
import { handle, type TrustEvaluateDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const ctx = buildContext(env, 'trust-evaluate');
const deps: TrustEvaluateDeps = { internalSecrets: ctx.internalSecrets, store: ctx.store, config: ctx.config, clock: ctx.clock, log: ctx.log };

Deno.serve((req) => handle(req, deps));
