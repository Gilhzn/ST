/**
 * Rolling occurrence generation (GAME-010): every slot whose start falls in
 * `(now, now + horizonWeeks]` gets an occurrence (a game) unless skipped,
 * already generated, or the series is not active. "Always in" regulars are
 * auto-joined in seniority order: approved while seats remain (the host holds
 * one), then waitlisted. Auto-join happens only while there is still time to
 * reconfirm (`now < reconfirmAt`).
 */
import type {
  EpochMs,
  GameSeries,
  LocalDate,
  OccurrenceGameSnapshot,
  Phase15Effect,
  RosterMember,
  SeriesOccurrence,
  UserId,
} from '../types';
import { DAY_MS, HOUR_MS, toEpochMs, toIso } from '../time';
import type { DomainConfig } from '../config';
import { DEFAULT_DOMAIN_CONFIG } from '../config';
import { deriveOccurrenceGameId, occurrenceKey, slotDatesInRange, slotTimes } from './schedule';

export interface SeriesPlanInput {
  series: GameSeries;
  /** Occurrences already stored for the series (any status). */
  existing: readonly Pick<SeriesOccurrence, 'slotDate' | 'scheduleRevision' | 'status'>[];
  roster: readonly RosterMember[];
  /** Regulars who may not be auto-joined now (join ban, block with the host, women-only mismatch…). */
  ineligibleUserIds?: readonly UserId[];
}

export interface SeriesPlan {
  occurrences: SeriesOccurrence[];
  effects: Phase15Effect[];
}

/** Builds the occurrence row for `slotDate` as generated at `now`. */
export function buildOccurrence(
  series: GameSeries,
  slotDate: LocalDate,
  config: Pick<DomainConfig, 'autoJoinReleaseHours'>,
  now: EpochMs,
): SeriesOccurrence {
  const { startsAt, endsAt } = slotTimes(series, slotDate);
  const key = occurrenceKey(series.id, series.scheduleRevision, slotDate);
  // Generation happens once the slot enters the horizon, so the occurrence opens when generated.
  const opensAt = Math.min(startsAt, now);
  return {
    seriesId: series.id,
    occurrenceKey: key,
    slotDate,
    scheduleRevision: series.scheduleRevision,
    gameId: deriveOccurrenceGameId(key),
    startsAt: toIso(startsAt),
    endsAt: toIso(endsAt),
    opensAt: toIso(opensAt),
    priorityUntil: toIso(Math.min(opensAt + series.rosterPriorityHours * HOUR_MS, startsAt)),
    reconfirmAt: toIso(startsAt - series.autoJoinReconfirmHours * HOUR_MS),
    releaseAt: toIso(startsAt - config.autoJoinReleaseHours * HOUR_MS),
    status: 'scheduled',
    overridden: false,
  };
}

/** Recomputes the derived times of an occurrence whose start or series windows changed. */
export function retimeOccurrence(
  occ: SeriesOccurrence,
  series: Pick<GameSeries, 'rosterPriorityHours' | 'autoJoinReconfirmHours'>,
  startsAt: EpochMs,
  endsAt: EpochMs,
  config: Pick<DomainConfig, 'autoJoinReleaseHours'>,
): SeriesOccurrence {
  const opensAt = Math.min(toEpochMs(occ.opensAt), startsAt);
  return {
    ...occ,
    startsAt: toIso(startsAt),
    endsAt: toIso(endsAt),
    opensAt: toIso(opensAt),
    priorityUntil: toIso(Math.min(opensAt + series.rosterPriorityHours * HOUR_MS, startsAt)),
    reconfirmAt: toIso(startsAt - series.autoJoinReconfirmHours * HOUR_MS),
    releaseAt: toIso(startsAt - config.autoJoinReleaseHours * HOUR_MS),
  };
}

/** The games-table snapshot of an occurrence. */
export function occurrenceGame(series: GameSeries, occ: SeriesOccurrence): OccurrenceGameSnapshot {
  return {
    id: occ.gameId,
    seriesId: series.id,
    hostId: series.hostId,
    sport: series.sport,
    title: series.title,
    notes: series.notes,
    visibility: series.visibility,
    venueId: series.venueId,
    location: series.location,
    approxLocation: series.approxLocation,
    hideExactLocation: series.hideExactLocation,
    capacity: series.capacity,
    minPlayers: series.minPlayers,
    depositMinor: series.depositMinor,
    currency: series.currency,
    depositForfeitTo: series.depositForfeitTo,
    womenOnly: series.womenOnly,
    teamCount: series.teamCount,
    startsAt: occ.startsAt,
    endsAt: occ.endsAt,
  };
}

/** Regulars with "always in", in seniority order (joinedAt, then userId). */
export function alwaysInMembers(series: Pick<GameSeries, 'hostId'>, roster: readonly RosterMember[], ineligible: readonly UserId[] = []): RosterMember[] {
  const skip = new Set(ineligible);
  return roster
    .filter((m) => m.status === 'regular' && m.alwaysIn && m.userId !== series.hostId && !skip.has(m.userId))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/**
 * Plans the occurrences to create now. Effects per new occurrence, in order:
 * `CreateOccurrence` (insert the game with the host approved, as `create_game`
 * does), then one `AutoJoin` per "always in" regular.
 */
export function planSeriesOccurrences(input: SeriesPlanInput, config: DomainConfig = DEFAULT_DOMAIN_CONFIG, now: EpochMs): SeriesPlan {
  const { series } = input;
  const out: SeriesPlan = { occurrences: [], effects: [] };
  if (series.status !== 'active') return out;
  const taken = new Set(
    input.existing
      .filter((o) => o.scheduleRevision === series.scheduleRevision || o.status === 'scheduled')
      .map((o) => o.slotDate),
  );
  const skipped = new Set(series.skippedDates);
  const horizonEnd = now + series.horizonWeeks * 7 * DAY_MS;
  const members = alwaysInMembers(series, input.roster, input.ineligibleUserIds);
  for (const slotDate of slotDatesInRange(series, now, horizonEnd)) {
    if (taken.has(slotDate) || skipped.has(slotDate)) continue;
    const occ = buildOccurrence(series, slotDate, config, now);
    out.occurrences.push(occ);
    out.effects.push({ type: 'CreateOccurrence', occurrence: occ, game: occurrenceGame(series, occ), dedupeKey: `occurrence:${occ.occurrenceKey}` });
    if (now >= toEpochMs(occ.reconfirmAt)) continue;
    let seats = Math.max(0, series.capacity - 1);
    for (const m of members) {
      const joinedAs = seats > 0 ? 'approved' : 'waitlisted';
      if (seats > 0) seats--;
      out.effects.push({
        type: 'AutoJoin',
        gameId: occ.gameId,
        seriesId: series.id,
        userId: m.userId,
        joinedAs,
        dedupeKey: `autojoin:${occ.gameId}:${m.userId}`,
      });
    }
  }
  return out;
}
