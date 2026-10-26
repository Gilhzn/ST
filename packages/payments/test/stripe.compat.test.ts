/**
 * Compile-time proof that a real Stripe SDK instance satisfies StripeClientLike
 * (the Deno wiring passes `new Stripe(...)` straight to StripeProvider).
 */
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { StripeProvider, type StripeClientLike } from '../src/stripe';

describe('Stripe SDK compatibility', () => {
  it('a Stripe instance is a StripeClientLike', () => {
    const sdk = new Stripe('sk_test_compat_only', { httpClient: Stripe.createFetchHttpClient() });
    const client: StripeClientLike = sdk;
    expect(new StripeProvider({ client }).id).toBe('stripe');
  });
});
