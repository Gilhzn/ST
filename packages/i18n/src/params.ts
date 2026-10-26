import type { NotificationKind, SanctionReasonCode } from '@st/domain';

/**
 * ICU parameters each statement of reasons may use. The server puts them in
 * `Sanction.statementParams`, and the client renders both
 * `trust:sanctions.reason.<code>` and `trust:sanctions.fix.<code>` with the same
 * object. `scripts/validate.ts` checks that the English copy uses exactly these.
 *
 * Plural counts (`hours`, `days`, `cards`, ...) are numbers; dates and names are
 * strings already formatted for the recipient's locale.
 */
export const STATEMENT_PARAMS = {
  late_cancel: ['date', 'gameTitle', 'hours'],
  no_show: ['date', 'gameTitle'],
  chat_blocks: ['count', 'days'],
  escalation_two_cards: ['cards', 'days', 'games'],
  escalation_three_cards: ['cards', 'days', 'games'],
  toxicity_reports: ['reporters', 'days'],
  fake_venue: ['venueName'],
  low_host_rating: ['count', 'average'],
  moderator_decision: ['reason'],
} as const satisfies Record<SanctionReasonCode, readonly string[]>;

/**
 * ICU parameters each notification may use (`Notification.params`). The server
 * renders `notifications:<kind>.title|body` with the recipient's locale.
 */
export const NOTIFICATION_PARAMS = {
  join_requested: ['name', 'gameTitle'],
  join_approved: ['gameTitle', 'time'],
  join_rejected: ['gameTitle'],
  join_waitlisted: ['gameTitle', 'position'],
  waitlist_offer: [],
  waitlist_promoted: ['gameTitle', 'time'],
  participant_removed: ['gameTitle'],
  game_cancelled: ['gameTitle', 'time'],
  game_reminder: ['gameTitle', 'time', 'minutes'],
  checkin_open: ['gameTitle'],
  result_requested: ['gameTitle', 'hours'],
  sanction_issued: [],
  sanction_decided: [],
  appeal_decided: ['outcome'],
  visibility_restricted: ['hours'],
  chat_muted: ['time'],
  venue_hidden: ['venueName'],
  deposit_action_required: ['gameTitle', 'amount'],
} as const satisfies Record<NotificationKind, readonly string[]>;
