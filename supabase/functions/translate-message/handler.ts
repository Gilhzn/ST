/**
 * translate-message: on-demand translation of one chat message (CHAT-030…032).
 *
 * POST { messageId, target? }  (user JWT) → { messageId, target, text, provider, cached, sameLanguage }
 *
 * - The message is read *as the caller* (RLS: approved participant, not
 *   expired, not from a blocked user), so translation never widens access.
 * - Target defaults to the caller's profile locale.
 * - Cache: `message_translations` (message, target); purged with the message.
 * - Provider chain: Google → DeepL → Claude. All failing → 503 `unavailable`
 *   (the app hides the button, NFR-012).
 * - Moderation runs on the original: pending messages are not translated yet,
 *   blocked ones are never stored, retracted ones are not served.
 */
import { StError, type Locale, type MessageId, type TranslationProvider, type UserId } from '@st/domain';
import { requireUser, type AuthVerifier } from '#shared/auth';
import { json, readJson, route, type CorsOptions } from '#shared/http';
import type { Logger } from '#shared/log';
import type { Clock, RateLimiter } from '#shared/runtime';
import { isSameLanguage, translateWithFallback, type Translator } from '#shared/translate';
import { localeField, uuidField } from '#shared/validate';

export interface VisibleMessage {
  id: MessageId;
  body: string;
  lang: string | null;
  moderation: 'allow' | 'nudge' | 'pending';
  retractedAt: string | null;
}

export interface TranslateStore {
  /** Reads the message with the caller's token (RLS); `null` when not visible. */
  loadVisibleMessage(accessToken: string, id: MessageId): Promise<VisibleMessage | null>;
  getUserLocale(userId: UserId): Promise<Locale>;
  getCached(id: MessageId, target: Locale): Promise<{ text: string; provider: TranslationProvider } | null>;
  saveCached(id: MessageId, target: Locale, text: string, provider: TranslationProvider): Promise<void>;
}

export interface TranslateDeps {
  auth: AuthVerifier;
  store: TranslateStore;
  translators: readonly Translator[];
  timeoutMs: number;
  rateLimiter: RateLimiter;
  clock: Clock;
  log: Logger;
  cors: CorsOptions;
}

export interface TranslateResponse {
  messageId: MessageId;
  target: Locale;
  text: string;
  provider: TranslationProvider | null;
  cached: boolean;
  sameLanguage: boolean;
}

export async function handle(req: Request, deps: TranslateDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'], cors: deps.cors }, async (cors) => {
    const user = await requireUser(req, deps.auth);
    const input = await readJson(req, 4 * 1024);
    const messageId = uuidField(input, 'messageId');
    const requested = localeField(input, 'target');

    const limit = await deps.rateLimiter.hit(`translate:${user.userId}`, 60, 60_000);
    if (!limit.allowed) throw new StError('rate_limited', 'too many translations', { retryAfterMs: limit.retryAfterMs });

    const message = await deps.store.loadVisibleMessage(user.accessToken, messageId);
    if (!message || message.retractedAt) throw new StError('not_found');
    if (message.moderation === 'pending') throw new StError('conflict', 'message is still being checked', { reason: 'moderation_pending' });

    const target = requested ?? (await deps.store.getUserLocale(user.userId));
    const reply = (text: string, provider: TranslationProvider | null, cached: boolean, sameLanguage: boolean) =>
      json({ messageId, target, text, provider, cached, sameLanguage } satisfies TranslateResponse, 200, cors);

    if (isSameLanguage(message.lang, target)) return reply(message.body, null, false, true);

    const hit = await deps.store.getCached(messageId, target);
    if (hit) return reply(hit.text, hit.provider, true, false);

    const result = await translateWithFallback(deps.translators, { text: message.body, target, source: message.lang }, deps.timeoutMs, deps.clock);
    if (!result) {
      deps.log.warn('translate.all_failed', { messageId, target });
      throw new StError('unavailable', 'translation unavailable');
    }
    if (result.failed.length > 0) deps.log.info('translate.fallback', { messageId, target, provider: result.provider, failed: result.failed });
    if (result.detectedSource && isSameLanguage(result.detectedSource, target)) return reply(message.body, null, false, true);

    await deps.store.saveCached(messageId, target, result.text, result.provider);
    return reply(result.text, result.provider, false, false);
  });
}
