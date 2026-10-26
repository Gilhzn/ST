/**
 * Series lifecycle (GAME-010): create/validate, skip a date, edit "this" or
 * "this and following", end. Schedule changes are reschedules: later
 * generated occurrences are cancelled (`rescheduled`) and regenerated under a
 * new `scheduleRevision`, so occurrence keys never collide.
 */
import type {
  EpochMs,
  ErrorCode,
  GameId,
  GameSeries,
  GameSeriesCreateInput,
  LatLng,
  OccurrencePatch,
  Phase15Effect,
  Result,
  RosterMember,
  SeriesEdit,
  SeriesOccurrence,
  SeriesPatch,
  SeriesSchedule,
  SeriesTemplate,
  UserId,
} from '../types';
import { HOUR_MS, MINUTE_MS, toEpochMs, toIso } from '../time';
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from '../config';
import { isLocalDate, isLocalTime, isValidTimeZone, isoWeekdayOf, nextWeekdayOnOrAfter } from '../tz';
import { isSeriesSlot, parseOccurrenceKey, slotTimes } from './schedule';
import { planSeriesOccurrences, retimeOccurrence } from './occurrences';

const SCHEDULE_KEYS = ['recurrence', 'weekday', 'startTime', 'timeZone', 'durationMinutes'] as const satisfies readonly (keyof SeriesSchedule)[];
const TEMPLATE_KEYS = [
  'title',
  'notes',
  'visibility',
  'venueId',
  'location',
  'hideExactLocation',
  'capacity',
  'minPlayers',
  'depositMinor',
  'currency',
  'depositForfeitTo',
  'teamCount',
] as const satisfies readonly (keyof SeriesTemplate)[];

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

type Checkable = Partial<SeriesSchedule> &
  Partial<SeriesTemplate> & { rosterPriorityHours?: number; autoJoinReconfirmHours?: number; horizonWeeks?: number };

/** Field names that fail validation (empty = valid). Only present fields are checked. */
function invalidFields(v: Checkable, config: DomainConfig): string[] {
  const bad: string[] = [];
  const has = (k: keyof Checkable) => v[k] !== undefined;
  if (has('title') && (typeof v.title !== 'string' || v.title.trim().length === 0)) bad.push('title');
  if (has('capacity') && (!isInt(v.capacity) || v.capacity < 2)) bad.push('capacity');
  if (has('minPlayers') && (!isInt(v.minPlayers) || v.minPlayers < 2 || (isInt(v.capacity) && v.minPlayers > v.capacity))) bad.push('minPlayers');
  if (has('teamCount') && (!isInt(v.teamCount) || v.teamCount < 1)) bad.push('teamCount');
  if (has('depositMinor') && (!isInt(v.depositMinor) || v.depositMinor < 0)) bad.push('depositMinor');
  if (has('recurrence') && v.recurrence !== 'weekly' && v.recurrence !== 'biweekly') bad.push('recurrence');
  if (has('weekday') && (!isInt(v.weekday) || v.weekday < 1 || v.weekday > 7)) bad.push('weekday');
  if (has('startTime') && !isLocalTime(v.startTime)) bad.push('startTime');
  if (has('timeZone') && !isValidTimeZone(v.timeZone)) bad.push('timeZone');
  if (
    has('durationMinutes') &&
    (!isInt(v.durationMinutes) || v.durationMinutes < config.seriesMinDurationMinutes || v.durationMinutes > config.seriesMaxDurationMinutes)
  ) {
    bad.push('durationMinutes');
  }
  if (
    has('rosterPriorityHours') &&
    (typeof v.rosterPriorityHours !== 'number' ||
      !(v.rosterPriorityHours >= config.rosterPriorityHoursMin && v.rosterPriorityHours <= config.rosterPriorityHoursMax))
  ) {
    bad.push('rosterPriorityHours');
  }
  if (
    has('autoJoinReconfirmHours') &&
    (typeof v.autoJoinReconfirmHours !== 'number' ||
      !(v.autoJoinReconfirmHours > config.autoJoinReleaseHours && v.autoJoinReconfirmHours <= (v.horizonWeeks ?? config.seriesHorizonWeeks) * 7 * 24))
  ) {
    bad.push('autoJoinReconfirmHours');
  }
  return bad;
}

