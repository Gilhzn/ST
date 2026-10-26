/**
 * trust-evaluate: runs the domain trust engine for events that arrive from the
 * database (database webhooks on inserts, or pg_cron batches) and applies the
 * resulting effects through `apply_effects` (service role, one transaction per
 * subject). Internal callers only.
 *
 * Accepted bodies:
 * - `{ events: TrustEvent[], dryRun? }` (≤ 50 events), or
 * - a Supabase database-webhook payload `{ type: 'INSERT', table, record }` for
 *   `user_reports` (→ UserReported), `venue_reports` (→ VenueReported) and
 *   `appeals` (→ AppealFiled).
 *
 * Every effect is idempotent (dedupe keys, `greatest()` projections), so
 * re-delivery and overlap with the SQL-authoritative rules are harmless.
 * Returns per-type effect counts; `dryRun` computes without applying.
 */
import {
  StError,
  applyTrustEvent,
  isStError,
  type DomainTrustEvent,
  type Effect,
  type TrustConfig,
  type TrustState,
  type UserId,
} from '@st/domain';
import { requireInternalCaller } from '#shared/auth';
import type { ConfigSource } from '#shared/config';
import { json, readJson, route } from '#shared/http';
import type { Logger } from '#shared/log';
import { iso, rowToAppeal, rowToUserReport } from '#shared/rows';
import type { Clock } from '#shared/runtime';
import { arrayField, objectValue } from '#shared/validate';

export interface TrustStore {
  /** Snapshot of everything the engine needs about `userId` for `event`. */
  loadTrustState(userId: UserId, event: DomainTrustEvent, now: number, config: TrustConfig): Promise<TrustState>;
  applyEffects(effects: readonly Effect[]): Promise<void>;
  /** Creator of a venue (subject of venue-report rules). */
  venueCreator(venueId: string): Promise<UserId | null>;
}

export interface TrustEvaluateDeps {
  internalSecrets: readonly string[];
  store: TrustStore;
  config: ConfigSource;
  clock: Clock;
  log: Logger;
}

export const MAX_EVENTS = 50;

const EVENT_TYPES = new Set([
  'ParticipationCancelled', 'LateCancelFinalized', 'AttendanceFinalized', 'ChatMessageBlocked', 'UserReported',
  'VenueReported', 'HostRated', 'AppealFiled', 'ModeratorDecided', 'Tick',
]);

/** Converts a database-webhook insert into a trust event. Exported for tests. */
export function eventFromWebhook(payload: Record<string, unknown>): DomainTrustEvent | null {
  if (payload['type'] !== 'INSERT') return null;
  const record = objectValue(payload['record'], 'record');
  switch (payload['table']) {
    case 'user_reports':
      return { type: 'UserReported', report: rowToUserReport(record) };
    case 'venue_reports':
      return {
        type: 'VenueReported',
        report: {
          id: String(record['id']),
          venueId: String(record['venue_id']),
          reporterId: String(record['reporter_id']),
          reason: String(record['reason']) as 'other',
          note: null,
          createdAt: iso(record['created_at']),
        },
      };
    case 'appeals':
      return { type: 'AppealFiled', appeal: rowToAppeal(record) };
    default:
      return null;
  }
}

/** The user whose trust state an event concerns (`null` for venue events, resolved separately). */
export function subjectOf(event: DomainTrustEvent): UserId | null {
  switch (event.type) {
    case 'ParticipationCancelled':
    case 'LateCancelFinalized':
    case 'AttendanceFinalized':
    case 'ChatMessageBlocked':
      return event.userId;
    case 'UserReported':
      return event.report.targetUserId;
    case 'HostRated':
      return event.hostId;
    case 'AppealFiled':
      return event.appeal.userId;
    case 'VenueReported':
    case 'ModeratorDecided':
    case 'Tick':
      return null;
  }
}

function parseEvents(input: Record<string, unknown>): DomainTrustEvent[] {
  if (input['events'] === undefined) {
    const e = eventFromWebhook(input);
    return e ? [e] : [];
  }
  return arrayField(input, 'events', MAX_EVENTS).map((raw, i) => {
    const e = objectValue(raw, `events[${i}]`);
    if (typeof e['type'] !== 'string' || !EVENT_TYPES.has(e['type'])) {
      throw new StError('validation', 'unknown event type', { field: `events[${i}].type` });
    }
    return e as unknown as DomainTrustEvent;
  });
}

export async function handle(req: Request, deps: TrustEvaluateDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'] }, async () => {
    requireInternalCaller(req, deps.internalSecrets);
    const input = await readJson(req, 512 * 1024);
    const dryRun = input['dryRun'] === true;
    const events = parseEvents(input);
    const config = await deps.config.get();
    const now = deps.clock.now();

    const effectCounts: Record<string, number> = {};
    const errors: { index: number; code: string }[] = [];
    let processed = 0;
    for (const [index, event] of events.entries()) {
      try {
        let subject = subjectOf(event);
        if (!subject && event.type === 'VenueReported') subject = await deps.store.venueCreator(event.report.venueId);
        if (!subject) {
          errors.push({ index, code: 'unsupported_subject' });
          continue;
        }
        const state = await deps.store.loadTrustState(subject, event, now, config);
        const { effects } = applyTrustEvent(state, event, config, now);
        for (const e of effects) effectCounts[e.type] = (effectCounts[e.type] ?? 0) + 1;
        if (!dryRun && effects.length > 0) await deps.store.applyEffects(effects);
        processed++;
      } catch (err) {
        if (!isStError(err) || err.code === 'unavailable') throw err; // let the caller retry the batch
        errors.push({ index, code: err.code });
      }
    }
    deps.log.info('trust.evaluated', { processed, errors: errors.length, effectCounts, dryRun });
    return json({ processed, effects: effectCounts, errors, dryRun });
  });
}
