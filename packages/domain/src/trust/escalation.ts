/**
 * Yellow-card escalation (TRUST-022 / TRUST-025).
 *
 * A card counts toward escalation once it is *settled*: in force and either
 * `upheld`, or `active` with its dispute window closed (`now > disputeUntil`).
 * A card inside its dispute window, or `disputed`, does not count until decided.
 * Escalation is therefore evaluated on `Tick` (dispute windows closing) and on a
 * moderator `uphold`, not at issuance.
 *
 * With n settled cards, when at least one of them is not yet covered by an
 * earlier escalation ban's `causedBy` (so expiring cards never re-trigger):
 * - n ≥ `joinBanShortAtCards` → `join_ban` `joinBanShortDays` (`escalation_two_cards`);
 * - n ≥ `joinBanLongAtCards`  → `join_ban` `joinBanLongDays`  (`escalation_three_cards`);
 * - n ≥ `reviewAtCards`       → the long ban **and** `EnqueueReview(permanent_ban_candidate, high)`.
 * The system NEVER issues `permanent_ban`; only a moderator can.
 * Keys derive from the newest uncovered card, so re-processing is idempotent.
 */
import { DEFAULT_TRUST_CONFIG, type Effect, type EpochMs, type Sanction, type TrustConfig } from '../types';
import { DAY_MS, toEpochMs } from '../time';
import { buildReviewItem, buildSystemSanction, isInForce, issueEffects } from './sanctions';

export interface EscalationOutcome {
  /** Number of settled in-force yellow cards counted. */
  activeCards: number;
  level: 'none' | 'join_ban_short' | 'join_ban_long' | 'review';
  effects: Effect[];
}

/** True when an in-force yellow card counts toward escalation at `now`. */
export function isSettledCard(s: Sanction, now: EpochMs): boolean {
  if (s.kind !== 'yellow_card' || !isInForce(s, now)) return false;
  if (s.status === 'upheld') return true;
  return s.status === 'active' && (s.disputeUntil === null || now > toEpochMs(s.disputeUntil));
}

/** Settled cards, oldest first (ties by id). */
export function settledCards(sanctions: readonly Sanction[], now: EpochMs): Sanction[] {
  return sanctions
    .filter((s) => isSettledCard(s, now))
    .sort((a, b) => toEpochMs(a.startsAt) - toEpochMs(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const ESCALATION_REASONS = new Set(['escalation_two_cards', 'escalation_three_cards']);

/** @param sanctions all of the user's sanctions. */
export function evaluateEscalation(
  sanctions: readonly Sanction[],
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): EscalationOutcome {
  const cards = settledCards(sanctions, now);
  const n = cards.length;
  const covered = new Set(sanctions.filter((s) => ESCALATION_REASONS.has(s.reasonCode)).flatMap((s) => s.causedBy));
  const fresh = cards.filter((c) => !covered.has(c.id));
  const trigger = fresh[fresh.length - 1];
  if (!trigger || n < config.joinBanShortAtCards) return { activeCards: n, level: 'none', effects: [] };

  const userId = trigger.userId;
  const long = n >= config.joinBanLongAtCards;
  const review = n >= config.reviewAtCards;
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
      causedBy: cards.map((c) => c.id),
      dedupeKey: `${reasonCode}:${userId}:${trigger.id}`,
    },
    now,
  );
  const effects = issueEffects(ban);
  if (review) {
    effects.push({
      type: 'EnqueueReview',
      item: buildReviewItem(
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
      ),
    });
  }
  return { activeCards: n, level: review ? 'review' : long ? 'join_ban_long' : 'join_ban_short', effects };
}