/** Validates a create input; returns the invalid field names (empty = valid). */
export function validateSeriesCreate(input: GameSeriesCreateInput, config: DomainConfig = DEFAULT_DOMAIN_CONFIG): string[] {
  const bad = invalidFields({ ...input, minPlayers: input.minPlayers ?? 2 }, config);
  if (input.venueId === null && !input.location) bad.push('location');
  if (!isLocalDate(input.startDate)) bad.push('startDate');
  if (input.endDate != null && (!isLocalDate(input.endDate) || (isLocalDate(input.startDate) && input.endDate < input.startDate))) bad.push('endDate');
  return bad;
}

export interface SeriesMeta {
  id: string;
  hostId: UserId;
  approxLocation: LatLng;
  /** Resolved venue location when `venueId` is set. */
  location?: LatLng | null;
  inviteToken: string | null;
}

/** Builds a series row from a validated input. Throws `RangeError` when invalid. */
export function buildSeries(input: GameSeriesCreateInput, meta: SeriesMeta, config: DomainConfig = DEFAULT_DOMAIN_CONFIG, now: EpochMs): GameSeries {
  const bad = validateSeriesCreate(input, config);
  if (bad.length > 0) throw new RangeError(`Invalid series fields: ${bad.join(', ')}`);
  const at = toIso(now);
  return {
    id: meta.id,
    hostId: meta.hostId,
    sport: input.sport,
    title: input.title.trim(),
    notes: input.notes ?? null,
    visibility: input.visibility,
    venueId: input.venueId,
    location: meta.location ?? input.location ?? null,
    approxLocation: meta.approxLocation,
    hideExactLocation: input.hideExactLocation,
    capacity: input.capacity,
    minPlayers: input.minPlayers ?? 2,
    depositMinor: input.depositMinor,
    currency: input.currency,
    depositForfeitTo: input.depositForfeitTo ?? 'host',
    womenOnly: input.womenOnly,
    teamCount: input.teamCount,
    recurrence: input.recurrence,
    weekday: input.weekday,
    startTime: input.startTime,
    timeZone: input.timeZone,
    durationMinutes: input.durationMinutes,
    anchorDate: nextWeekdayOnOrAfter(input.startDate, input.weekday),
    endDate: input.endDate ?? null,
    horizonWeeks: config.seriesHorizonWeeks,
    rosterPriorityHours: input.rosterPriorityHours ?? config.rosterPriorityHoursDefault,
    autoJoinReconfirmHours: input.autoJoinReconfirmHours ?? config.autoJoinReconfirmHours,
    skippedDates: [],
    scheduleRevision: 0,
    status: 'active',
    inviteToken: meta.inviteToken,
    createdAt: at,
    updatedAt: at,
  };
}

/** Input shared by skip / edit / end. */
export interface SeriesChangeInput {
  series: GameSeries;
  /** Generated occurrences (any status). */
  occurrences: readonly SeriesOccurrence[];
  roster: readonly RosterMember[];
  /** Approved or waitlisted participants other than the host, per game. */
  participants?: Readonly<Record<GameId, readonly UserId[]>>;
  ineligibleUserIds?: readonly UserId[];
}

export interface SeriesChangeResult {
  series: GameSeries;
  /** Occurrences created or changed by this operation (new state). */
  occurrences: SeriesOccurrence[];
  effects: Phase15Effect[];
}

function participantsOf(input: SeriesChangeInput, gameId: GameId): readonly UserId[] {
  return input.participants?.[gameId] ?? [];
}

