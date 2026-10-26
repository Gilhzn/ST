/**
 * Repeated chat blocks (CHAT-021): `chatBlocksForCard` blocked messages within
 * `chatBlocksWindowDays` → yellow card (disputable) + `chat_mute` for
 * `chatMuteHours` (caused by the card, so overturning the card lifts the mute).
 * Blocks up to the latest `chat_blocks` card are consumed. Nudges never count.
 */
import {
  DEFAULT_TRUST_CONFIG,
  type Effect,
  type EpochMs,
  type GameId,
  type IsoDateTime,
  type MessageId,
  type Sanction,
  type TrustConfig,
  type UserId,
} from '../types';
import { deriveSanctionId } from '../crypto/uuid';
import { DAY_MS, HOUR_MS, toEpochMs } from '../time';
import { buildSystemSanction, issueEffects } from './sanctions';

/** One blocked message (`moderation_retained` row) of the user. */
export interface ChatBlockRecord {
  gameId: GameId;
  at: IsoDateTime;
  /** Blocked message id, when known (de-duplication key). */
  messageId?: MessageId;
}

export interface ChatBlockEvaluation {
  blocksInWindow: number;
  triggered: boolean;
  effects: Effect[];
}

export function evaluateChatBlocks(
  userId: UserId,
  blocks: readonly ChatBlockRecord[],
  sanctions: readonly Sanction[],
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): ChatBlockEvaluation {
  const consumedUntil = Math.max(
    -Infinity,
    ...sanctions
      .filter((s) => s.userId === userId && s.reasonCode === 'chat_blocks' && s.kind === 'yellow_card')
      .map((s) => toEpochMs(s.startsAt)),
  );
  const since = Math.max(consumedUntil, now - config.chatBlocksWindowDays * DAY_MS);
  const counted = blocks
    .filter((b) => toEpochMs(b.at) > since && toEpochMs(b.at) <= now)
    .sort((a, b) => toEpochMs(a.at) - toEpochMs(b.at) || (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0));
  const result: ChatBlockEvaluation = { blocksInWindow: counted.length, triggered: false, effects: [] };
  if (counted.length < config.chatBlocksForCard) return result;

  const last = counted[counted.length - 1] as ChatBlockRecord;
  const key = `${userId}:${last.gameId}:${last.at}`;
  const card = buildSystemSanction(
    {
      kind: 'yellow_card',
      userId,
      reasonCode: 'chat_blocks',
      statementParams: { blocks: counted.length, windowDays: config.chatBlocksWindowDays },
      durationMs: config.yellowCardLifetimeDays * DAY_MS,
      disputeMs: config.disputeWindowHours * HOUR_MS,
      gameId: last.gameId,
      dedupeKey: `chat_blocks:${key}`,
    },
    now,
  );
  const mute = buildSystemSanction(
    {
      kind: 'chat_mute',
      userId,
      reasonCode: 'chat_blocks',
      statementParams: { hours: config.chatMuteHours, blocks: counted.length },
      durationMs: config.chatMuteHours * HOUR_MS,
      gameId: last.gameId,
      causedBy: [deriveSanctionId(card.dedupeKey)],
      dedupeKey: `chat_mute:${key}`,
    },
    now,
  );
  result.triggered = true;
  result.effects.push(...issueEffects(card), ...issueEffects(mute));
  return result;
}
