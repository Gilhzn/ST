// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
import { buildPhase15Context, pushDispatcher } from '../_shared/wiring-phase15.ts';
import { handle, type RatingPeriodDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const ctx = buildPhase15Context(env, 'rating-period');
const deps: RatingPeriodDeps = {
  internalSecrets: ctx.internalSecrets,
  store: ctx.p15,
  push: pushDispatcher(env),
  clock: ctx.clock,
  log: ctx.log,
};

Deno.serve((req) => handle(req, deps));
