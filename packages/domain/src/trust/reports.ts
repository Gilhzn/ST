/**
 * Toxicity reports → temporary visibility restriction (never a silent shadowban).
 *
 * A report counts when it is about the target, inside `toxicityWindowDays`,
 * filed after the target's latest `toxicity_reports` sanction started (reports
 * are consumed by a restriction), and its reporter **qualifies**:
 * - not the target, has a profile;
 * - account at least `minReporterAccountAgeDays` old **when the report was filed**;
 * - reliability status not `red`;
 * - not spamming: at most {@link REPORT_SPAM_MAX_PER_7D} reports filed in the 7 days before `now`.
 *
 * With ≥ `toxicityReporters` distinct qualifying reporters:
 * - all of them created within `collusionCreationWindowHours` of each other → collusion:
 *   `EnqueueReview(collusion_suspected)` only, no restriction;
 * - otherwise → `visibility_restriction` for `visibilityRestrictionHours` +
 *   `RestrictVisibility` + `Notify(visibility_restricted)` with the statement key +
 *   `EnqueueReview(toxicity_reports)`.
 * Nothing new is issued while a toxicity restriction is in force.
 */
import {
  DEFAULT_TRUST_CONFIG,
  type Effect,
  type EpochMs,
  type IsoDateTime,
  type ReliabilityStatus,
  type Sanction,
  type TrustConfig,
  type UserId,
  type UserReport,
  type UserReportId,
} from '../types';
import { deriveSanctionId } from '../crypto/uuid';
import { DAY_MS, HOUR_MS, toEpochMs } from '../time';
import { buildReviewItem, buildSystemSanction, isInForce, issueEffects } from './sanctions';

/** Reporters filing more than this many reports in 7 days are treated as spamming. */
export const REPORT_SPAM_MAX_PER_7D = 10;

/** What the engine needs to know about a reporter. */
export interface ReporterProfile {
  id: UserId;
  /** `profiles.created_at`. */
  createdAt: IsoDateTime;
  reliabilityStatus: ReliabilityStatus;
  /** Reports this user filed (about anyone) in the 7 days before `now`. */
  reportsLast7d: number;
}

export type ReporterExclusion = 'self' | 'unknown_profile' | 'account_too_new' | 'red_status' | 'spamming';

export interface ReportEvaluation {
  /** `restrict` = visibility restriction issued; `review_only` = collusion suspected; `none` otherwise. */
  outcome: 'none' | 'review_only' | 'restrict' | 'already_restricted';
  targetUserId: UserId | null;
  /** Distinct qualifying reporters, sorted. */
  qualifyingReporterIds: UserId[];
  /** Reports that individually qualified, sorted by time then id. */
  countedReportIds: UserReportId[];
  excluded: { reporterId: UserId; reason: ReporterExclusion }[];
  effects: Effect[];
}

function byTimeThenId(a: UserReport, b: UserReport): number {
  return toEpochMs(a.createdAt) - toEpochMs(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * @param reports reports about one target (the target of the latest report is used; others are ignored).
 * @param sanctions the target's sanctions (for consumption and the in-force check).
 */
export function evaluateReports(
  reports: readonly UserReport[],
  reporterProfiles: readonly ReporterProfile[],
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
  sanctions: readonly Sanction[] = [],
): ReportEvaluation {
  const sorted = reports.slice().sort(byTimeThenId);
  const target = sorted.length > 0 ? (sorted[sorted.length - 1] as UserReport).targetUserId : null;
  const result: ReportEvaluation = {
    outcome: 'none',
    targetUserId: target,
    qualifyingReporterIds: [],
    countedReportIds: [],
    excluded: [],
    effects: [],
  };
  if (target === null) return result;

  const toxicity = sanctions.filter((s) => s.userId === target && s.reasonCode === 'toxicity_reports');
  const consumedUntil = Math.max(-Infinity, ...toxicity.map((s) => toEpochMs(s.startsAt)));
  const windowStart = now - config.toxicityWindowDays * DAY_MS;
  const relevant = sorted.filter((r) => {
    const t = toEpochMs(r.createdAt);
    return r.targetUserId === target && t > windowStart && t <= now && t > consumedUntil;
  });

  const profiles = new Map(reporterProfiles.map((p) => [p.id, p] as const));
  const minAge = config.minReporterAccountAgeDays * DAY_MS;
  const qualifying = new Map<UserId, ReporterProfile>();
  const exclusion = new Map<UserId, ReporterExclusion>();
  const counted: UserReportId[] = [];
  for (const r of relevant) {
    const id = r.reporterId;
    const p = profiles.get(id);
    let reason: ReporterExclusion | null = null;
    if (id === target) reason = 'self';
    else if (!p) reason = 'unknown_profile';
    else if (p.reliabilityStatus === 'red') reason = 'red_status';
    else if (p.reportsLast7d > REPORT_SPAM_MAX_PER_7D) reason = 'spamming';
    else if (toEpochMs(r.createdAt) - toEpochMs(p.createdAt) < minAge) reason = 'account_too_new';
    if (reason === null && p) {
      qualifying.set(id, p);
      exclusion.delete(id);
      counted.push(r.id);
    } else if (reason !== null && !qualifying.has(id) && !exclusion.has(id)) {
      exclusion.set(id, reason);
    }
  }
  result.qualifyingReporterIds = [...qualifying.keys()].sort();
  result.countedReportIds = counted;
  result.excluded = [...exclusion.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([reporterId, reason]) => ({ reporterId, reason }));

  if (qualifying.size < config.toxicityReporters) return result;
  if (toxicity.some((s) => s.kind === 'visibility_restriction' && isInForce(s, now))) {
    result.outcome = 'already_restricted';
    return result;
  }

  const firstReportId = result.countedReportIds[0] as UserReportId;
  const created = [...qualifying.values()].map((p) => toEpochMs(p.createdAt));
  const colluding = Math.max(...created) - Math.min(...created) <= config.collusionCreationWindowHours * HOUR_MS;
  const evidence = {
    reporters: qualifying.size,
    windowDays: config.toxicityWindowDays,
    excludedReporters: result.excluded.length,
    creationSpreadHours: Math.round(((Math.max(...created) - Math.min(...created)) / HOUR_MS) * 100) / 100,
  };
  if (colluding) {
    result.outcome = 'review_only';
    result.effects.push({
      type: 'EnqueueReview',
      item: buildReviewItem(
        {
          kind: 'collusion_suspected',
          priority: 'normal',
          dedupeKey: `collusion_suspected:${target}:${firstReportId}`,
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
