/**
 * Toxicity reports → temporary visibility restriction (never a silent shadowban).
 * PRD v5 TRUST-041…048.
 *
 * A report is *counted* when it is about the target, inside `toxicityWindowDays`,
 * filed after the target's latest `toxicity_reports` sanction started (reports
 * are consumed by a restriction), and it qualifies:
 * - reporter ≠ target and has a profile; reliability not `red`;
 * - not spamming: ≤ {@link REPORT_SPAM_MAX_PER_7D} reports filed in the 7 days before `now`;
 * - accurate: once ≥ `config.reporterAccuracyMinReports` of their reports were resolved,
 *   ≥ `config.reporterMinAccuracy` of them were upheld;
 * - account ≥ `minReporterAccountAgeDays` old **when the report was filed**;
 * - co-attendance (TRUST-041): the report names a game in which the target was an
 *   approved participant and the reporter was an approved participant with attendance
 *   `verified` — or, for a reported chat message, any approved participant (same chat).
 *
 * With n ≥ `toxicityReporters` distinct qualifying reporters, collusion is
 * suspected (review only, no restriction, no notice to the target) when:
 * - (a) the reporters are not *independent*: their account creation times can be
 *   covered by fewer than `toxicityReporters` windows of `collusionCreationWindowHours`
 *   (so two accounts created within 48 h count once);
 * - `single_game`: every counted report names the same game (one game's players —
 *   e.g. a rival team — cannot restrict alone; AC-TRUST-043 needs ≥ 2 games);
 * - `no_gps_anchor`: no counted reporter was **GPS**-verified at the reported game
 *   while not being its host (QR can be relayed and the host can self-mark peers,
 *   so neither proves independent physical presence).
 * All tests are monotone: removing a reporter never increases severity.
 * Overturn protection (TRUST-048): if a toxicity restriction of the target was
 * overturned within `config.postOverturnProtectionDays`, the outcome is review only.
 * Otherwise → `visibility_restriction` for `visibilityRestrictionHours` +
 * `RestrictVisibility` + `Notify(visibility_restricted)` with the statement key +
 * `EnqueueReview(toxicity_reports)`. Nothing new is issued while one is in force.
 * Severe categories (TRUST-045, `violence`): every qualifying report also enqueues a
 * high-priority review due in {@link SEVERE_REPORT_SLA_HOURS}.
 */
import {
  DEFAULT_TRUST_CONFIG,
  type AttendanceStatus,
  type CheckInMethod,
  type Effect,
  type EpochMs,
  type GameId,
  type IsoDateTime,
  type ParticipantStatus,
  type ReliabilityStatus,
  type Sanction,
  type SanctionId,
  type TeamIndex,
  type TrustConfig,
  type UserId,
  type UserReport,
  type UserReportCategory,
  type UserReportId,
} from '../types';
import { deriveSanctionId } from '../crypto/uuid';
import { DAY_MS, HOUR_MS, toEpochMs, toIso } from '../time';
import { REPORT_SPAM_MAX_PER_7D, SEVERE_REPORT_SLA_HOURS } from './constants';
import { buildReviewItem, buildSystemSanction, isInForce, issueEffects } from './sanctions';

/** Categories that always reach a human quickly (TRUST-045). */
export const SEVERE_REPORT_CATEGORIES: readonly UserReportCategory[] = ['violence'];

/** What the engine needs to know about a reporter. */
export interface ReporterProfile {
  id: UserId;
  /** `profiles.created_at`. */
  createdAt: IsoDateTime;
  reliabilityStatus: ReliabilityStatus;
  /** Reports this user filed (about anyone) in the 7 days before `now`. */
  reportsLast7d: number;
  /** Reports by this user that a moderator resolved (for accuracy), if tracked. */
  reportsResolved?: number;
  /** Of those, how many were upheld. */
  reportsUpheld?: number;
}

/** One participation, used for the co-attendance and GPS-anchor checks. */
export interface GameAttendanceRecord {
  gameId: GameId;
  userId: UserId;
  status: ParticipantStatus;
  attendance: AttendanceStatus;
  /** How attendance was verified (`Participant.checkInMethod`); only `gps` anchors a report. */
  checkInMethod?: CheckInMethod | null;
  /** True for the game's host (a host is never an anchor). */
  isHost?: boolean;
  team?: TeamIndex | null;
}

/** When a sanction was overturned (from `ModeratorDecided.at` / the review item). */
export interface OverturnRecord {
  sanctionId: SanctionId;
  at: IsoDateTime;
}

