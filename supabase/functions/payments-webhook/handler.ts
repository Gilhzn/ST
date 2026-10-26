/**
 * payments-webhook: the only path that advances `payments.status` /
 * `deposit_state` (ADR 0006, MON-014). Deploy with `--no-verify-jwt`: the
 * caller is the PSP, authenticated by its signature.
 *
 * POST <raw provider payload>  (?provider=stripe|fake|payplus, default stripe)
 * → 200 { received, duplicate?, ignored? } | 400 bad signature
 *
 * 1. Signature verified over the exact raw body (no JSON re-serialisation).
 * 2. Idempotent by provider event id (`payment_events`): a replayed event is
 *    acknowledged without effect. Transitions are monotonic, so out-of-order
 *    and concurrent deliveries are safe too.
 * 3. Row found by our metadata (`st_payment_id`) or by provider ref; the pure
 *    `reconcileEventRow` + `applyPaymentEvent` compute the new state.
 * 4. Side effects: declined hold → `deposit_action_required` notification
 *    (TRUST-064); captures/refunds/disputes → audit.
 * Unknown rows/events are acknowledged (200) so the PSP stops retrying.
 */
import { StError, type Effect, type PaymentProviderId } from '@st/domain';
import { WebhookSignatureError, applyPaymentEvent, reconcileEventRow, type PaymentEvent } from '@st/payments';
import { depositActionNotice, providerFor, type PaymentRow, type ProviderRegistry } from '#shared/deposit';
import { errorResponse, json, route } from '#shared/http';
import type { Logger } from '#shared/log';
import { isUuid } from '#shared/validate';

export interface WebhookStore {
  isProcessed(eventId: string): Promise<boolean>;
  markProcessed(event: { id: string; provider: PaymentProviderId; type: string; paymentId: string | null }): Promise<void>;
  findPayment(by: { id?: string; providerRef?: string }): Promise<PaymentRow | null>;
  /**
   * Compare-and-set update: applies `patch` only if the row still has
   * `expected` status/deposit_state/ref. Returns false on a lost race.
   */
  updatePayment(
    id: string,
    expected: Pick<PaymentRow, 'status' | 'depositState' | 'providerRef'>,
    patch: Partial<Pick<PaymentRow, 'status' | 'depositState' | 'providerRef' | 'step' | 'paymentMethodId' | 'securedAt'>>,
  ): Promise<boolean>;
  applyEffects(effects: readonly Effect[]): Promise<void>;
  gameTitle(gameId: string): Promise<string | null>;
}

export interface WebhookDeps {
  providers: ProviderRegistry;
  store: WebhookStore;
  log: Logger;
  maxBodyBytes?: number;
}

const PROVIDERS: readonly PaymentProviderId[] = ['stripe', 'fake', 'payplus'];

async function applyEvent(deps: WebhookDeps, event: PaymentEvent): Promise<{ paymentId: string | null; outcome: string }> {
  const byMeta = event.metadata.paymentId && isUuid(event.metadata.paymentId) ? event.metadata.paymentId : undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const row =
      (byMeta ? await deps.store.findPayment({ id: byMeta }) : null) ??
      (event.ref ? await deps.store.findPayment({ providerRef: event.ref }) : null);
    if (!row) return { paymentId: null, outcome: 'unknown_payment' };
    if (row.provider !== event.provider) return { paymentId: row.id, outcome: 'provider_mismatch' };

    const rec = reconcileEventRow(row, event);
    if (rec.stale) return { paymentId: row.id, outcome: 'stale' };
    const next = applyPaymentEvent(rec.base, event);
    const patch: Parameters<WebhookStore['updatePayment']>[2] = {};
    if (rec.adoptRef && event.ref) Object.assign(patch, { providerRef: event.ref, step: rec.base.step });
    if (next.status !== row.status) patch.status = next.status;
    if (next.depositState !== row.depositState) patch.depositState = next.depositState;
    if (event.type === 'setup_succeeded' && event.paymentMethodId && row.paymentMethodId !== event.paymentMethodId) {
      patch.paymentMethodId = event.paymentMethodId;
    }
    const secured = (event.type === 'setup_succeeded' && row.step === 'setup') || (next.depositState === 'held' && row.depositState !== 'held');
    if (secured && !row.securedAt) patch.securedAt = event.occurredAt;
    if (Object.keys(patch).length === 0) return { paymentId: row.id, outcome: 'unchanged' };

    const ok = await deps.store.updatePayment(row.id, { status: row.status, depositState: row.depositState, providerRef: row.providerRef }, patch);
    if (!ok) continue; // concurrent update: reload and recompute

    const effects: Effect[] = [];
    for (const note of next.notes) {
      if (note === 'hold_failed') {
        effects.push(depositActionNotice(row, (await deps.store.gameTitle(row.gameId)) ?? ''));
      }
      if (note === 'captured' || note === 'refunded' || note === 'dispute_opened') {
        effects.push({
          type: 'Audit',
          action: `deposit.${note}`,
          subjectUserId: row.userId,
          data: { paymentId: row.id, gameId: row.gameId, providerEventId: event.id, amountMinor: event.amount?.amountMinor ?? null },
        });
      }
    }
    if (effects.length > 0) await deps.store.applyEffects(effects);
    return { paymentId: row.id, outcome: next.notes.length > 0 ? next.notes.join(',') : 'updated' };
  }
  throw new StError('conflict', 'payment row kept changing');
}

export async function handle(req: Request, deps: WebhookDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'] }, async () => {
    const q = new URL(req.url).searchParams.get('provider') ?? 'stripe';
    const providerId = PROVIDERS.find((p) => p === q);
    const provider = providerId ? providerFor(deps.providers, providerId) : null;
    if (!provider || !providerId) return errorResponse('not_found');

    const max = deps.maxBodyBytes ?? 256 * 1024;
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > max) return errorResponse('validation');

    let event: PaymentEvent;
    try {
      event = await provider.parseWebhook({ rawBody, headers: req.headers });
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        deps.log.warn('payments.webhook_bad_signature', { provider: providerId });
        return errorResponse('validation', {}, { reason: 'bad_signature' });
      }
      throw err;
    }
    if (event.provider !== providerId) return errorResponse('validation', {}, { reason: 'provider_mismatch' });

    if (await deps.store.isProcessed(event.id)) {
      return json({ received: true, duplicate: true });
    }
    if (event.type === 'ignored') {
      await deps.store.markProcessed({ id: event.id, provider: providerId, type: event.providerType, paymentId: null });
      return json({ received: true, ignored: true });
    }
    const { paymentId, outcome } = await applyEvent(deps, event);
    // Recorded after processing: a crash before this line lets the PSP retry, and replays are no-ops.
    await deps.store.markProcessed({ id: event.id, provider: providerId, type: event.providerType, paymentId });
    deps.log.info('payments.webhook', { provider: providerId, type: event.type, paymentId, outcome });
    return json({ received: true, outcome });
  });
}
