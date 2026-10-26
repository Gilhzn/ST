/**
 * Deposit jobs (TRUST-061…066). Internal callers only (pg_cron through
 * `st_dispatch`, or a direct sweep).
 *
 * - `payments-hold`   POST { payment_id } | { sweep: true }
 *   Places the off-session manual-capture hold for a saved method once
 *   `isHoldDue` (max(T−24h, approval)). A decline notifies the player at once
 *   (TRUST-064); the webhook marks the row `failed`.
 * - `payments-settle` POST { payment_id, outcome } | { sweep: true }
 *   Re-checks the SQL job's request with the domain `decideSettlement`, then
 *   cancels/refunds (release) or captures (forfeit). Money moves only when both
 *   agree; otherwise the request is cleared and audited, and SQL re-evaluates
 *   on its next run. Provider state is confirmed by `payments-webhook`.
 * - `settle-deposits` POST { kind: 'hold' | 'settle', … } routes to either.
 *
 * Rows that never held money (setup only, or an already-captured charge) are
 * closed here without a provider call: there is no webhook for bookkeeping.
 */
import { StError, isStError, type Effect, type GameId, type PaymentIntentStatus, type UserId } from '@st/domain';
import {
  decideSettlement,
  depositIdempotencyKey,
  isHoldDue,
  parseDepositKey,
  type DepositPolicyOptions,
  type SettlementDecision,
} from '@st/payments';
import { requireInternalCaller } from '#shared/auth';
import {
  depositActionNotice,
  providerFor,
  type DepositCardRow,
  type DepositGame,
  type DepositParticipant,
  type PaymentRow,
  type ProviderRegistry,
} from '#shared/deposit';
import { json, readJson, route } from '#shared/http';
import type { Logger } from '#shared/log';
import type { Clock } from '#shared/runtime';
import { isUuid } from '#shared/validate';

export interface DepositJobStore {
  getPayment(id: string): Promise<PaymentRow | null>;
  loadDepositGame(gameId: GameId): Promise<DepositGame | null>;
  loadParticipant(gameId: GameId, userId: UserId): Promise<DepositParticipant | null>;
  /** Latest no_show / late_cancel card of the participation. */
  loadCard(gameId: GameId, userId: UserId): Promise<DepositCardRow | null>;
  getCustomer(userId: UserId, provider: PaymentRow['provider']): Promise<string | null>;
  /** `due_deposit_holds()` */
  dueHolds(): Promise<string[]>;
  /** `due_deposit_settlements()` */
  dueSettlements(): Promise<{ paymentId: string; outcome: 'release' | 'forfeit' }[]>;
  markHoldRequested(id: string, at: string): Promise<void>;
  /** CAS: switch a setup row to its hold intent (no-op when the webhook already adopted it). */
  startHold(id: string, expectedRef: string | null, next: { providerRef: string; status: PaymentIntentStatus }): Promise<boolean>;
  /** CAS: bookkeeping close for rows with no provider-side money movement. */
  closeWithoutProvider(id: string, expectedState: PaymentRow['depositState'], next: 'released' | 'forfeited'): Promise<boolean>;
  setSettlementRequested(id: string, outcome: 'release' | 'forfeit' | null, at: string): Promise<void>;
  applyEffects(effects: readonly Effect[]): Promise<void>;
}

export interface DepositJobDeps {
  internalSecrets: readonly string[];
  store: DepositJobStore;
  providers: ProviderRegistry;
  policy?: DepositPolicyOptions;
  clock: Clock;
  log: Logger;
}

export type JobOutcome = { paymentId: string; outcome: string };

const audit = (row: PaymentRow, action: string, data: Record<string, string | number | boolean | null>): Effect => ({
  type: 'Audit',
  action,
  subjectUserId: row.userId,
  data: { paymentId: row.id, gameId: row.gameId, ...data },
});

function attemptOf(row: PaymentRow): number {
  return parseDepositKey(row.idempotencyKey)?.attempt ?? 0;
}

// ---------------------------------------------------------------------------
// Hold
// ---------------------------------------------------------------------------

