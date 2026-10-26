/**
 * Sanction construction and queries shared by every trust rule.
 *
 * Compliance invariants (ADR 0004), enforced here for every system decision:
 * - `decidedBy: 'system'` sanctions always have a non-null `expiresAt`;
 *   `permanent_ban` is only built by {@link buildModeratorPermanentBan}.
 * - Every sanction carries `reasonCode`, `statementKey`
 *   (`sanctions.reason.<reasonCode>`) and an appeal path in
 *   `statementParams.appealPath` (`dispute` within the dispute window, else
 *   `appeal`), and a deterministic `dedupeKey`.
 */
import type {
  Effect,
  EpochMs,
  GameId,
  IsoDateTime,
  NewReviewQueueItem,
  NewSanction,
  NotificationKind,
  ReviewKind,
  ReviewPriority,
  ReviewQueueItem,
  Sanction,
  SanctionId,
  SanctionKind,
  SanctionReasonCode,
  SanctionStatementKey,
  UserId,
} from '../types';
import { deriveReviewItemId, deriveSanctionId } from '../crypto/uuid';
import { HOUR_MS, toEpochMs, toIso } from '../time';

/** How the user can contest a sanction; surfaced in the statement of reasons. */
export type AppealPath = 'dispute' | 'appeal';

/** Statuses in which a sanction is in force (a dispute does not suspend it). */
export const IN_FORCE_STATUSES = ['active', 'disputed', 'upheld'] as const;

/** Review SLA in hours by priority (target `dueBy`). */
export const REVIEW_SLA_HOURS: Readonly<Record<ReviewPriority, number>> = { high: 24, normal: 48, low: 72 };

/** Restriction kinds and the projection effect that mirrors them onto `profiles.*_until`. */
export const PROJECTED_KINDS = ['join_ban', 'chat_mute', 'visibility_restriction', 'host_suspension'] as const;
export type ProjectedKind = (typeof PROJECTED_KINDS)[number];

export function statementKeyFor(reasonCode: SanctionReasonCode): SanctionStatementKey {
  return `sanctions.reason.${reasonCode}`;
}

/** True when the sanction is in force at `now` (status in force and not past `expiresAt`). */
export function isInForce(s: Sanction, now: EpochMs): boolean {
  if (!(IN_FORCE_STATUSES as readonly string[]).includes(s.status)) return false;
  return s.expiresAt === null || toEpochMs(s.expiresAt) > now;
}

