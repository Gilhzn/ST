// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
// Deploy with --no-verify-jwt: the PSP authenticates with its webhook signature.
import Stripe from 'npm:stripe@23.0.1';
import { buildContext, paymentProviders } from '../_shared/wiring.ts';
import { handle, type WebhookDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const key = env.get('STRIPE_SECRET_KEY');
const stripe = key ? new Stripe(key, { httpClient: Stripe.createFetchHttpClient() }) : undefined;
const ctx = buildContext(env, 'payments-webhook');
const deps: WebhookDeps = { providers: paymentProviders(env, { stripe }), store: ctx.store, log: ctx.log };

Deno.serve((req) => handle(req, deps));
