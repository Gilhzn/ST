// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
import { buildContext } from '../_shared/wiring.ts';
import { handle, integrityNotConfigured, type CheckinDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const ctx = buildContext(env, 'checkin-verify');
const deps: CheckinDeps = {
  auth: ctx.auth,
  store: ctx.store,
  integrity: integrityNotConfigured, // App Attest / Play Integrity: planned
  config: ctx.config,
  rateLimiter: ctx.rateLimiter,
  clock: ctx.clock,
  log: ctx.log,
  cors: ctx.cors,
};

Deno.serve((req) => handle(req, deps));
