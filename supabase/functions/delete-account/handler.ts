/**
 * delete-account: in-app account deletion (Apple 5.1.1(v), Google Play,
 * GDPR Art. 17; architecture §5.5). Idempotent and resumable.
 *
 * POST {}  (user JWT) → { deleted: true, pendingCleanup: string[] }
 *
 * 1. Deposits of games that have not ended are released at the PSP (holds
 *    cancelled, charges refunded). Deposits of past games keep following the
 *    normal no-show rules, so deletion cannot be used to dodge a forfeit.
 * 2. `delete_my_account()` runs *as the user* (it anonymises the profile,
 *    removes private data and keeps pseudonymised sanctions).
 * 3. Saved payment methods are detached at the PSP (compliance §4).
 * 4. The auth user is deleted (service role).
 * PSP cleanup failures do not block deletion: they are audited for follow-up.
 */
import { type Effect, type PaymentProviderId, type UserId } from '@st/domain';
import { depositIdempotencyKey, parseDepositKey } from '@st/payments';
import { requireUser, type AuthVerifier } from '#shared/auth';
import { providerFor, type PaymentRow, type ProviderRegistry } from '#shared/deposit';
import { json, route, type CorsOptions } from '#shared/http';
import type { Logger } from '#shared/log';
import type { Clock } from '#shared/runtime';

export interface DeleteAccountStore {
  /** The user's deposit rows with the game's end time. */
  listDeposits(userId: UserId): Promise<(PaymentRow & { gameEndsAt: string })[]>;
  listCustomers(userId: UserId): Promise<{ provider: PaymentProviderId; customerId: string }[]>;
  /** `delete_my_account()` with the user's own token. */
  deleteMyAccount(accessToken: string): Promise<void>;
  deleteAuthUser(userId: UserId): Promise<void>;
  applyEffects(effects: readonly Effect[]): Promise<void>;
}

export interface DeleteAccountDeps {
  auth: AuthVerifier;
  store: DeleteAccountStore;
  providers: ProviderRegistry;
  clock: Clock;
  log: Logger;
  cors: CorsOptions;
}

export async function handle(req: Request, deps: DeleteAccountDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'], cors: deps.cors }, async (cors) => {
    const user = await requireUser(req, deps.auth);
    const now = deps.clock.now();
    const pendingCleanup: string[] = [];
    const deposits = await deps.store.listDeposits(user.userId);

    // 1. Release deposits of games that have not ended.
    for (const d of deposits) {
      if (d.depositState !== 'held' || !d.providerRef || Date.parse(d.gameEndsAt) <= now) continue;
      const provider = providerFor(deps.providers, d.provider);
      try {
        if (!provider) throw new Error('provider not configured');
        await provider.releaseDeposit({
          ref: d.providerRef,
          idempotencyKey: depositIdempotencyKey(d.gameId, d.userId, 'release', parseDepositKey(d.idempotencyKey)?.attempt ?? 0),
        });
      } catch (error) {
        deps.log.warn('account.deposit_release_failed', { paymentId: d.id, error });
        pendingCleanup.push(`deposit:${d.id}`);
      }
    }

    // 2. Anonymise and erase in the database (as the user).
    await deps.store.deleteMyAccount(user.accessToken);

    // 3. Detach saved payment methods (customers we stored, plus those behind setup intents).
    const customers = new Map<string, PaymentProviderId>();
    for (const c of await deps.store.listCustomers(user.userId)) customers.set(`${c.provider}:${c.customerId}`, c.provider);
    for (const d of deposits) {
      if (d.step !== 'setup' || !d.providerRef) continue;
      const provider = providerFor(deps.providers, d.provider);
      try {
        const info = provider ? await provider.retrieveSetup(d.providerRef) : null;
        if (info?.customerId) customers.set(`${d.provider}:${info.customerId}`, d.provider);
      } catch {
        /* the setup may already be gone; the stored customer list still applies */
      }
    }
    for (const [key, providerId] of customers) {
      const provider = providerFor(deps.providers, providerId);
      const customerId = key.slice(providerId.length + 1);
      try {
        if (!provider) throw new Error('provider not configured');
        await provider.detachPaymentMethods(customerId);
      } catch (error) {
        deps.log.warn('account.detach_failed', { provider: providerId, error });
        pendingCleanup.push(`payment_methods:${providerId}`);
      }
    }
    if (pendingCleanup.length > 0) {
      await deps.store.applyEffects([{ type: 'Audit', action: 'account.psp_cleanup_pending', subjectUserId: user.userId, data: { items: pendingCleanup.join(',') } }]);
    }

    // 4. Remove the auth identity last (the token above had to stay valid).
    await deps.store.deleteAuthUser(user.userId);
    deps.log.info('account.deleted', { pendingCleanup: pendingCleanup.length });
    return json({ deleted: true, pendingCleanup }, 200, cors);
  });
}
