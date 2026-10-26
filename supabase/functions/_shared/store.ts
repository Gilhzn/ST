/**
 * Supabase-backed implementations of every handler's store interface.
 *
 * `admin` uses the service role (bypasses RLS) and is used only for the writes
 * the architecture assigns to Edge Functions and for server-side reads that
 * need fields clients cannot see. `asUser(token)` runs under RLS and is used
 * where visibility must follow the caller (game pin, readable messages,
 * `delete_my_account`).
 */
import {
  DAY_MS,
  createTrustState,
  isLocale,
  type ChatEvent,
  type ChatMessage,
  type CheckInVerdict,
  type DomainTrustEvent,
  type Effect,
  type IsoDateTime,
  type Locale,
  type Notification,
  type PaymentProviderId,
  type ReliabilityStatus,
  type Stars,
  type TrustConfig,
  type TrustState,
  type UserId,
} from '@st/domain';
import type { CheckinStore } from '#fn/checkin-verify/handler';
import type { CreateDepositStore } from '#fn/create-deposit/handler';
import type { DeleteAccountStore } from '#fn/delete-account/handler';
import type { RecheckStore } from '#fn/moderation-recheck/handler';
import type { WebhookStore } from '#fn/payments-webhook/handler';
import type { PushStore, PushToken } from '#fn/push-dispatch/handler';
import type { SendMessageStore } from '#fn/send-message/handler';
import type { DepositJobStore } from '#fn/settle-deposits/handler';
import type { TranslateStore } from '#fn/translate-message/handler';
import type { TrustStore } from '#fn/trust-evaluate/handler';
import type { DepositCardRow, DepositGame, DepositParticipant, PaymentRow } from '#shared/deposit';
import { iso, isoOrNull, rowToAppeal, rowToChatMessage, rowToReviewItem, rowToSanction, rowToUserReport } from '#shared/rows';
import type { Filter, SupabaseClient } from '#shared/supabase';

type Row = Record<string, unknown>;

export interface StoreClients {
  admin: SupabaseClient;
  asUser(accessToken: string): SupabaseClient;
}

const first = <T>(rows: T[]): T | null => rows[0] ?? null;
const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function rowToPayment(r: Row): PaymentRow {
  const step = r['step'];
  const settlement = r['settlement_requested'];
  return {
    id: str(r['id']),
    userId: str(r['user_id']),
    gameId: str(r['game_id']),
    amountMinor: Number(r['amount_minor']),
    currency: str(r['currency']),
    provider: str(r['provider']) as PaymentProviderId,
    providerRef: strOrNull(r['provider_ref']),
    status: str(r['status']) as PaymentRow['status'],
    depositState: str(r['deposit_state']) as PaymentRow['depositState'],
    step: step === 'hold' || step === 'charge' ? step : 'setup',
    paymentMethodId: strOrNull(r['payment_method_id']),
    securedAt: isoOrNull(r['secured_at']),
    settlementRequested: settlement === 'release' || settlement === 'forfeit' ? settlement : null,
    holdRequestedAt: isoOrNull(r['hold_requested_at']),
    idempotencyKey: str(r['idempotency_key']),
    createdAt: iso(r['created_at']),
  };
}

function rowToGame(r: Row): DepositGame {
  return {
    id: str(r['id']),
    title: str(r['title']),
    hostId: str(r['host_id']),
    startsAt: iso(r['starts_at']),
    endsAt: iso(r['ends_at']),
    status: str(r['status']) as DepositGame['status'],
    depositMinor: Number(r['deposit_minor'] ?? 0),
    currency: str(r['currency']),
    depositForfeitTo: r['deposit_forfeit_to'] === 'host' ? 'host' : 'pot',
  };
}

function rowToParticipant(r: Row): DepositParticipant {
  return {
    status: str(r['status']) as DepositParticipant['status'],
    attendance: str(r['attendance']) as DepositParticipant['attendance'],
    lateCancel: r['late_cancel'] === true,
    lateCancelRefilled: r['late_cancel_refilled'] === true,
    decidedAt: isoOrNull(r['decided_at']),
    requestedAt: iso(r['requested_at']),
  };
}

