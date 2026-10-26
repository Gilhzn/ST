/**
 * send-message: the only write path into game chat (architecture §5.3).
 *
 * POST { gameId, body, clientMsgId, lang?, confirmNudge? }  (user JWT)
 * → 200 SendMessageResult & { requiresConfirmation }
 *
 * 1. Caller is an approved participant (host included), not muted or banned,
 *    not under a visibility restriction for a game that has not started yet,
 *    and the chat is open (until `ends_at`, CHAT-002).
 * 2. Body is sanitised (bidi controls stripped, NFC, ≤ 1000 chars) and rate
 *    limited (20/min, 5 identical → spam block; CHAT-022).
 * 3. Blocklist + omni-moderation ∥ Claude classifier (1.5 s) → domain policy:
 *    - allow / pending → stored and broadcast on `game:<id>`; pending is re-checked
 *      by `moderation-recheck` (CHAT-011);
 *    - nudge → returned for confirmation; stored only when resent with `confirmNudge`;
 *    - block → not stored in chat; retained 90 days; counted by the trust engine
 *      (3 blocks / 7 days → yellow card + 24 h mute, CHAT-021) via `apply_effects`.
 * Message text is never logged.
 */
import {
  StError,
  applyTrustEvent,
  type ChatEvent,
  type ChatMessage,
  type Effect,
  type GameId,
  type GameStatus,
  type IsoDateTime,
  type Locale,
  type ModerationCategory,
  type ModerationDecision,
  type ModerationVerdict,
  type SendMessageResult,
  type TrustConfig,
  type TrustState,
  type UserId,
} from '@st/domain';
import { requireUser, type AuthVerifier } from '#shared/auth';
import type { ConfigSource } from '#shared/config';
import { json, readJson, route, type CorsOptions } from '#shared/http';
import type { Logger } from '#shared/log';
import { moderate, type ModerationDeps } from '#shared/moderation';
import type { Clock, RateLimiter } from '#shared/runtime';
import { sanitizeMessage } from '#shared/text';
import { booleanField, stringField, uuidField } from '#shared/validate';

export interface ChatContext {
  game: { id: GameId; startsAt: IsoDateTime; endsAt: IsoDateTime; status: GameStatus };
  /** Host or approved participant. */
  isMember: boolean;
  sender: {
    chatMutedUntil: IsoDateTime | null;
    /** TRUST-043: a restricted user cannot reach players of games that have not started. */
    visibilityRestrictedUntil: IsoDateTime | null;
    permanentlyBanned: boolean;
    deleted: boolean;
    createdAt: IsoDateTime;
    locale: Locale;
  };
}

export interface NewChatMessage {
  gameId: GameId;
  senderId: UserId;
  body: string;
  lang: string | null;
  clientMsgId: string;
  moderation: Exclude<ModerationDecision, 'block'>;
}

export interface RetainedMessage {
  messageId: string | null;
  gameId: GameId;
  senderId: UserId;
  body: string;
  categories: readonly ModerationCategory[];
  retainedAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

export interface SendMessageStore {
  loadChatContext(gameId: GameId, userId: UserId): Promise<ChatContext | null>;
  findByClientMsgId(userId: UserId, clientMsgId: string): Promise<ChatMessage | null>;
  countMessagesSince(userId: UserId, since: IsoDateTime): Promise<number>;
  countIdenticalSince(userId: UserId, body: string, since: IsoDateTime): Promise<number>;
  /** Last `limit` messages of the game, oldest first. */
  recentHistory(gameId: GameId, limit: number): Promise<{ senderId: UserId; body: string }[]>;
  /** Inserts; on (sender, clientMsgId) conflict returns the existing row. */
  insertMessage(msg: NewChatMessage): Promise<ChatMessage>;
  retain(msg: RetainedMessage): Promise<void>;
  /** Trust state with the user's chat blocks and chat-related sanctions. */
  loadChatTrustState(userId: UserId, now: number, config: TrustConfig): Promise<TrustState>;
  applyEffects(effects: readonly Effect[]): Promise<void>;
  broadcast(gameId: GameId, event: ChatEvent): Promise<void>;
}

export interface SendMessageDeps {
  auth: AuthVerifier;
  store: SendMessageStore;
  moderation: Omit<ModerationDeps, 'timeoutMs'> & { timeoutMs?: number };
  config: ConfigSource;
  rateLimiter: RateLimiter;
  clock: Clock;
  log: Logger;
  cors: CorsOptions;
}

export interface SendMessageResponse extends SendMessageResult {
  /** True for a nudge that was not sent: resend with `confirmNudge: true` to send it. */
  requiresConfirmation: boolean;
}

/** CHAT-022 limits. */
export const CHAT_LIMITS = {
  perMinute: 20,
  identicalWindowMs: 10 * 60_000,
  identicalMax: 5,
  linkMinAccountAgeDays: 7,
} as const;

const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|me|co|ly|gg|link|app|xyz|ru|cn)\b/i;
const LANG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

function blockVerdict(category: ModerationCategory): ModerationVerdict {
  return { decision: 'block', categories: [category], source: 'combined', reasonKey: `moderation.block.${category}` };
}

