// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
import Stripe from 'npm:stripe@23.0.1';
import { buildContext, paymentProviders } from '../_shared/wiring.ts';
import { handle, type CreateDepositDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const key = env.get('STRIPE_SECRET_KEY');
const stripe = key ? new Stripe(key, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2 }) : undefined;
const ctx = buildContext(env, 'create-deposit');
const force = env.get('PAYMENTS_FAKE') === '1' ? 'fake' : undefined;
const deps: CreateDepositDeps = {
  auth: ctx.auth,
  store: ctx.store,
  providers: paymentProviders(env, { stripe }),
  ...(force ? { forceProvider: force } : {}),
  rateLimiter: ctx.rateLimiter,
  clock: ctx.clock,
  log: ctx.log,
  cors: ctx.cors,
};

Deno.serve((req) => handle(req, deps));
