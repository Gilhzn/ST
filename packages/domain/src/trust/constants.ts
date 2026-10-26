/**
 * PRD v5 thresholds that `TrustConfig` (types.ts, Architect-owned) does not have
 * yet. They are exported so adapters / SQL can mirror them, and each carries a
 * TODO to move into `TrustConfig` + `trust_config` (additive contract change).
 */

/** TODO(contract): TrustConfig.disputeAutoVoidDays — TRUST-023: an undecided dispute voids the card after this long. */
export const DISPUTE_AUTO_VOID_DAYS = 7;
/** TODO(contract): TrustConfig.autoVoidMaxDisputes90d — TRUST-023: auto-void applies only to a user's first N disputes in 90 days. */
export const AUTO_VOID_MAX_DISPUTES = 3;
export const AUTO_VOID_LOOKBACK_DAYS = 90;

/** TODO(contract): TrustConfig.overturnProtectionDays — TRUST-048: after an overturned restriction, report-based restrictions are review-only. */
export const OVERTURN_PROTECTION_DAYS = 14;

/** TODO(contract): TrustConfig.attendanceFinalizeHoursAfterEnd — TRUST-010: attendance is finalised at `ends_at + 2h`. */
export const ATTENDANCE_FINALIZE_HOURS_AFTER_END = 2;
/** TODO(contract): TrustConfig.hostMarkGraceHours — TRUST-008: the host may mark players present until `ends_at + 2h`. */
export const HOST_MARK_GRACE_HOURS = 2;
/** TODO(contract): Game.minPlayers — TRUST-011: a game "happened" with ≥ max(2, ⌈minPlayers/2⌉) verified players. */
export const GAME_HAPPENED_MIN_VERIFIED = 2;

/** TODO(contract): TrustConfig.peerMaxConfirmationsPerConfirmer — TRUST-009. */
export const PEER_MAX_CONFIRMATIONS_PER_CONFIRMER = 6;

/** TODO(contract): TrustConfig.reporterMinAccuracy / reporterAccuracyMinResolved — TRUST-041. */
export const REPORTER_MIN_ACCURACY = 0.3;
export const REPORTER_ACCURACY_MIN_RESOLVED = 5;
/** TODO(contract): TrustConfig.reportSpamMaxPer7d — reporters filing more than this in 7 days are spamming. */
export const REPORT_SPAM_MAX_PER_7D = 10;
/** TODO(contract): severe-report SLA (TRUST-045: P0-safety, 1 h). */
export const SEVERE_REPORT_SLA_HOURS = 1;

/** TODO(contract): TrustConfig.hostRatingWindowDays — TRUST-051(b): host ratings count over 90 days. */
export const HOST_RATING_WINDOW_DAYS = 90;

/** TODO(contract): waitlist offer windows — GAME-045. */
export const WAITLIST_STANDARD_MIN_LEAD_HOURS = 6;
export const WAITLIST_STANDARD_OFFER_MINUTES = 120;
export const WAITLIST_SHORT_OFFER_MINUTES = 20;
export const WAITLIST_FLASH_FILL_LEAD_MINUTES = 60;
/** TODO(contract): Game.regularsPriorityHours — AC-GAME-010: only regulars may join during this window after the instance opens. */
export const REGULARS_PRIORITY_HOURS = 24;
