/** In-memory implementation of the deposit stores (create-deposit, webhook, jobs, deletion) for tests. */
import type { Effect, PaymentIntentStatus, PaymentProviderId } from '@st/domain';
import type { CreateDepositStore } from '../create-deposit/handler';
import type { DeleteAccountStore } from '../delete-account/handler';
import type { WebhookStore } from '../payments-webhook/handler';
import type { DepositJobStore } from '../settle-deposits/handler';
import type { DepositCardRow, DepositGame, DepositParticipant, PaymentRow } from '#shared/deposit';
import { uuid } from './helpers';

export class PaymentsDb implements CreateDepositStore, WebhookStore, DepositJobStore, DeleteAccountStore {
  games = new Map<string, DepositGame>();
  participants = new Map<string, DepositParticipant>();
  cards = new Map<string, DepositCardRow>();
  countries = new Map<string, string | null>();
  payments: PaymentRow[] = [];
  customers = new Map<string, string>();
  events = new Set<string>();
  effects: Effect[] = [];
  deletedAccounts: string[] = [];
  deletedAuth: string[] = [];
  private seq = 0;
  constructor(private readonly now: () => number) {}

  key = (g: string, u: string) => `${g}:${u}`;

  // create-deposit
  loadContext = async (gameId: string, userId: string) => {
    const game = this.games.get(gameId);
    return game ? { game, participant: this.participants.get(this.key(gameId, userId)) ?? null, countryCode: this.countries.get(userId) ?? null } : null;
  };
  listPayments = async (userId: string, gameId: string) =>
    this.payments.filter((p) => p.userId === userId && p.gameId === gameId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : this.payments.indexOf(b) - this.payments.indexOf(a)));
  getCustomer = async (userId: string, provider: PaymentProviderId) => this.customers.get(`${userId}:${provider}`) ?? null;
  saveCustomer = async (userId: string, provider: PaymentProviderId, id: string) => {
    const k = `${userId}:${provider}`;
    if (!this.customers.has(k)) this.customers.set(k, id);
    return this.customers.get(k) as string;
  };
  insertPayment: CreateDepositStore['insertPayment'] = async (p) => {
    const existing = this.payments.find((x) => x.idempotencyKey === p.idempotencyKey);
    if (existing) return existing;
    const row: PaymentRow = {
      id: uuid(9000 + ++this.seq), userId: p.userId, gameId: p.gameId, amountMinor: p.amountMinor, currency: p.currency, provider: p.provider, providerRef: null,
      status: 'requires_payment_method', depositState: 'setup', step: p.step, paymentMethodId: null, securedAt: null, settlementRequested: null, holdRequestedAt: null,
      idempotencyKey: p.idempotencyKey, createdAt: new Date(this.now()).toISOString(),
    };
    this.payments.push(row);
    return row;
  };
  attachProviderRef = async (id: string, ref: string, status: PaymentIntentStatus) => {
    const r = this.payments.find((p) => p.id === id);
    if (r && r.providerRef === null) Object.assign(r, { providerRef: ref, status });
  };

  // webhook
  isProcessed = async (id: string) => this.events.has(id);
  markProcessed = async (e: { id: string }) => { this.events.add(e.id); };
  findPayment = async (by: { id?: string; providerRef?: string }) => this.payments.find((p) => (by.id ? p.id === by.id : p.providerRef === by.providerRef)) ?? null;
  updatePayment: WebhookStore['updatePayment'] = async (id, expected, patch) => {
    const r = this.payments.find((p) => p.id === id);
    if (!r || r.status !== expected.status || r.depositState !== expected.depositState || r.providerRef !== expected.providerRef) return false;
    Object.assign(r, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return true;
  };
  applyEffects = async (e: readonly Effect[]) => { this.effects.push(...e); };
  gameTitle = async (id: string) => this.games.get(id)?.title ?? null;

  // jobs
  getPayment = async (id: string) => this.payments.find((p) => p.id === id) ?? null;
  loadDepositGame = async (id: string) => this.games.get(id) ?? null;
  loadParticipant = async (g: string, u: string) => this.participants.get(this.key(g, u)) ?? null;
  loadCard = async (g: string, u: string) => this.cards.get(this.key(g, u)) ?? null;
  dueHolds = async () => this.payments.filter((p) => p.step === 'setup' && p.depositState === 'setup' && p.status === 'succeeded').map((p) => p.id);
  dueSettlements = async () => [];
  markHoldRequested = async (id: string, at: string) => { const r = this.payments.find((p) => p.id === id); if (r) r.holdRequestedAt = at; };
  startHold: DepositJobStore['startHold'] = async (id, expectedRef, next) => {
    const r = this.payments.find((p) => p.id === id);
    if (!r || r.step !== 'setup' || r.providerRef !== expectedRef) return false;
    Object.assign(r, { providerRef: next.providerRef, status: next.status, step: 'hold' });
    return true;
  };
  closeWithoutProvider: DepositJobStore['closeWithoutProvider'] = async (id, expected, next) => {
    const r = this.payments.find((p) => p.id === id);
    if (!r || r.depositState !== expected) return false;
    r.depositState = next;
    return true;
  };
  setSettlementRequested = async (id: string, outcome: 'release' | 'forfeit' | null) => { const r = this.payments.find((p) => p.id === id); if (r) r.settlementRequested = outcome; };

  // deletion
  listDeposits = async (userId: string) => this.payments.filter((p) => p.userId === userId).map((p) => ({ ...p, gameEndsAt: this.games.get(p.gameId)?.endsAt ?? new Date(0).toISOString() }));
  listCustomers = async (userId: string) => [...this.customers.entries()].filter(([k]) => k.startsWith(`${userId}:`)).map(([k, v]) => ({ provider: k.split(':')[1] as PaymentProviderId, customerId: v }));
  deleteMyAccount = async (token: string) => { this.deletedAccounts.push(token); };
  deleteAuthUser = async (userId: string) => { this.deletedAuth.push(userId); };
}