function notifyAll(
  input: SeriesChangeInput,
  occ: SeriesOccurrence,
  kind: 'occurrence_skipped' | 'occurrence_updated' | 'occurrence_rescheduled',
  extra: Record<string, string>,
  tag: string,
): Phase15Effect[] {
  return participantsOf(input, occ.gameId).map((userId) => ({
    type: 'Notify15' as const,
    userId,
    kind,
    params: { seriesTitle: input.series.title, startsAt: occ.startsAt, ...extra },
    gameId: occ.gameId,
    seriesId: input.series.id,
    dedupeKey: `notify:${kind}:${occ.gameId}:${userId}:${tag}`,
  }));
}

function cancelEffects(
  input: SeriesChangeInput,
  occ: SeriesOccurrence,
  reason: 'skipped' | 'rescheduled' | 'series_ended',
  config: DomainConfig,
  now: EpochMs,
): { occurrence: SeriesOccurrence; effects: Phase15Effect[] } {
  const lateCancel = participantsOf(input, occ.gameId).length > 0 && toEpochMs(occ.startsAt) - now < config.lateCancelWindowHours * HOUR_MS;
  const next: SeriesOccurrence = { ...occ, status: reason === 'skipped' ? 'skipped' : 'cancelled' };
  const kind = reason === 'rescheduled' ? 'occurrence_rescheduled' : 'occurrence_skipped';
  return {
    occurrence: next,
    effects: [
      { type: 'CancelOccurrence', occurrenceKey: occ.occurrenceKey, gameId: occ.gameId, reason, lateCancel, dedupeKey: `cancel-occurrence:${occ.occurrenceKey}` },
      ...notifyAll(input, occ, kind, { reason }, reason),
    ],
  };
}

function seriesUpdate(series: GameSeries, patch: Partial<GameSeries>, tag: string, now: EpochMs): { series: GameSeries; effect: Phase15Effect } {
  const full = { ...patch, updatedAt: toIso(now) };
  return {
    series: { ...series, ...full },
    effect: { type: 'UpdateSeries', seriesId: series.id, patch: full, dedupeKey: `series:${series.id}:${tag}:${toIso(now)}` },
  };
}

/**
 * Skips one date. A generated occurrence is cancelled (`CancelOccurrence`
 * reason `skipped`; `lateCancel` when it has participants and starts within
 * `lateCancelWindowHours`, which the adapter routes to the host late-cancel
 * rule). A future slot not yet generated is only recorded in `skippedDates`.
 * Rejects `not_found` (unknown key or not a slot), `conflict` (already skipped
 * or cancelled), `outside_window` (started).
 */
