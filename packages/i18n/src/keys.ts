import type {
  CheckInRejectReason,
  ErrorCode,
  ModerationCategory,
  NotificationKind,
  PositionId,
  ReliabilityStatus,
  SanctionKind,
  SanctionReasonCode,
  SanctionStatementKey,
  SportId,
  UserReportCategory,
  VenueReportReason,
} from '@st/domain';

/**
 * Typed builders for keys that come from domain enums, so the app never concatenates
 * key strings by hand. Every builder's output exists in `locales/en` (the check script
 * verifies coverage against `packages/domain/src/types.ts`).
 */

/** `errors:<code>` */
export const errorKey = (code: ErrorCode) => `errors:${code}` as const;

/** `trust:sanctions.reason.<code>` (render with `Sanction.statementParams`). */
export const sanctionReasonKey = (code: SanctionReasonCode) => `trust:sanctions.reason.${code}` as const;

/** Converts `Sanction.statementKey` (`sanctions.reason.<code>`) to a namespaced key. */
export const statementKey = (key: SanctionStatementKey) => `trust:${key}` as const;

/** `trust:sanctions.fix.<code>` ("how to get back on track"; same params as the statement). */
export const sanctionFixKey = (code: SanctionReasonCode) => `trust:sanctions.fix.${code}` as const;

/** `trust:sanctions.rule.<code>` (short rule name). */
export const sanctionRuleKey = (code: SanctionReasonCode) => `trust:sanctions.rule.${code}` as const;

/** `trust:sanctions.kind.<kind>.name|effect|stillAllowed` */
export const sanctionKindKey = (kind: SanctionKind, part: 'name' | 'effect' | 'stillAllowed') =>
  `trust:sanctions.kind.${kind}.${part}` as const;

/** `notifications:<kind>.title` and `.body` */
export const notificationKeys = (kind: NotificationKind) =>
  ({ title: `notifications:${kind}.title`, body: `notifications:${kind}.body` }) as const;

/** `checkin:reject.<reason>` */
export const checkInRejectKey = (reason: CheckInRejectReason) => `checkin:reject.${reason}` as const;

/** `chat:moderation.nudge.<category>` / `chat:moderation.block.<category>` (the verdict's `reasonKey`). */
export const moderationKey = (decision: 'nudge' | 'block', category: ModerationCategory) =>
  `chat:moderation.${decision}.${category}` as const;

/** `common:reliability.status.<status>` */
export const reliabilityStatusKey = (status: ReliabilityStatus) => `common:reliability.status.${status}` as const;

/** `common:sports.<id>` */
export const sportKey = (id: SportId) => `common:sports.${id}` as const;

/** `common:positions.<id>` and `common:positionsShort.<id>` */
export const positionKey = (id: PositionId, short = false) =>
  (short ? `common:positionsShort.${id}` : `common:positions.${id}`) as `common:positions.${PositionId}` | `common:positionsShort.${PositionId}`;

/** `games:venue.report.reason.<reason>` */
export const venueReportReasonKey = (reason: VenueReportReason) => `games:venue.report.reason.${reason}` as const;

/** `profile:report.category.<category>` */
export const userReportCategoryKey = (category: UserReportCategory) => `profile:report.category.${category}` as const;
