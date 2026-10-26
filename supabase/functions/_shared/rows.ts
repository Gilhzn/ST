/** snake_case row → contract type mappers. Timestamps are normalised to `toISOString()` form. */
import type {
  Appeal,
  ChatMessage,
  IsoDateTime,
  ReviewQueueItem,
  Sanction,
  UserReport,
} from '@st/domain';

type Row = Record<string, unknown>;

/** Postgres timestamps (`2026-11-10 18:00:00+00`) → `2026-11-10T18:00:00.000Z`. */
export function iso(value: unknown): IsoDateTime {
  if (typeof value !== 'string' && !(value instanceof Date)) throw new Error('timestamp expected');
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) throw new Error('invalid timestamp');
  return new Date(ms).toISOString();
}

export function isoOrNull(value: unknown): IsoDateTime | null {
  return value === null || value === undefined ? null : iso(value);
}

const s = (r: Row, k: string): string => String(r[k]);
const sn = (r: Row, k: string): string | null => (r[k] === null || r[k] === undefined ? null : String(r[k]));

export function rowToChatMessage(r: Row): ChatMessage {
  const moderation = s(r, 'moderation');
  return {
    id: s(r, 'id'),
    gameId: s(r, 'game_id'),
    senderId: s(r, 'sender_id'),
    body: s(r, 'body'),
    lang: sn(r, 'lang'),
    clientMsgId: s(r, 'client_msg_id'),
    moderation: moderation === 'nudge' || moderation === 'pending' ? moderation : 'allow',
    retractedAt: isoOrNull(r['retracted_at']),
    createdAt: iso(r['created_at']),
    expiresAt: iso(r['expires_at']),
  };
}

export function rowToSanction(r: Row): Sanction {
  const common = {
    id: s(r, 'id'),
    userId: s(r, 'user_id'),
    reasonCode: s(r, 'reason_code') as Sanction['reasonCode'],
    statementKey: s(r, 'statement_key') as Sanction['statementKey'],
    statementParams: (r['statement_params'] ?? {}) as Sanction['statementParams'],
    startsAt: iso(r['starts_at']),
    disputeUntil: isoOrNull(r['dispute_until']),
    status: s(r, 'status') as Sanction['status'],
    gameId: sn(r, 'game_id'),
    causedBy: Array.isArray(r['caused_by']) ? (r['caused_by'] as unknown[]).map(String) : [],
    dedupeKey: s(r, 'dedupe_key'),
    createdAt: iso(r['created_at']),
  };
  if (r['kind'] === 'permanent_ban') return { ...common, kind: 'permanent_ban', expiresAt: null, decidedBy: 'moderator' };
  return {
    ...common,
    kind: s(r, 'kind') as Exclude<Sanction['kind'], 'permanent_ban'>,
    expiresAt: iso(r['expires_at']),
    decidedBy: r['decided_by'] === 'moderator' ? 'moderator' : 'system',
  };
}

export function rowToAppeal(r: Row): Appeal {
  return {
    id: s(r, 'id'),
    sanctionId: s(r, 'sanction_id'),
    userId: s(r, 'user_id'),
    text: '', // appeal text is not needed by the engine and is not loaded
    isDispute: r['is_dispute'] === true,
    status: s(r, 'status') as Appeal['status'],
    decidedBy: sn(r, 'decided_by'),
    decisionNote: null,
    decidedAt: isoOrNull(r['decided_at']),
    createdAt: iso(r['created_at']),
  };
}

export function rowToUserReport(r: Row): UserReport {
  return {
    id: s(r, 'id'),
    reporterId: sn(r, 'reporter_id') ?? 'pseudonymised',
    targetUserId: s(r, 'target_user_id'),
    category: s(r, 'category') as UserReport['category'],
    gameId: sn(r, 'game_id'),
    messageId: sn(r, 'message_id'),
    note: null, // free text is not needed by the engine
    createdAt: iso(r['created_at']),
  };
}

export function rowToReviewItem(r: Row): ReviewQueueItem {
  return {
    id: s(r, 'id'),
    kind: s(r, 'kind') as ReviewQueueItem['kind'],
    status: s(r, 'status') as ReviewQueueItem['status'],
    priority: s(r, 'priority') as ReviewQueueItem['priority'],
    subjectUserId: sn(r, 'subject_user_id'),
    venueId: sn(r, 'venue_id'),
    gameId: sn(r, 'game_id'),
    sanctionId: sn(r, 'sanction_id'),
    appealId: sn(r, 'appeal_id'),
    reportIds: Array.isArray(r['report_ids']) ? (r['report_ids'] as unknown[]).map(String) : [],
    evidence: (r['evidence'] ?? {}) as ReviewQueueItem['evidence'],
    dueBy: iso(r['due_by']),
    dedupeKey: s(r, 'dedupe_key'),
    resolution: (sn(r, 'resolution') as ReviewQueueItem['resolution']) ?? null,
    resolvedBy: sn(r, 'resolved_by'),
    resolvedAt: isoOrNull(r['resolved_at']),
    createdAt: iso(r['created_at']),
  };
}