const PAYMENT_FIELDS: Readonly<Record<string, string>> = {
  status: 'status',
  depositState: 'deposit_state',
  providerRef: 'provider_ref',
  step: 'step',
  paymentMethodId: 'payment_method_id',
  securedAt: 'secured_at',
};

function paymentPatch(patch: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = PAYMENT_FIELDS[k];
    if (col && v !== undefined) out[col] = v;
  }
  return out;
}

export type Store = SendMessageStore &
  RecheckStore &
  TranslateStore &
  CheckinStore &
  TrustStore &
  CreateDepositStore &
  WebhookStore &
  DepositJobStore &
  DeleteAccountStore &
  PushStore;

export function createStore({ admin, asUser }: StoreClients): Store {
  const applyEffects = async (effects: readonly Effect[]): Promise<void> => {
    if (effects.length > 0) await admin.rpc('apply_effects', { p_effects: effects });
  };
  const broadcast = (gameId: string, event: ChatEvent): Promise<void> =>
    admin.broadcast([{ topic: `game:${gameId}`, event: event.type, payload: event, private: true }]);
  const retain: SendMessageStore['retain'] = async (m) => {
    await admin.insert(
      'moderation_retained',
      {
        message_id: m.messageId,
        game_id: m.gameId,
        sender_id: m.senderId,
        body: m.body,
        reason: 'blocked',
        categories: m.categories,
        retained_at: m.retainedAt,
        expires_at: m.expiresAt,
      },
      { returning: false },
    );
  };

  async function loadChatTrustState(userId: UserId, now: number, config: TrustConfig): Promise<TrustState> {
    const since = new Date(now - Math.max(config.chatBlocksWindowDays, config.yellowCardLifetimeDays) * DAY_MS).toISOString();
    const [sanctions, blocks] = await Promise.all([
      admin.select('sanctions', { filters: [['user_id', 'eq', userId], ['reason_code', 'eq', 'chat_blocks'], ['created_at', 'gte', since]], limit: 200 }),
      admin.select('moderation_retained', {
        columns: 'game_id,retained_at',
        filters: [['sender_id', 'eq', userId], ['reason', 'eq', 'blocked'], ['retained_at', 'gte', since]],
        limit: 500,
      }),
    ]);
    return createTrustState(userId, {
      sanctions: sanctions.map(rowToSanction),
      chatBlocks: blocks.filter((b) => b['game_id']).map((b) => ({ gameId: str(b['game_id']), at: iso(b['retained_at']) })),
    });
  }

  async function loadGameRow(gameId: string): Promise<Row | null> {
    return first(
      await admin.select('games', {
        columns: 'id,title,host_id,starts_at,ends_at,status,deposit_minor,currency,deposit_forfeit_to',
        filters: [['id', 'eq', gameId]],
      }),
    );
  }

  async function loadParticipantRow(gameId: string, userId: string): Promise<Row | null> {
    return first(
      await admin.select('game_participants', {
        columns: 'status,attendance,late_cancel,late_cancel_refilled,decided_at,requested_at',
        filters: [['game_id', 'eq', gameId], ['user_id', 'eq', userId]],
      }),
    );
  }

  const getCustomer = async (userId: UserId, provider: PaymentProviderId): Promise<string | null> => {
    const row = first(await admin.select('payment_customers', { columns: 'customer_id', filters: [['user_id', 'eq', userId], ['provider', 'eq', provider]] }));
    return row ? str(row['customer_id']) : null;
  };

  const store: Store = {
    // ----- chat -----------------------------------------------------------
    async loadChatContext(gameId, userId) {
      const [game, participant, profile] = await Promise.all([
        loadGameRow(gameId),
        loadParticipantRow(gameId, userId),
        first(await admin.select<Row>('profiles', { columns: 'chat_muted_until,permanently_banned,deleted_at,created_at,locale', filters: [['id', 'eq', userId]] })),
      ]);
      if (!game || !profile) return null;
      return {
        game: { id: str(game['id']), endsAt: iso(game['ends_at']), status: str(game['status']) as 'scheduled' },
        isMember: participant?.['status'] === 'approved' || game['host_id'] === userId,
        sender: {
          chatMutedUntil: isoOrNull(profile['chat_muted_until']),
          permanentlyBanned: profile['permanently_banned'] === true,
          deleted: profile['deleted_at'] !== null && profile['deleted_at'] !== undefined,
          createdAt: iso(profile['created_at']),
          locale: isLocale(profile['locale']) ? profile['locale'] : 'en',
        },
      };
    },
    async findByClientMsgId(userId, clientMsgId) {
      const row = first(await admin.select('chat_messages', { filters: [['sender_id', 'eq', userId], ['client_msg_id', 'eq', clientMsgId]] }));
      return row ? rowToChatMessage(row) : null;
    },
    async countMessagesSince(userId, since) {
      return (await admin.select('chat_messages', { columns: 'id', filters: [['sender_id', 'eq', userId], ['created_at', 'gte', since]], limit: 100 })).length;
    },
    async countIdenticalSince(userId, body, since) {
      return (await admin.select('chat_messages', { columns: 'id', filters: [['sender_id', 'eq', userId], ['body', 'eq', body], ['created_at', 'gte', since]], limit: 10 })).length;
    },
    async recentHistory(gameId, limit) {
      const rows = await admin.select('chat_messages', {
        columns: 'sender_id,body',
        filters: [['game_id', 'eq', gameId], ['retracted_at', 'is', null]],
        order: { column: 'created_at', ascending: false },
        limit,
      });
      return rows.reverse().map((r) => ({ senderId: str(r['sender_id']), body: str(r['body']) }));
    },
    async insertMessage(m): Promise<ChatMessage> {
      const rows = await admin.insert(
        'chat_messages',
        { game_id: m.gameId, sender_id: m.senderId, body: m.body, lang: m.lang, client_msg_id: m.clientMsgId, moderation: m.moderation },
        { onConflict: 'sender_id,client_msg_id', ignoreDuplicates: true },
      );
      const row = first(rows) ?? first(await admin.select('chat_messages', { filters: [['sender_id', 'eq', m.senderId], ['client_msg_id', 'eq', m.clientMsgId]] }));
      if (!row) throw new Error('chat message insert returned no row');
      return rowToChatMessage(row);
    },
    retain,
    loadChatTrustState,
    applyEffects,
    broadcast,

    // ----- recheck ---------------------------------------------------------
    async loadPending(ids) {
      const rows = await admin.select('chat_messages', { filters: [['id', 'in', ids], ['moderation', 'eq', 'pending'], ['retracted_at', 'is', null]], limit: ids.length });
      const out = [];
      for (const r of rows) {
        const message = rowToChatMessage(r);
        const [history, profile] = await Promise.all([
          admin.select('chat_messages', {
            columns: 'sender_id,body',
            filters: [['game_id', 'eq', message.gameId], ['created_at', 'lt', message.createdAt], ['retracted_at', 'is', null]],
            order: { column: 'created_at', ascending: false },
            limit: 5,
          }),
          admin.select('profiles', { columns: 'locale', filters: [['id', 'eq', message.senderId]] }),
        ]);
        const locale = first(profile)?.['locale'];
        out.push({
          message,
          senderLocale: isLocale(locale) ? locale : ('en' as Locale),
          history: history.reverse().map((h) => ({ senderId: str(h['sender_id']), body: str(h['body']) })),
        });
      }
      return out;
    },
    async setModeration(id, decision) {
      await admin.update('chat_messages', [['id', 'eq', id], ['moderation', 'eq', 'pending']], { moderation: decision }, { returning: false });
    },
    async retract(id, at) {
      const rows = await admin.update('chat_messages', [['id', 'eq', id], ['retracted_at', 'is', null]], { retracted_at: at });
      return rows.length > 0;
    },

    // ----- translation -----------------------------------------------------
    async loadVisibleMessage(accessToken, id) {
      const row = first(await asUser(accessToken).select('chat_messages', { columns: 'id,body,lang,moderation,retracted_at', filters: [['id', 'eq', id]] }));
      if (!row) return null;
      const moderation = row['moderation'];
      return {
        id: str(row['id']),
        body: str(row['body']),
        lang: strOrNull(row['lang']),
        moderation: moderation === 'nudge' || moderation === 'pending' ? moderation : 'allow',
        retractedAt: isoOrNull(row['retracted_at']),
      };
    },
    async getUserLocale(userId) {
      const locale = first(await admin.select('profiles', { columns: 'locale', filters: [['id', 'eq', userId]] }))?.['locale'];
      return isLocale(locale) ? locale : 'en';
    },
    async getCached(id, target) {
      const row = first(await admin.select('message_translations', { columns: 'text,provider', filters: [['message_id', 'eq', id], ['target', 'eq', target]] }));
      return row ? { text: str(row['text']), provider: str(row['provider']) as 'google' } : null;
    },
    async saveCached(id, target, text, provider) {
      await admin.insert('message_translations', { message_id: id, target, text, provider }, { onConflict: 'message_id,target', ignoreDuplicates: true, returning: false });
    },

    // ----- check-in ----------------------------------------------------------
    async loadGame(accessToken, gameId) {
      const row = first(await asUser(accessToken).select('game_views', { columns: 'id,status,starts_at,ends_at,lat,lng', filters: [['id', 'eq', gameId]] }));
      if (!row) return null;
      const lat = row['lat'];
      const lng = row['lng'];
      return {
        id: str(row['id']),
        status: str(row['status']) as 'scheduled',
        startsAt: iso(row['starts_at']),
        endsAt: iso(row['ends_at']),
        location: typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null,
      };
    },
    async loadParticipant(gameId, userId) {
      const r = await loadParticipantRow(gameId, userId);
      return r ? rowToParticipant(r) : null;
    },
    async recordVerdict(gameId, userId, verdict) {
      return (await admin.rpc<CheckInVerdict>('record_checkin_verdict', { p_game_id: gameId, p_user_id: userId, p_verdict: verdict })) ?? verdict;
    },

    // ----- trust -------------------------------------------------------------
    async venueCreator(venueId) {
      const row = first(await admin.select('venues', { columns: 'created_by', filters: [['id', 'eq', venueId]] }));
      return row ? strOrNull(row['created_by']) : null;
    },
    async loadTrustState(userId: UserId, event: DomainTrustEvent, now: number, config: TrustConfig): Promise<TrustState> {
      const sinceReports = new Date(now - config.toxicityWindowDays * 2 * DAY_MS).toISOString();
      const sinceRatings = new Date(now - 365 * DAY_MS).toISOString();
      const [sanctions, appeals, chat, reports, ratings, review, created, payments, lateCancels] = await Promise.all([
        admin.select('sanctions', { filters: [['user_id', 'eq', userId]], order: { column: 'created_at', ascending: false }, limit: 500 }),
        admin.select('appeals', { columns: 'id,sanction_id,user_id,is_dispute,status,decided_by,decided_at,created_at', filters: [['user_id', 'eq', userId]], limit: 200 }),
        loadChatTrustState(userId, now, config),
        admin.select('user_reports', { columns: 'id,reporter_id,target_user_id,category,game_id,message_id,created_at', filters: [['target_user_id', 'eq', userId], ['created_at', 'gte', sinceReports]], limit: 500 }),
        admin.select('host_ratings', { filters: [['host_id', 'eq', userId], ['created_at', 'gte', sinceRatings]], limit: 1000 }),
        admin.select('review_queue', { filters: [['subject_user_id', 'eq', userId], ['status', 'neq', 'resolved']], limit: 200 }),
        admin.select('venues', { columns: 'id,status,created_by', filters: [['created_by', 'eq', userId]], limit: 200 }),
        admin.select('payments', { columns: 'game_id,settlement_requested,deposit_state', filters: [['user_id', 'eq', userId]], limit: 500 }),
        admin.select('game_participants', { columns: 'game_id,cancelled_at,late_cancel,games(starts_at,status)', filters: [['user_id', 'eq', userId], ['late_cancel', 'eq', true]], limit: 100 }),
      ]);
      const reportList = reports.map(rowToUserReport);
      const reporterIds = [...new Set(reportList.map((r) => r.reporterId).filter((id) => id !== 'pseudonymised'))];
      const gameIds = [...new Set(reportList.map((r) => r.gameId).filter((g): g is string => g !== null))];
      const since7d = new Date(now - 7 * DAY_MS).toISOString();
      const [reporters, reporterReports, attendance] = await Promise.all([
        reporterIds.length ? admin.select('profiles', { columns: 'id,created_at,reliability_status', filters: [['id', 'in', reporterIds]] }) : Promise.resolve([]),
        reporterIds.length ? admin.select('user_reports', { columns: 'reporter_id,created_at,outcome', filters: [['reporter_id', 'in', reporterIds]], limit: 5000 }) : Promise.resolve([]),
        gameIds.length ? admin.select('game_participants', { columns: 'game_id,user_id,status,attendance,team', filters: [['game_id', 'in', gameIds]], limit: 5000 }) : Promise.resolve([]),
      ]);

      let venues: TrustState['venues'] = created.map((v) => ({ venueId: str(v['id']), status: str(v['status']) as 'active', createdBy: strOrNull(v['created_by']), lastReviewedAt: null, reports: [] }));
      if (event.type === 'VenueReported') {
        const venueId = event.report.venueId;
        const [venue, vreports, lastReview] = await Promise.all([
          admin.select('venues', { columns: 'id,status,created_by', filters: [['id', 'eq', venueId]] }),
          admin.select('venue_reports', { columns: 'id,venue_id,reporter_id,reason,created_at', filters: [['venue_id', 'eq', venueId]], limit: 500 }),
          admin.select('review_queue', { columns: 'resolved_at', filters: [['venue_id', 'eq', venueId], ['status', 'eq', 'resolved']], order: { column: 'resolved_at', ascending: false }, limit: 1 }),
        ]);
        const v = first(venue);
        if (v) {
          venues = [
            ...venues.filter((x) => x.venueId !== venueId),
            {
              venueId,
              status: str(v['status']) as 'active',
              createdBy: strOrNull(v['created_by']),
              lastReviewedAt: isoOrNull(first(lastReview)?.['resolved_at']),
              reports: vreports.map((r) => ({ id: str(r['id']), venueId, reporterId: str(r['reporter_id']), reason: str(r['reason']) as 'other', note: null, createdAt: iso(r['created_at']) })),
            },
          ];
        }
      }

      const sanctionList = sanctions.map(rowToSanction);
      return createTrustState(userId, {
        sanctions: sanctionList,
        appeals: appeals.map(rowToAppeal),
        chatBlocks: chat.chatBlocks,
        reports: reportList,
        reporterProfiles: reporters.map((p) => {
          const mine = reporterReports.filter((r) => r['reporter_id'] === p['id']);
          return {
            id: str(p['id']),
            createdAt: iso(p['created_at']),
            reliabilityStatus: str(p['reliability_status']) as ReliabilityStatus,
            reportsLast7d: mine.filter((r) => iso(r['created_at']) >= since7d).length,
            reportsResolved: mine.filter((r) => r['outcome'] === 'founded' || r['outcome'] === 'unfounded').length,
            reportsUpheld: mine.filter((r) => r['outcome'] === 'founded').length,
          };
        }),
        attendance: attendance.map((a) => ({
          gameId: str(a['game_id']),
          userId: str(a['user_id']),
          status: str(a['status']) as 'approved',
          attendance: str(a['attendance']) as 'unknown',
          team: typeof a['team'] === 'number' ? a['team'] : null,
        })),
        hostRatings: ratings.map((r) => ({ hostId: str(r['host_id']), gameId: str(r['game_id']), raterId: str(r['rater_id']), stars: Number(r['stars']) as Stars, at: iso(r['created_at']) })),
        reviewItems: review.map(rowToReviewItem),
        venues,
        overturns: sanctions.filter((s) => s['status'] === 'overturned').map((s) => ({ sanctionId: str(s['id']), at: iso(s['updated_at'] ?? s['created_at']) })),
        depositSettlements: payments
          .map((p) => {
            const requested = p['settlement_requested'];
            const state = p['deposit_state'];
            const outcome = requested === 'release' || state === 'released' ? 'release' : requested === 'forfeit' || state === 'forfeited' ? 'forfeit' : null;
            return outcome ? { gameId: str(p['game_id']), outcome: outcome as 'release' | 'forfeit' } : null;
          })
          .filter((x): x is { gameId: string; outcome: 'release' | 'forfeit' } => x !== null),
        pendingLateCancels: lateCancels
          .filter((p) => (p['games'] as Row | null)?.['status'] === 'scheduled' && p['cancelled_at'])
          .map((p) => ({ gameId: str(p['game_id']), startsAt: iso((p['games'] as Row)['starts_at']), cancelledAt: iso(p['cancelled_at']) })),
      });
    },

    // ----- deposits ----------------------------------------------------------
    async loadContext(gameId, userId) {
      const [game, participant, profile] = await Promise.all([
        loadGameRow(gameId),
        loadParticipantRow(gameId, userId),
        admin.select('profiles', { columns: 'country_code', filters: [['id', 'eq', userId]] }),
      ]);
      if (!game) return null;
      return { game: rowToGame(game), participant: participant ? rowToParticipant(participant) : null, countryCode: strOrNull(first(profile)?.['country_code']) };
    },
    async listPayments(userId, gameId) {
      return (await admin.select('payments', { filters: [['user_id', 'eq', userId], ['game_id', 'eq', gameId], ['purpose', 'eq', 'deposit']], order: { column: 'created_at', ascending: false }, limit: 20 })).map(rowToPayment);
    },
    getCustomer,
    async saveCustomer(userId, provider, customerId) {
      await admin.insert('payment_customers', { user_id: userId, provider, customer_id: customerId }, { onConflict: 'user_id,provider', ignoreDuplicates: true, returning: false });
      return (await getCustomer(userId, provider)) ?? customerId;
    },
    async insertPayment(p) {
      await admin.insert(
        'payments',
        { user_id: p.userId, game_id: p.gameId, purpose: 'deposit', amount_minor: p.amountMinor, currency: p.currency, provider: p.provider, step: p.step, idempotency_key: p.idempotencyKey },
        { onConflict: 'idempotency_key', ignoreDuplicates: true, returning: false },
      );
      const row = first(await admin.select('payments', { filters: [['idempotency_key', 'eq', p.idempotencyKey]] }));
      if (!row) throw new Error('payment insert returned no row');
      return rowToPayment(row);
    },
    async attachProviderRef(paymentId, ref, status) {
      await admin.update('payments', [['id', 'eq', paymentId], ['provider_ref', 'is', null]], { provider_ref: ref, status }, { returning: false });
    },

    // ----- webhook -----------------------------------------------------------
    async isProcessed(eventId) {
      return (await admin.select('payment_events', { columns: 'id', filters: [['id', 'eq', eventId]] })).length > 0;
    },
    async markProcessed(e) {
      await admin.insert('payment_events', { id: e.id, provider: e.provider, type: e.type, payment_id: e.paymentId }, { onConflict: 'id', ignoreDuplicates: true, returning: false });
    },
    async findPayment(by) {
      const filters: Filter[] = by.id ? [['id', 'eq', by.id]] : by.providerRef ? [['provider_ref', 'eq', by.providerRef]] : [];
      if (filters.length === 0) return null;
      const row = first(await admin.select('payments', { filters }));
      return row ? rowToPayment(row) : null;
    },
    async updatePayment(id, expected, patch) {
      const filters: Filter[] = [
        ['id', 'eq', id],
        ['status', 'eq', expected.status],
        ['deposit_state', 'eq', expected.depositState],
        expected.providerRef === null ? ['provider_ref', 'is', null] : ['provider_ref', 'eq', expected.providerRef],
      ];
      return (await admin.update('payments', filters, paymentPatch(patch))).length > 0;
    },
    async gameTitle(gameId) {
      return strOrNull(first(await admin.select('games', { columns: 'title', filters: [['id', 'eq', gameId]] }))?.['title']);
    },

    // ----- deposit jobs ------------------------------------------------------
    async getPayment(id) {
      const row = first(await admin.select('payments', { filters: [['id', 'eq', id]] }));
      return row ? rowToPayment(row) : null;
    },
    async loadDepositGame(gameId) {
      const r = await loadGameRow(gameId);
      return r ? rowToGame(r) : null;
    },
    async loadCard(gameId, userId): Promise<DepositCardRow | null> {
      const row = first(
        await admin.select('sanctions', {
          columns: 'status,dispute_until',
          filters: [['user_id', 'eq', userId], ['game_id', 'eq', gameId], ['reason_code', 'in', ['no_show', 'late_cancel']], ['kind', 'eq', 'yellow_card']],
          order: { column: 'created_at', ascending: false },
          limit: 1,
        }),
      );
      return row ? { status: str(row['status']) as DepositCardRow['status'], disputeUntil: isoOrNull(row['dispute_until']) } : null;
    },
    async dueHolds() {
      return ((await admin.rpc<Row[]>('due_deposit_holds')) ?? []).map((r) => str(r['payment_id']));
    },
    async dueSettlements() {
      return ((await admin.rpc<Row[]>('due_deposit_settlements')) ?? [])
        .filter((r) => r['outcome'] === 'release' || r['outcome'] === 'forfeit')
        .map((r) => ({ paymentId: str(r['payment_id']), outcome: r['outcome'] as 'release' | 'forfeit' }));
    },
    async markHoldRequested(id, at) {
      await admin.update('payments', [['id', 'eq', id]], { hold_requested_at: at }, { returning: false });
    },
    async startHold(id, expectedRef, next) {
      const filters: Filter[] = [['id', 'eq', id], ['step', 'eq', 'setup'], expectedRef === null ? ['provider_ref', 'is', null] : ['provider_ref', 'eq', expectedRef]];
      return (await admin.update('payments', filters, { provider_ref: next.providerRef, status: next.status, step: 'hold' })).length > 0;
    },
    async closeWithoutProvider(id, expectedState, next) {
      return (await admin.update('payments', [['id', 'eq', id], ['deposit_state', 'eq', expectedState]], { deposit_state: next })).length > 0;
    },
    async setSettlementRequested(id, outcome, at) {
      await admin.update('payments', [['id', 'eq', id]], { settlement_requested: outcome, settlement_requested_at: outcome ? at : null }, { returning: false });
    },

    // ----- account deletion ----------------------------------------------------
    async listDeposits(userId) {
      const rows = await admin.select('payments', { columns: '*,games(ends_at)', filters: [['user_id', 'eq', userId]], limit: 500 });
      return rows.map((r) => ({ ...rowToPayment(r), gameEndsAt: iso((r['games'] as Row | null)?.['ends_at'] ?? new Date(0).toISOString()) }));
    },
    async listCustomers(userId) {
      return (await admin.select('payment_customers', { columns: 'provider,customer_id', filters: [['user_id', 'eq', userId]] })).map((r) => ({
        provider: str(r['provider']) as PaymentProviderId,
        customerId: str(r['customer_id']),
      }));
    },
    async deleteMyAccount(accessToken) {
      await asUser(accessToken).rpc('delete_my_account');
    },
    async deleteAuthUser(userId) {
      await admin.deleteAuthUser(userId);
    },

    // ----- push ------------------------------------------------------------------
    async loadNotifications(ids): Promise<Notification[]> {
      const rows = await admin.select('notifications', { filters: [['id', 'in', ids]], limit: ids.length });
      return rows.map((r) => ({
        id: str(r['id']),
        userId: str(r['user_id']),
        kind: str(r['kind']) as Notification['kind'],
        params: (r['params'] ?? {}) as Notification['params'],
        gameId: strOrNull(r['game_id']),
        sanctionId: strOrNull(r['sanction_id']),
        readAt: isoOrNull(r['read_at']),
        createdAt: iso(r['created_at']) as IsoDateTime,
      }));
    },
    async loadLocales(userIds) {
      const rows = await admin.select('profiles', { columns: 'id,locale', filters: [['id', 'in', userIds]] });
      return new Map(rows.filter((r) => isLocale(r['locale'])).map((r) => [str(r['id']), r['locale'] as Locale] as const));
    },
    async loadTokens(userIds): Promise<PushToken[]> {
      const rows = await admin.select('push_tokens', { columns: 'user_id,token,platform', filters: [['user_id', 'in', userIds]], limit: 2000 });
      return rows.map((r) => ({ userId: str(r['user_id']), token: str(r['token']), platform: str(r['platform']) as PushToken['platform'] }));
    },
    async deleteTokens(tokens) {
      return admin.remove('push_tokens', [['token', 'in', tokens]]);
    },
  };
  return store;
}