/** Optional context for {@link evaluateReports}. */
export interface ReportContext {
  /** The target's sanctions (consumption, in-force and protection checks). */
  sanctions?: readonly Sanction[];
  /** Participations in the games named by the reports. */
  attendance?: readonly GameAttendanceRecord[];
  overturns?: readonly OverturnRecord[];
}

export type ReporterExclusion =
  | 'self'
  | 'unknown_profile'
  | 'red_status'
  | 'spamming'
  | 'low_accuracy'
  | 'account_too_new'
  | 'not_co_attendee';

export type CollusionReason = 'creation_window' | 'single_game' | 'no_gps_anchor' | 'overturn_protection';

export interface ReportEvaluation {
  /** `restrict` = restriction issued; `review_only` = collusion/protection; `none` below threshold. */
  outcome: 'none' | 'review_only' | 'restrict' | 'already_restricted';
  targetUserId: UserId | null;
  /** Distinct qualifying reporters, sorted. */
  qualifyingReporterIds: UserId[];
  /** Reports that individually qualified, sorted by time then id. */
  countedReportIds: UserReportId[];
  /** Independent reporter count (minimum number of creation windows covering them). */
  independentReporters: number;
  reviewReasons: CollusionReason[];
  excluded: { reporterId: UserId; reason: ReporterExclusion }[];
  effects: Effect[];
}