export async function handle(req: Request, deps: SendMessageDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'], cors: deps.cors }, async (cors) => {
    const user = await requireUser(req, deps.auth);
    const input = await readJson(req, 16 * 1024);
    const gameId = uuidField(input, 'gameId');
    const clientMsgId = stringField(input, 'clientMsgId', { max: 100 });
    const confirmNudge = booleanField(input, 'confirmNudge', false);
    const langRaw = stringField(input, 'lang', { max: 35, optional: true });
    const lang = langRaw && LANG_RE.test(langRaw) ? langRaw : null;
    const { text } = sanitizeMessage(input['body']);

    const burst = await deps.rateLimiter.hit(`chat:${user.userId}`, CHAT_LIMITS.perMinute, 60_000);
    if (!burst.allowed) throw new StError('rate_limited', 'too many messages', { retryAfterMs: burst.retryAfterMs });

    const now = deps.clock.now();
    const nowIso = new Date(now).toISOString();
    const ctx = await deps.store.loadChatContext(gameId, user.userId);
    if (!ctx) throw new StError('not_found');
    if (!ctx.isMember) throw new StError('forbidden', 'not an approved participant');
    if (ctx.sender.deleted || ctx.sender.permanentlyBanned) throw new StError('account_banned');
    if (ctx.sender.chatMutedUntil && Date.parse(ctx.sender.chatMutedUntil) > now) {
      throw new StError('chat_muted', 'chat muted', { mutedUntil: ctx.sender.chatMutedUntil });
    }
    if (ctx.game.status === 'cancelled' || now >= Date.parse(ctx.game.endsAt)) throw new StError('game_not_open', 'chat is read-only');
    const restricted = ctx.sender.visibilityRestrictedUntil;
    if (restricted && Date.parse(restricted) > now && now < Date.parse(ctx.game.startsAt)) {
      throw new StError('forbidden', 'visibility restricted', { reason: 'visibility_restricted', until: restricted });
    }

    // Offline retries resend the same clientMsgId: return the stored message (CHAT-042).
    const existing = await deps.store.findByClientMsgId(user.userId, clientMsgId);
    if (existing) {
      const verdict: ModerationVerdict = { decision: existing.moderation, categories: [], source: 'combined', reasonKey: null };
      return json({ verdict, message: existing, mutedUntil: null, requiresConfirmation: false } satisfies SendMessageResponse, 200, cors);
    }

    const recent = await deps.store.countMessagesSince(user.userId, new Date(now - 60_000).toISOString());
    if (recent >= CHAT_LIMITS.perMinute) throw new StError('rate_limited', 'too many messages');

    // CHAT-003: no links from accounts younger than 7 days (policy limit, not a moderation strike).
    const accountAgeMs = now - Date.parse(ctx.sender.createdAt);
    if (accountAgeMs < CHAT_LIMITS.linkMinAccountAgeDays * 86_400_000 && LINK_RE.test(text)) {
      throw new StError('forbidden', 'links are not allowed yet', { reason: 'links_new_account' });
    }

    const config = await deps.config.get();
    let verdict: ModerationVerdict;
    const identical = await deps.store.countIdenticalSince(user.userId, text, new Date(now - CHAT_LIMITS.identicalWindowMs).toISOString());
    if (identical >= CHAT_LIMITS.identicalMax - 1) {
      verdict = blockVerdict('spam');
    } else {
      const history = await deps.store.recentHistory(gameId, 5);
      const run = await moderate(
        { text, locale: ctx.sender.locale, history: history.map((h) => ({ fromSender: h.senderId === user.userId, text: h.body })) },
        { ...deps.moderation, timeoutMs: deps.moderation.timeoutMs ?? config.moderationTimeoutMs },
      );
      verdict = run.verdict;
      deps.log.info('chat.moderated', {
        gameId,
        decision: verdict.decision,
        categories: verdict.categories,
        providers: run.providers.map((p) => ({ name: p.name, outcome: p.outcome, decision: p.decision, ms: p.ms })),
      });
    }

    if (verdict.decision === 'block') {
      await deps.store.retain({
        messageId: null,
        gameId,
        senderId: user.userId,
        body: text,
        categories: verdict.categories,
        retainedAt: nowIso,
        expiresAt: new Date(now + config.moderationRetentionDays * 86_400_000).toISOString(),
      });
      const state = await deps.store.loadChatTrustState(user.userId, now, config);
      const { effects } = applyTrustEvent(
        state,
        { type: 'ChatMessageBlocked', gameId, userId: user.userId, at: nowIso, categories: verdict.categories },
        config,
        now,
      );
      if (effects.length > 0) await deps.store.applyEffects(effects);
      const mute = effects.find((e): e is Extract<Effect, { type: 'MuteChat' }> => e.type === 'MuteChat' && e.userId === user.userId);
      const body: SendMessageResponse = { verdict, message: null, mutedUntil: mute?.until ?? null, requiresConfirmation: false };
      return json(body, 200, cors);
    }

    if (verdict.decision === 'nudge' && !confirmNudge) {
      return json({ verdict, message: null, mutedUntil: null, requiresConfirmation: true } satisfies SendMessageResponse, 200, cors);
    }

    const message = await deps.store.insertMessage({ gameId, senderId: user.userId, body: text, lang, clientMsgId, moderation: verdict.decision });
    try {
      await deps.store.broadcast(gameId, { type: 'message', message });
    } catch (error) {
      // Delivery is still durable: clients refetch on reconnect.
      deps.log.warn('chat.broadcast_failed', { gameId, error });
    }
    return json({ verdict, message, mutedUntil: null, requiresConfirmation: false } satisfies SendMessageResponse, 200, cors);
  });
}
