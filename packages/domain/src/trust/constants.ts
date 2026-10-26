/**
 * Fixed policy constants that are part of a rule's definition rather than a
 * tunable threshold. Tunable thresholds live in `TrustConfig` (types.ts) and the
 * `trust_config` table; the SQL mirrors hard-code these same values.
 *
 * Moved to `TrustConfig` in contract v2 (use the config field instead):
 * dispute auto-void (`disputeAutoVoidDays`, `disputeAutoVoidMaxPer90Days`),
 * overturn protection (`postOverturnProtectionDays`), finalisation and host-mark
 * grace (`finalizeAfterEndHours`), reporter accuracy (`reporterMinAccuracy`,
 * `reporterAccuracyMinReports`), host rating lookback (`hostRatingLookbackDays`)
 * and the waitlist offer windows (`waitlist*`).
 */

/** TRUST-023: the auto-void limit counts disputes in this many days (named in `disputeAutoVoidMaxPer90Days`). */
export const AUTO_VOID_LOOKBACK_DAYS = 90;

/** TRUST-011: a game "happened" with ≥ max(this, ⌈Game.minPlayers / 2⌉) verified players. */
export const GAME_HAPPENED_MIN_VERIFIED = 2;

/** TRUST-009: each confirmer's first N peer confirmations per game count. */
export const PEER_MAX_CONFIRMATIONS_PER_CONFIRMER = 6;

/** TRUST-041: reporters filing more than this in 7 days are treated as spamming. */
export const REPORT_SPAM_MAX_PER_7D = 10;

/** TRUST-045: severe-category reports get a P0-safety review due within this many hours. */
export const SEVERE_REPORT_SLA_HOURS = 1;

/**
 * AC-GAME-010: only regulars may join during this window after a recurring
 * instance opens. PRD allows 6–72 h per series; becomes a series field when
 * recurring games get a schema (deferred).
 */
export const REGULARS_PRIORITY_HOURS = 24;