function byTimeThenId(a: UserReport, b: UserReport): number {
  return toEpochMs(a.createdAt) - toEpochMs(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Minimum number of windows of length `windowMs` covering all `times` (greedy is optimal). */
export function independentCount(times: readonly number[], windowMs: number): number {
  const sorted = times.slice().sort((a, b) => a - b);
  let count = 0;
  let windowStart = -Infinity;
  for (const t of sorted) {
    if (t - windowStart > windowMs) {
      count++;
      windowStart = t;
    }
  }
  return count;
}

function reporterExclusion(
  r: UserReport,
  target: UserId,
  p: ReporterProfile | undefined,
  attendance: ReadonlyMap<string, GameAttendanceRecord>,
  minAgeMs: number,
  config: TrustConfig,
): ReporterExclusion | null {
  if (r.reporterId === target) return 'self';
  if (!p) return 'unknown_profile';
  if (p.reliabilityStatus === 'red') return 'red_status';
  if (p.reportsLast7d > REPORT_SPAM_MAX_PER_7D) return 'spamming';
  const resolved = p.reportsResolved ?? 0;
  if (resolved >= config.reporterAccuracyMinReports && (p.reportsUpheld ?? 0) < config.reporterMinAccuracy * resolved) {
    return 'low_accuracy';
  }
  if (toEpochMs(r.createdAt) - toEpochMs(p.createdAt) < minAgeMs) return 'account_too_new';
  if (r.gameId === null) return 'not_co_attendee';
  const mine = attendance.get(`${r.gameId}|${r.reporterId}`);
  const theirs = attendance.get(`${r.gameId}|${target}`);
  const coAttended =
    theirs?.status === 'approved' &&
    mine?.status === 'approved' &&
    (mine.attendance === 'verified' || r.messageId !== null);
  return coAttended ? null : 'not_co_attendee';
}

/**
 * @param reports reports about one target (the target of the latest report is used; others are ignored).
 */
export function evaluateReports(
  reports: readonly UserReport[],
  reporterProfiles: readonly ReporterProfile[],
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
  context: ReportContext = {},
): ReportEvaluation {
  const sorted = reports.slice().sort(byTimeThenId);
  const target = sorted.length > 0 ? (sorted[sorted.length - 1] as UserReport).targetUserId : null;
  const result: ReportEvaluation = {
    outcome: 'none',
    targetUserId: target,
    qualifyingReporterIds: [],
    countedReportIds: [],
    independentReporters: 0,
    reviewReasons: [],
    excluded: [],
    effects: [],
  };
  if (target === null) return result;

  const sanctions = (context.sanctions ?? []).filter((s) => s.userId === target);
  const toxicity = sanctions.filter((s) => s.reasonCode === 'toxicity_reports');
  const consumedUntil = Math.max(-Infinity, ...toxicity.map((s) => toEpochMs(s.startsAt)));
  const windowStart = now - config.toxicityWindowDays * DAY_MS;
  const relevant = sorted.filter((r) => {
    const t = toEpochMs(r.createdAt);
    return r.targetUserId === target && t > windowStart && t <= now && t > consumedUntil;
  });

  const profiles = new Map(reporterProfiles.map((p) => [p.id, p] as const));
  const attendance = new Map((context.attendance ?? []).map((a) => [`${a.gameId}|${a.userId}`, a] as const));
  const minAge = config.minReporterAccountAgeDays * DAY_MS;
  const qualifying = new Map<UserId, ReporterProfile>();
  const exclusion = new Map<UserId, ReporterExclusion>();
  const counted: UserReport[] = [];
  for (const r of relevant) {
    const id = r.reporterId;
    const p = profiles.get(id);
    const reason = reporterExclusion(r, target, p, attendance, minAge, config);
    if (reason === null && p) {
      qualifying.set(id, p);
      exclusion.delete(id);
      counted.push(r);
    } else if (reason !== null && !qualifying.has(id) && !exclusion.has(id)) {
      exclusion.set(id, reason);
    }
  }
  result.qualifyingReporterIds = [...qualifying.keys()].sort();
  result.countedReportIds = counted.map((r) => r.id);
  result.excluded = [...exclusion.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([reporterId, reason]) => ({ reporterId, reason }));
  const created = [...qualifying.values()].map((p) => toEpochMs(p.createdAt));
  result.independentReporters = independentCount(created, config.collusionCreationWindowHours * HOUR_MS);

  for (const r of counted) {
    if (!SEVERE_REPORT_CATEGORIES.includes(r.category)) continue;
    const item = buildReviewItem(
      {
        kind: 'toxicity_reports',
        priority: 'high',
        dedupeKey: `severe_report:${r.id}`,
        subjectUserId: target,
        gameId: r.gameId,
        reportIds: [r.id],
        evidence: { category: r.category, severe: true },
      },
      now,
    );
    result.effects.push({ type: 'EnqueueReview', item: { ...item, dueBy: toIso(now + SEVERE_REPORT_SLA_HOURS * HOUR_MS) } });
  }

  if (qualifying.size < config.toxicityReporters) return result;
  if (toxicity.some((s) => s.kind === 'visibility_restriction' && isInForce(s, now))) {
    result.outcome = 'already_restricted';
    return result;
  }

  if (result.independentReporters < config.toxicityReporters) result.reviewReasons.push('creation_window');
  if (new Set(counted.map((r) => r.gameId)).size === 1) result.reviewReasons.push('single_game');
  const anchored = counted.some((r) => {
    const a = attendance.get(`${r.gameId}|${r.reporterId}`);
    return a?.checkInMethod === 'gps' && a.isHost !== true;
  });
  if (!anchored) result.reviewReasons.push('no_gps_anchor');
  const protectedSince = now - config.postOverturnProtectionDays * DAY_MS;
  const restrictionIds = new Set(toxicity.map((s) => s.id));
  if ((context.overturns ?? []).some((o) => restrictionIds.has(o.sanctionId) && toEpochMs(o.at) > protectedSince)) {
    result.reviewReasons.push('overturn_protection');
  }

  const firstReportId = result.countedReportIds[0] as UserReportId;
  const evidence = {
    reporters: qualifying.size,
    independentReporters: result.independentReporters,
    windowDays: config.toxicityWindowDays,
    excludedReporters: result.excluded.length,
    collusionSuspected: result.reviewReasons.some((r) => r !== 'overturn_protection'),
    reviewReasons: result.reviewReasons.join(','),
  };
  if (result.reviewReasons.length > 0) {
    result.outcome = 'review_only';
    const collusion = evidence.collusionSuspected;
    result.effects.push({
      type: 'EnqueueReview',
      item: buildReviewItem(
        {
          kind: collusion ? 'collusion_suspected' : 'toxicity_reports',
          priority: 'normal',
          dedupeKey: `${collusion ? 'collusion_suspected' : 'protected_reports'}:${target}:${firstReportId}`,
          subjectUserId: target,
          reportIds: result.countedReportIds,
          evidence,
        },
        now,
      ),
    });
    return result;
  }

  const restriction = buildSystemSanction(
    {
      kind: 'visibility_restriction',
      userId: target,
      reasonCode: 'toxicity_reports',
      statementParams: {
        reporters: qualifying.size,
        windowDays: config.toxicityWindowDays,
        hours: config.visibilityRestrictionHours,
      },
      durationMs: config.visibilityRestrictionHours * HOUR_MS,
      dedupeKey: `toxicity_reports:${target}:${firstReportId}`,
    },
    now,
  );
  result.outcome = 'restrict';
  result.effects.push(...issueEffects(restriction), {
    type: 'EnqueueReview',
    item: buildReviewItem(
      {
        kind: 'toxicity_reports',
        priority: 'normal',
        dedupeKey: `toxicity_reports:${target}:${firstReportId}`,
        subjectUserId: target,
        sanctionId: deriveSanctionId(restriction.dedupeKey),
        reportIds: result.countedReportIds,
        evidence,
      },
      now,
    ),
  });
  return result;
}