export function skipOccurrence(
  input: SeriesChangeInput,
  key: string,
  config: DomainConfig = DEFAULT_DOMAIN_CONFIG,
  now: EpochMs,
): Result<SeriesChangeResult, ErrorCode> {
  const { series } = input;
  const generated = input.occurrences.find((o) => o.occurrenceKey === key);
  const parsed = parseOccurrenceKey(key);
  if (!generated) {
    if (!parsed || parsed.seriesId !== series.id || parsed.scheduleRevision !== series.scheduleRevision || !isSeriesSlot(series, parsed.slotDate)) {
      return { ok: false, error: 'not_found' };
    }
    if (series.skippedDates.includes(parsed.slotDate)) return { ok: false, error: 'conflict' };
    if (slotTimes(series, parsed.slotDate).startsAt <= now) return { ok: false, error: 'outside_window' };
    const u = seriesUpdate(series, { skippedDates: [...series.skippedDates, parsed.slotDate].sort() }, `skip-${parsed.slotDate}`, now);
    return { ok: true, value: { series: u.series, occurrences: [], effects: [u.effect] } };
  }
  if (generated.status !== 'scheduled') return { ok: false, error: 'conflict' };
  if (toEpochMs(generated.startsAt) <= now) return { ok: false, error: 'outside_window' };
  const c = cancelEffects(input, generated, 'skipped', config, now);
  const skipped = series.skippedDates.includes(generated.slotDate) ? series.skippedDates : [...series.skippedDates, generated.slotDate].sort();
  const u = seriesUpdate(series, { skippedDates: skipped }, `skip-${generated.slotDate}`, now);
  return { ok: true, value: { series: u.series, occurrences: [c.occurrence], effects: [...c.effects, u.effect] } };
}

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function editThis(input: SeriesChangeInput, occ: SeriesOccurrence, patch: OccurrencePatch, config: DomainConfig, now: EpochMs): Result<SeriesChangeResult, ErrorCode> {
  const { series } = input;
  const merged = { capacity: patch.capacity ?? series.capacity, ...patch };
  if (invalidFields(merged, config).length > 0) return { ok: false, error: 'validation' };
  const oldStart = toEpochMs(occ.startsAt);
  const oldDuration = (toEpochMs(occ.endsAt) - oldStart) / MINUTE_MS;
  let newStart = oldStart;
  if (patch.startsAt !== undefined) {
    const parsed = Date.parse(patch.startsAt);
    if (Number.isNaN(parsed)) return { ok: false, error: 'validation' };
    newStart = parsed;
  }
  const newEnd = newStart + (patch.durationMinutes ?? oldDuration) * MINUTE_MS;
  const moved = newStart !== oldStart;
  if (moved) {
    const window = config.lateCancelWindowHours * HOUR_MS;
    if (newStart <= now) return { ok: false, error: 'validation' };
    if (participantsOf(input, occ.gameId).length > 0 && (oldStart - now < window || newStart - now < window)) return { ok: false, error: 'outside_window' };
  }
  const next = { ...retimeOccurrence(occ, series, newStart, newEnd, config), overridden: true };
  const gamePatch: Partial<SeriesTemplate> & { startsAt?: string; endsAt?: string } = pick(patch, ['title', 'notes', 'capacity', 'minPlayers', 'venueId', 'location', 'hideExactLocation']);
  if (moved || patch.durationMinutes !== undefined) {
    gamePatch.startsAt = next.startsAt;
    gamePatch.endsAt = next.endsAt;
  }
  const effects: Phase15Effect[] = [
    { type: 'UpdateOccurrence', occurrenceKey: occ.occurrenceKey, gameId: occ.gameId, patch: gamePatch, occurrence: next, dedupeKey: `edit-occurrence:${occ.occurrenceKey}:${toIso(now)}` },
    ...notifyAll(input, next, 'occurrence_updated', {}, toIso(now)),
  ];
  return { ok: true, value: { series, occurrences: [next], effects } };
}