export async function placeHold(deps: DepositJobDeps, paymentId: string): Promise<JobOutcome> {
  const row = await deps.store.getPayment(paymentId);
  if (!row) return { paymentId, outcome: 'not_found' };
  if (row.step !== 'setup' || row.depositState !== 'setup' || row.status !== 'succeeded' || !row.providerRef) {
    return { paymentId, outcome: 'not_ready' };
  }
  const now = deps.clock.now();
  const [game, participant] = await Promise.all([deps.store.loadDepositGame(row.gameId), deps.store.loadParticipant(row.gameId, row.userId)]);
  if (!game || !participant) return { paymentId, outcome: 'not_found' };
  const due = isHoldDue({
    game: { startsAt: game.startsAt, endsAt: game.endsAt, status: game.status },
    participantStatus: participant.status,
    deposit: { depositState: row.depositState, setupSucceeded: true },
    approvedAt: participant.decidedAt,
    now,
  });
  if (!due) return { paymentId, outcome: 'not_due' };

  const provider = providerFor(deps.providers, row.provider);
  if (!provider) return { paymentId, outcome: 'provider_unavailable' };
  const setup = await provider.retrieveSetup(row.providerRef);
  const customerId = setup.customerId ?? (await deps.store.getCustomer(row.userId, row.provider));
  const paymentMethodId = row.paymentMethodId ?? setup.paymentMethodId;
  if (!customerId || !paymentMethodId) return { paymentId, outcome: 'no_saved_method' };

  const intent = await provider.createDepositHold({
    customerId,
    amount: { amountMinor: row.amountMinor, currency: row.currency },
    mode: 'hold',
    paymentMethodId,
    methodTypes: ['card'],
    idempotencyKey: depositIdempotencyKey(row.gameId, row.userId, 'hold', attemptOf(row)),
    metadata: { paymentId: row.id, userId: row.userId, gameId: row.gameId, step: 'hold' },
    descriptorSuffix: 'DEPOSIT',
  });
  await deps.store.startHold(row.id, row.providerRef, { providerRef: intent.ref, status: intent.status });
  if (intent.status === 'failed') {
    await deps.store.applyEffects([depositActionNotice(row, game.title), audit(row, 'deposit.hold_failed', { failureCode: intent.failureCode })]);
    return { paymentId, outcome: 'declined' };
  }
  return { paymentId, outcome: intent.status === 'requires_capture' ? 'held' : intent.status };
}

// ---------------------------------------------------------------------------
// Settle
// ---------------------------------------------------------------------------