/** In-force yellow cards, oldest first (ties by id). */
export function activeYellowCards(sanctions: readonly Sanction[], now: EpochMs): Sanction[] {
  return sanctions
    .filter((s) => s.kind === 'yellow_card' && isInForce(s, now))
    .sort((a, b) => toEpochMs(a.startsAt) - toEpochMs(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** True when the sanction can still be disputed at `now` (yellow cards, within `disputeUntil`, status active). */
export function canDispute(s: Sanction, now: EpochMs): boolean {
  return s.status === 'active' && s.disputeUntil !== null && now <= toEpochMs(s.disputeUntil);
}

/** Arguments for a system-issued (always temporary) sanction. */
export interface SystemSanctionArgs {
  kind: Exclude<SanctionKind, 'permanent_ban'>;
  userId: UserId;
  reasonCode: SanctionReasonCode;
  statementParams?: Readonly<Record<string, string | number>>;
  /** Duration from `now`; must be > 0. */
  durationMs: number;
  /** Yellow cards: dispute window length. */
  disputeMs?: number | null;
  gameId?: GameId | null;
  causedBy?: readonly SanctionId[];
  dedupeKey: string;
  /** Defaults to `system`. A moderator may issue the same temporary measures. */
  decidedBy?: 'system' | 'moderator';
}

/** Builds a system sanction starting at `now`. Never permanent (enforced by type and at runtime). */
export function buildSystemSanction(args: SystemSanctionArgs, now: EpochMs): NewSanction {
  if (!(args.durationMs > 0) || !Number.isFinite(args.durationMs)) {
    throw new RangeError('System sanctions must have a finite positive duration');
  }
  if ((args.kind as SanctionKind) === 'permanent_ban') throw new RangeError('The system never issues permanent bans');
  const disputeUntil = args.disputeMs ? toIso(now + args.disputeMs) : null;
  return {
    kind: args.kind,
    userId: args.userId,
    reasonCode: args.reasonCode,
    statementKey: statementKeyFor(args.reasonCode),
    statementParams: { ...args.statementParams, appealPath: disputeUntil ? 'dispute' : 'appeal' },
    startsAt: toIso(now),
    expiresAt: toIso(now + args.durationMs),
    disputeUntil,
    gameId: args.gameId ?? null,
    causedBy: args.causedBy ?? [],
    dedupeKey: args.dedupeKey,
    decidedBy: args.decidedBy ?? 'system',
  };
}

/** A moderator's permanent ban (the only path that produces `permanent_ban`). */
export function buildModeratorPermanentBan(
  userId: UserId,
  dedupeKey: string,
  now: EpochMs,
  causedBy: readonly SanctionId[] = [],
): NewSanction {
  return {
    kind: 'permanent_ban',
    userId,
    reasonCode: 'moderator_decision',
    statementKey: statementKeyFor('moderator_decision'),
    statementParams: { appealPath: 'appeal' },
    startsAt: toIso(now),
    expiresAt: null,
    disputeUntil: null,
    gameId: null,
    causedBy,
    dedupeKey,
    decidedBy: 'moderator',
  };
}

/** Materialises an emitted sanction as the row the adapter will insert (id derived from `dedupeKey`). */
export function materializeSanction(s: NewSanction, now: EpochMs): Sanction {
  return { ...s, id: deriveSanctionId(s.dedupeKey), status: 'active', createdAt: toIso(now) } as Sanction;
}

/** The projection effect for a restriction kind. */
export function projectionEffect(kind: ProjectedKind, userId: UserId, until: IsoDateTime): Effect {
  switch (kind) {
    case 'join_ban':
      return { type: 'BanJoins', userId, until };
    case 'chat_mute':
      return { type: 'MuteChat', userId, until };
    case 'visibility_restriction':
      return { type: 'RestrictVisibility', userId, until };
    case 'host_suspension':
      return { type: 'SuspendHost', userId, until };
  }
}

export function isProjectedKind(kind: SanctionKind): kind is ProjectedKind {
  return (PROJECTED_KINDS as readonly string[]).includes(kind);
}

/** Notification kind used when a sanction is issued. */
export function notificationKindFor(kind: SanctionKind): NotificationKind {
  if (kind === 'visibility_restriction') return 'visibility_restricted';
  if (kind === 'chat_mute') return 'chat_muted';
  return 'sanction_issued';
}

/** `Notify` effect carrying the statement of reasons for a new sanction. */
export function sanctionNotice(s: NewSanction): Effect {
  return {
    type: 'Notify',
    userId: s.userId,
    kind: notificationKindFor(s.kind),
    params: {
      sanctionKind: s.kind,
      reasonCode: s.reasonCode,
      statementKey: s.statementKey,
      expiresAt: s.expiresAt ?? '',
      disputeUntil: s.disputeUntil ?? '',
      appealPath: s.disputeUntil ? 'dispute' : 'appeal',
    },
    gameId: s.gameId,
    sanctionDedupeKey: s.dedupeKey,
  };
}

/**
 * Effects for issuing a sanction: `IssueSanction`, its projection (restriction
 * kinds) and the user notice, in that order.
 */
export function issueEffects(s: NewSanction): Effect[] {
  const effects: Effect[] = [{ type: 'IssueSanction', sanction: s }];
  if (isProjectedKind(s.kind) && s.expiresAt) effects.push(projectionEffect(s.kind, s.userId, s.expiresAt));
  effects.push(sanctionNotice(s));
  return effects;
}

/** Arguments for a review queue item. */
export interface ReviewArgs {
  kind: ReviewKind;
  priority: ReviewPriority;
  dedupeKey: string;
  subjectUserId?: UserId | null;
  venueId?: string | null;
  gameId?: GameId | null;
  sanctionId?: SanctionId | null;
  appealId?: string | null;
  reportIds?: readonly string[];
  evidence?: Readonly<Record<string, string | number | boolean | null>>;
}

export function buildReviewItem(args: ReviewArgs, now: EpochMs): NewReviewQueueItem {
  return {
    kind: args.kind,
    priority: args.priority,
    subjectUserId: args.subjectUserId ?? null,
    venueId: args.venueId ?? null,
    gameId: args.gameId ?? null,
    sanctionId: args.sanctionId ?? null,
    appealId: args.appealId ?? null,
    reportIds: args.reportIds ?? [],
    evidence: args.evidence ?? {},
    dueBy: toIso(now + REVIEW_SLA_HOURS[args.priority] * HOUR_MS),
    dedupeKey: args.dedupeKey,
  };
}

/** Materialises an enqueued item as the row the adapter will insert. */
export function materializeReviewItem(item: NewReviewQueueItem, now: EpochMs): ReviewQueueItem {
  return {
    ...item,
    id: deriveReviewItemId(item.dedupeKey),
    status: 'open',
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: toIso(now),
  };
}
