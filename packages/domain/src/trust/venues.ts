/**
 * Venue reports (Waze-style): `venueReportsToHide` distinct *qualified*
 * reporters (the creator's own reports excluded) filed after the venue was last
 * reviewed →
 * `SetVenueStatus(hidden_pending_review)` + `EnqueueReview(venue_reports)` +
 * `Notify(venue_hidden)` to the creator. Only `active` venues are hidden.
 * A reporter qualifies as for user reports: known profile, reliability not `red`,
 * account at least `minReporterAccountAgeDays` old when the report was filed
 * (fresh sock-puppet accounts cannot hide a competitor's venue).
 * Mirrored by SQL `report_venue` (golden kind `trust.venueReports`).
 */
import {
  DEFAULT_TRUST_CONFIG,
  type Effect,
  type EpochMs,
  type IsoDateTime,
  type TrustConfig,
  type UserId,
  type VenueId,
  type VenueReport,
  type VenueStatus,
} from '../types';
import { DAY_MS, toEpochMs } from '../time';
import type { ReporterProfile } from './reports';
import { buildReviewItem } from './sanctions';

/** What the engine needs to know about a venue. */
export interface VenueTrustRecord {
  venueId: VenueId;
  status: VenueStatus;
  createdBy: UserId | null;
  /** When a moderator last resolved a review of this venue (restored it); reports up to then are consumed. */
  lastReviewedAt: IsoDateTime | null;
  reports: readonly VenueReport[];
}

export interface VenueReportEvaluation {
  hide: boolean;
  /** Distinct counted reporters, sorted. */
  reporterIds: UserId[];
  effects: Effect[];
}

/** The reporter fields venue-report qualification reads. */
export type VenueReporterProfile = Pick<ReporterProfile, 'id' | 'createdAt' | 'reliabilityStatus'>;

/** True when `report` counts: known, non-red reporter whose account was old enough when filing. */
export function isQualifiedVenueReporter(
  report: Pick<VenueReport, 'reporterId' | 'createdAt'>,
  profile: VenueReporterProfile | undefined,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): boolean {
  return (
    profile !== undefined &&
    profile.reliabilityStatus !== 'red' &&
    toEpochMs(report.createdAt) - toEpochMs(profile.createdAt) >= config.minReporterAccountAgeDays * DAY_MS
  );
}

export function evaluateVenueReports(
  venue: VenueTrustRecord,
  reporterProfiles: readonly VenueReporterProfile[],
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): VenueReportEvaluation {
  const profiles = new Map(reporterProfiles.map((p) => [p.id, p] as const));
  const since = venue.lastReviewedAt ? toEpochMs(venue.lastReviewedAt) : -Infinity;
  const counted = venue.reports
    .filter(
      (r) =>
        r.venueId === venue.venueId &&
        r.reporterId !== venue.createdBy &&
        toEpochMs(r.createdAt) > since &&
        toEpochMs(r.createdAt) <= now &&
        isQualifiedVenueReporter(r, profiles.get(r.reporterId), config),
    )
    .sort((a, b) => toEpochMs(a.createdAt) - toEpochMs(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const firstByReporter = new Map<UserId, VenueReport>();
  for (const r of counted) if (!firstByReporter.has(r.reporterId)) firstByReporter.set(r.reporterId, r);
  const reporterIds = [...firstByReporter.keys()].sort();
  const result: VenueReportEvaluation = { hide: false, reporterIds, effects: [] };
  if (venue.status !== 'active' || reporterIds.length < config.venueReportsToHide) return result;

  const reports = [...firstByReporter.values()];
  const reasons: Record<string, number> = {};
  for (const r of reports) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  const first = reports[0] as VenueReport;
  result.hide = true;
  result.effects.push(
    { type: 'SetVenueStatus', venueId: venue.venueId, status: 'hidden_pending_review' },
    {
      type: 'EnqueueReview',
      item: buildReviewItem(
        {
          kind: 'venue_reports',
          priority: 'normal',
          dedupeKey: `venue_reports:${venue.venueId}:${first.id}`,
          subjectUserId: venue.createdBy,
          venueId: venue.venueId,
          evidence: { reporters: reporterIds.length, ...reasons },
        },
        now,
      ),
    },
  );
  if (venue.createdBy) {
    result.effects.push({
      type: 'Notify',
      userId: venue.createdBy,
      kind: 'venue_hidden',
      params: { venueId: venue.venueId, reporters: reporterIds.length },
      gameId: null,
      sanctionDedupeKey: null,
    });
  }
  return result;
}

/**
 * A moderator's removal counts as a *confirmed fake* venue (for host
 * reliability) when more than half of the counted reporters chose `no_venue_here`.
 */
export function isConfirmedFake(venue: VenueTrustRecord): boolean {
  const byReporter = new Map<UserId, VenueReport>();
  for (const r of venue.reports) if (r.reporterId !== venue.createdBy) byReporter.set(r.reporterId, r);
  const all = [...byReporter.values()];
  const fake = all.filter((r) => r.reason === 'no_venue_here').length;
  return all.length > 0 && fake * 2 > all.length;
}