function editFollowing(input: SeriesChangeInput, pivot: SeriesOccurrence, patch: SeriesPatch, config: DomainConfig, now: EpochMs): Result<SeriesChangeResult, ErrorCode> {
  const { series } = input;
  const merged: Checkable = { ...series, ...patch };
  if (invalidFields(merged, config).length > 0) return { ok: false, error: 'validation' };
  if (patch.endDate != null && (!isLocalDate(patch.endDate) || patch.endDate < pivot.slotDate)) return { ok: false, error: 'validation' };
  const reschedule = SCHEDULE_KEYS.some((k) => patch[k] !== undefined && patch[k] !== series[k]);
  if (reschedule && participantsOf(input, pivot.gameId).length > 0 && toEpochMs(pivot.startsAt) - now < config.lateCancelWindowHours * HOUR_MS) {
    return { ok: false, error: 'outside_window' };
  }
  const seriesPatch: Partial<GameSeries> = {
    ...pick(patch, TEMPLATE_KEYS),
    ...pick(patch, SCHEDULE_KEYS),
    ...pick(patch, ['rosterPriorityHours', 'autoJoinReconfirmHours']),
  };
  if (patch.endDate !== undefined) seriesPatch.endDate = patch.endDate;
  if (reschedule) {
    const weekday = patch.weekday ?? series.weekday;
    seriesPatch.scheduleRevision = series.scheduleRevision + 1;
    seriesPatch.anchorDate = isoWeekdayOf(pivot.slotDate) === weekday ? pivot.slotDate : nextWeekdayOnOrAfter(pivot.slotDate, weekday);
  }
  const u = seriesUpdate(series, seriesPatch, `edit-${pivot.occurrenceKey}`, now);
  const next = u.series;
  const effects: Phase15Effect[] = [];
  const changed: SeriesOccurrence[] = [];
  const affected = input.occurrences
    .filter((o) => o.status === 'scheduled' && o.slotDate >= pivot.slotDate && toEpochMs(o.startsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const templatePatch = pick(patch, TEMPLATE_KEYS);
  for (const occ of affected) {
    if (reschedule || (next.endDate !== null && occ.slotDate > next.endDate)) {
      const c = cancelEffects(input, occ, reschedule ? 'rescheduled' : 'series_ended', config, now);
      changed.push(c.occurrence);
      effects.push(...c.effects);
      continue;
    }
    const retimed = retimeOccurrence(occ, next, toEpochMs(occ.startsAt), toEpochMs(occ.endsAt), config);
    effects.push({
      type: 'UpdateOccurrence',
      occurrenceKey: occ.occurrenceKey,
      gameId: occ.gameId,
      patch: templatePatch,
      occurrence: retimed,
      dedupeKey: `edit-occurrence:${occ.occurrenceKey}:${toIso(now)}`,
    });
    if (Object.keys(templatePatch).length > 0) effects.push(...notifyAll(input, occ, 'occurrence_updated', {}, toIso(now)));
    changed.push(retimed);
  }
  effects.push(u.effect);
  if (reschedule) {
    const cancelledKeys = new Set(changed.map((o) => o.occurrenceKey));
    const existing = input.occurrences.map((o) => (cancelledKeys.has(o.occurrenceKey) ? { ...o, status: 'cancelled' as const } : o));
    const plan = planSeriesOccurrences({ series: next, existing, roster: input.roster, ineligibleUserIds: input.ineligibleUserIds }, config, now);
    changed.push(...plan.occurrences);
    effects.push(...plan.effects);
  }
  return { ok: true, value: { series: next, occurrences: changed, effects } };
}

/**
 * Host edit. `this`: one occurrence (marked `overridden`); moving it is refused
 * with `outside_window` when it has participants and the old or new start is
 * inside `lateCancelWindowHours`. `following`: the template from the pivot on;
 * a schedule change reschedules (refused inside the late window when the pivot
 * has participants). Rejects `not_found` (unknown pivot), `conflict` (pivot not
 * scheduled or series ended), `outside_window` (pivot started), `validation`.
 */
export function editSeries(
  input: SeriesChangeInput,
  edit: SeriesEdit,
  config: DomainConfig = DEFAULT_DOMAIN_CONFIG,
  now: EpochMs,
): Result<SeriesChangeResult, ErrorCode> {
  if (input.series.status === 'ended') return { ok: false, error: 'conflict' };
  const pivot = input.occurrences.find((o) => o.occurrenceKey === edit.occurrenceKey);
  if (!pivot) return { ok: false, error: 'not_found' };
  if (pivot.status !== 'scheduled') return { ok: false, error: 'conflict' };
  if (toEpochMs(pivot.startsAt) <= now) return { ok: false, error: 'outside_window' };
  return edit.scope === 'this' ? editThis(input, pivot, edit.patch, config, now) : editFollowing(input, pivot, edit.patch, config, now);
}

/** Ends the series: status `ended`, every future scheduled occurrence cancelled (`series_ended`). */
export function endSeries(input: SeriesChangeInput, config: DomainConfig = DEFAULT_DOMAIN_CONFIG, now: EpochMs): Result<SeriesChangeResult, ErrorCode> {
  if (input.series.status === 'ended') return { ok: false, error: 'conflict' };
  const effects: Phase15Effect[] = [];
  const changed: SeriesOccurrence[] = [];
  for (const occ of input.occurrences.filter((o) => o.status === 'scheduled' && toEpochMs(o.startsAt) > now)) {
    const c = cancelEffects(input, occ, 'series_ended', config, now);
    changed.push(c.occurrence);
    effects.push(...c.effects);
  }
  const u = seriesUpdate(input.series, { status: 'ended' }, 'end', now);
  effects.push(u.effect);
  return { ok: true, value: { series: u.series, occurrences: changed, effects } };
}