export async function settleOne(deps: DepositJobDeps, paymentId: string, requested: 'release' | 'forfeit' | null): Promise<JobOutcome> {
  const row = await deps.store.getPayment(paymentId);
  if (!row) return { paymentId, outcome: 'not_found' };
  if (row.depositState === 'released' || row.depositState === 'forfeited' || row.depositState === 'failed') {
    return { paymentId, outcome: 'already_settled' };
  }
  const now = deps.clock.now();
  const nowIso = new Date(now).toISOString();
  const [game, participant, card] = await Promise.all([
    deps.store.loadDepositGame(row.gameId),
    deps.store.loadParticipant(row.gameId, row.userId),
    deps.store.loadCard(row.gameId, row.userId),
  ]);
  if (!game) return { paymentId, outcome: 'not_found' };

  const decision: SettlementDecision = decideSettlement({
    game: { status: game.status, endsAt: game.endsAt, depositForfeitTo: game.depositForfeitTo },
    participant: participant
      ? { status: participant.status, attendance: participant.attendance, lateCancel: participant.lateCancel, spotRefilled: participant.lateCancelRefilled }
      : { status: 'removed', attendance: 'unknown', lateCancel: false },
    card,
    deposit: { mode: row.step === 'charge' ? 'charge_refund' : 'hold', depositState: row.depositState, securedAt: row.securedAt ?? row.holdRequestedAt },
    now,
    ...(deps.policy ? { options: deps.policy } : {}),
  });

  if (decision.action === 'none') {
    // A no-show whose hold was never placed: nothing to take; close the record.
    if (decision.reason === 'nothing_secured' && row.depositState === 'setup') {
      await deps.store.closeWithoutProvider(row.id, 'setup', 'released');
      await deps.store.applyEffects([audit(row, 'deposit.closed', { reason: decision.reason })]);
      return { paymentId, outcome: 'closed' };
    }
    return { paymentId, outcome: decision.reason };
  }
  if (decision.action === 'wait' || (requested !== null && requested !== decision.action)) {
    await deps.store.setSettlementRequested(row.id, null, nowIso);
    await deps.store.applyEffects([
      audit(row, 'deposit.settlement_deferred', { requested, policy: decision.action, reason: decision.reason }),
    ]);
    return { paymentId, outcome: `deferred:${decision.reason}` };
  }

  const provider = providerFor(deps.providers, row.provider);
  try {
    if (decision.action === 'release') {
      if (row.depositState === 'setup' || !row.providerRef) {
        await deps.store.closeWithoutProvider(row.id, row.depositState, 'released');
      } else {
        if (!provider) throw new StError('unavailable', 'provider not configured');
        await provider.releaseDeposit({ ref: row.providerRef, idempotencyKey: depositIdempotencyKey(row.gameId, row.userId, 'release', attemptOf(row)) });
      }
      await deps.store.applyEffects([audit(row, 'deposit.release', { reason: decision.reason })]);
      return { paymentId, outcome: 'release' };
    }
    // forfeit
    if (row.step === 'charge') {
      await deps.store.closeWithoutProvider(row.id, row.depositState, 'forfeited'); // already captured at charge time
    } else {
      if (!provider || !row.providerRef) throw new StError('unavailable', 'provider not configured');
      await provider.captureDeposit({ ref: row.providerRef, idempotencyKey: depositIdempotencyKey(row.gameId, row.userId, 'capture', attemptOf(row)) });
    }
    await deps.store.applyEffects([
      audit(row, 'deposit.forfeit', {
        reason: decision.reason,
        forfeitTo: decision.forfeitTo,
        payoutDeferred: decision.payoutDeferred,
        refundOnOverturn: decision.refundOnOverturn,
      }),
    ]);
    return { paymentId, outcome: 'forfeit' };
  } catch (err) {
    // Let SQL request it again on its next run.
    await deps.store.setSettlementRequested(row.id, null, nowIso);
    if (isStError(err)) return { paymentId, outcome: `error:${err.code}` };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Entrypoints
// ---------------------------------------------------------------------------

async function runEach(deps: DepositJobDeps, ids: readonly string[], fn: (id: string) => Promise<JobOutcome>): Promise<JobOutcome[]> {
  const results: JobOutcome[] = [];
  for (const id of ids) {
    try {
      results.push(await fn(id));
    } catch (err) {
      deps.log.error('deposit.job_failed', { paymentId: id, error: err });
      results.push({ paymentId: id, outcome: isStError(err) ? `error:${err.code}` : 'error' });
    }
  }
  return results;
}

async function holdBody(deps: DepositJobDeps, input: Record<string, unknown>): Promise<JobOutcome[]> {
  if (input['sweep'] === true) {
    const ids = await deps.store.dueHolds();
    const at = new Date(deps.clock.now()).toISOString();
    for (const id of ids) await deps.store.markHoldRequested(id, at);
    return runEach(deps, ids, (id) => placeHold(deps, id));
  }
  const id = input['payment_id'] ?? input['paymentId'];
  if (!isUuid(id)) throw new StError('validation', 'payment_id required', { field: 'payment_id' });
  return runEach(deps, [id], (pid) => placeHold(deps, pid));
}

async function settleBody(deps: DepositJobDeps, input: Record<string, unknown>): Promise<JobOutcome[]> {
  if (input['sweep'] === true) {
    const due = await deps.store.dueSettlements();
    const at = new Date(deps.clock.now()).toISOString();
    for (const d of due) await deps.store.setSettlementRequested(d.paymentId, d.outcome, at);
    const byId = new Map(due.map((d) => [d.paymentId, d.outcome] as const));
    return runEach(deps, [...byId.keys()], (id) => settleOne(deps, id, byId.get(id) ?? null));
  }
  const id = input['payment_id'] ?? input['paymentId'];
  if (!isUuid(id)) throw new StError('validation', 'payment_id required', { field: 'payment_id' });
  const outcome = input['outcome'];
  const requested = outcome === 'release' || outcome === 'forfeit' ? outcome : null;
  return runEach(deps, [id], (pid) => settleOne(deps, pid, requested));
}

function entry(kind: 'hold' | 'settle' | 'any') {
  return (req: Request, deps: DepositJobDeps): Promise<Response> =>
    route(req, deps.log, { methods: ['POST'] }, async () => {
      requireInternalCaller(req, deps.internalSecrets);
      const input = await readJson(req, 16 * 1024);
      const k = kind === 'any' ? input['kind'] : kind;
      if (k !== 'hold' && k !== 'settle') throw new StError('validation', 'kind must be hold or settle', { field: 'kind' });
      const results = k === 'hold' ? await holdBody(deps, input) : await settleBody(deps, input);
      deps.log.info(`deposit.${k}`, { count: results.length, outcomes: results.map((r) => r.outcome) });
      return json({ kind: k, results });
    });
}

/** `payments-hold` (pg_cron `place_deposit_holds`). */
export const handleHold = entry('hold');
/** `payments-settle` (pg_cron `settle_deposits`). */
export const handleSettle = entry('settle');
/** `settle-deposits` with `{ kind }`. */
export const handle = entry('any');
