/**
 * moderation-recheck: re-moderates messages delivered as `pending` because the
 * providers failed or timed out (CHAT-011). Invoked by the
 * `recheck_pending_messages` job (`st_dispatch`), internal callers only.
 *
 * POST { messageIds: uuid[] } → { checked, allowed, nudged, retracted, stillPending, escalated }
 *
 * - allow / nudge → the stored verdict is updated;
 * - block → the message is retracted (`retracted_at`, Broadcast `retracted`),
 *   copied to 90-day retention, and counted by the trust engine like any block;
 * - still unavailable after {@link RECHECK_ESCALATE_AFTER_MS} → a `chat_recheck`
 *   review item so a human looks at it.
 */
import {
  StError,
  applyTrustEvent,
  buildReviewItem,
  type ChatEvent,
  type ChatMessage,
  type Effect,
  type GameId,
  type IsoDateTime,
  type Locale,
  type MessageId,
  type ModerationCategory,
  type ModerationDecision,
  type TrustConfig,
  type TrustState,
  type UserId,
} from '@st/domain';
import { requireInternalCaller } from '#shared/auth';
import type { ConfigSource } from '#shared/config';
import { json, readJson, route } from '#shared/http';
import type { Logger } from '#shared/log';
import { moderate, type ModerationDeps } from '#shared/moderation';
import type { Clock } from '#shared/runtime';
import { arrayField, isUuid } from '#shared/validate';

export const RECHECK_ESCALATE_AFTER_MS = 10 * 60_000;
export const RECHECK_MAX_BATCH = 100;

export interface PendingMessage {
  message: ChatMessage;
  senderLocale: Locale;
  /** Up to 5 earlier messages of the same game, oldest first. */
  history: { senderId: UserId; body: string }[];
}

export interface RecheckStore {
  loadPending(ids: readonly MessageId[]): Promise<PendingMessage[]>;
  setModeration(id: MessageId, decision: Exclude<ModerationDecision, 'block' | 'pending'>): Promise<void>;
  retract(id: MessageId, at: IsoDateTime): Promise<boolean>;
  retain(msg: { messageId: MessageId; gameId: GameId; senderId: UserId; body: string; categories: readonly ModerationCategory[]; retainedAt: IsoDateTime; expiresAt: IsoDateTime }): Promise<void>;
  loadChatTrustState(userId: UserId, now: number, config: TrustConfig): Promise<TrustState>;
  applyEffects(effects: readonly Effect[]): Promise<void>;
  broadcast(gameId: GameId, event: ChatEvent): Promise<void>;
}

export interface RecheckDeps {
  internalSecrets: readonly string[];
  store: RecheckStore;
  moderation: Omit<ModerationDeps, 'timeoutMs'> & { timeoutMs?: number };
  config: ConfigSource;
  clock: Clock;
  log: Logger;
}

export async function handle(req: Request, deps: RecheckDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'] }, async () => {
    requireInternalCaller(req, deps.internalSecrets);
    const input = await readJson(req, 256 * 1024);
    const ids = arrayField(input, 'messageIds', 1000).filter(isUuid).slice(0, RECHECK_MAX_BATCH);
    if (ids.length === 0) throw new StError('validation', 'messageIds required', { field: 'messageIds' });

    const config = await deps.config.get();
    const now = deps.clock.now();
    const nowIso = new Date(now).toISOString();
    const counts = { checked: 0, allowed: 0, nudged: 0, retracted: 0, stillPending: 0, escalated: 0 };

    for (const p of await deps.store.loadPending(ids)) {
      counts.checked++;
      const m = p.message;
      const run = await moderate(
        { text: m.body, locale: p.senderLocale, history: p.history.map((h) => ({ fromSender: h.senderId === m.senderId, text: h.body })) },
        { ...deps.moderation, timeoutMs: deps.moderation.timeoutMs ?? config.moderationTimeoutMs * 2 },
      );
      const v = run.verdict;
      if (v.decision === 'allow' || v.decision === 'nudge') {
        await deps.store.setModeration(m.id, v.decision);
        counts[v.decision === 'allow' ? 'allowed' : 'nudged']++;
        continue;
      }
      if (v.decision === 'pending') {
        counts.stillPending++;
        if (now - Date.parse(m.createdAt) >= RECHECK_ESCALATE_AFTER_MS) {
          await deps.store.applyEffects([
            {
              type: 'EnqueueReview',
              item: buildReviewItem(
                { kind: 'chat_recheck', priority: 'normal', dedupeKey: `chat_recheck:${m.id}`, subjectUserId: m.senderId, gameId: m.gameId, evidence: { messageId: m.id } },
                now,
              ),
            },
          ]);
          counts.escalated++;
        }
        continue;
      }
      // Block after delivery: retract for everyone, retain, count.
      if (!(await deps.store.retract(m.id, nowIso))) continue; // already retracted elsewhere
      await deps.store.retain({
        messageId: m.id,
        gameId: m.gameId,
        senderId: m.senderId,
        body: m.body,
        categories: v.categories,
        retainedAt: nowIso,
        expiresAt: new Date(now + config.moderationRetentionDays * 86_400_000).toISOString(),
      });
      const state = await deps.store.loadChatTrustState(m.senderId, now, config);
      const { effects } = applyTrustEvent(state, { type: 'ChatMessageBlocked', gameId: m.gameId, userId: m.senderId, at: nowIso, categories: v.categories }, config, now);
      if (effects.length > 0) await deps.store.applyEffects(effects);
      try {
        await deps.store.broadcast(m.gameId, { type: 'retracted', messageId: m.id, at: nowIso });
      } catch (error) {
        deps.log.warn('chat.broadcast_failed', { gameId: m.gameId, error });
      }
      counts.retracted++;
    }
    deps.log.info('chat.recheck', counts);
    return json(counts);
  });
}
