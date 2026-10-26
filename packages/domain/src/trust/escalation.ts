/**
 * Yellow-card escalation, evaluated each time a card is issued:
 * - ≥ `reviewAtCards` in-force cards → `EnqueueReview(permanent_ban_candidate)` only.
 *   The system NEVER issues `permanent_ban`; a moderator decides.
 * - ≥ `joinBanLongAtCards` → `join_ban` for `joinBanLongDays` (`escalation_three_cards`).
 * - ≥ `joinBanShortAtCards` → `join_ban` for `joinBanShortDays` (`escalation_two_cards`).
 * Each step is keyed by the triggering card, so re-processing is idempotent
 * and every card triggers at most one escalation. `causedBy` lists the
 * in-force cards counted, so overturning any of them cascades.
 */
import { DEFAULT_TRUST_CONFIG, type Effect, type EpochMs, type Sanction, type TrustConfig } from '../types';
import { DAY_MS } from '../time';
import { activeYellowCards, buildReviewItem, buildSystemSanction, issueEffects } from './sanctions';

export interface EscalationOutcome {
  /** Number of in-force yellow cards counted. */
  activeCards: number;
  level: 'none' | 'join_ban_short' | 'join_ban_long' | 'review';
  effects: Effect[];
}

/**
 * @param sanctions the user's sanctions **including** the triggering card.
 * @param trigger the card that was just issued.
 */
export function evaluateEscalation(
  sanctions: readonly Sanction[],
  trigger: Sanction,
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): EscalationOutcome {
  const cards = activeYellowCards(sanctions, now);
  const n = cards.length;
  const causedBy = cards.map((c) => c.id);
  const userId = trigger.userId;
  if (n >= config.reviewAtCards) {
    const item = buildReviewItem(
      {
        kind: 'permanent_ban_candidate',
        priority: 'high',
        dedupeKey: `permanent_ban_candidate:${userId}:${trigger.id}`,
        subjectUserId: userId,
        gameId: trigger.gameId,
        sanctionId: trigger.id,
        evidence: { activeCards: n, triggerReason: trigger.reasonCode },
      },
      now,
    );
    return { activeCards: n, level: 'review', effects: [{ type: 'EnqueueReview', item }] };
  }
  const long = n >= config.joinBanLongAtCards;
  if (!long && n < config.joinBanShortAtCards) return { activeCards: n, level: 'none', effects: [] };
  const reasonCode = long ? 'escalation_three_cards' : 'escalation_two_cards';
  const days = long ? config.joinBanLongDays : config.joinBanShortDays;
  const ban = buildSystemSanction(
    {
      kind: 'join_ban',
      userId,
      reasonCode,
      statementParams: { cards: n, days },
      durationMs: days * DAY_MS,
      gameId: trigger.gameId,
      causedBy,
      dedupeKey: `${reasonCode}:${userId}:${trigger.id}`,
    },
    now,
  );
  return { activeCards: n, level: long ? 'join_ban_long' : 'join_ban_short', effects: issueEffects(ban) };
}
