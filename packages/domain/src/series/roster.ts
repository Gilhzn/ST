/**
 * Roster rules (GAME-010/011, PRD §5.4): membership transitions, the
 * roster-only priority window, and the "always in" reconfirm/release cycle.
 * Nothing here ever issues a card: missing reconfirmations only lead to a
 * leave-the-roster offer.
 */
import type {
  AutoJoinRecord,
  EpochMs,
  ErrorCode,
  GameSeries,
  Phase15Effect,
  Result,
  RosterJoinSource,
  RosterMember,
  SeriesId,
  SeriesOccurrence,
  UserId,
} from '../types';
import { HOUR_MS, toEpochMs, toIso } from '../time';
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from '../config';

/** Join phase of an occurrence at `now`. */
export type OccurrenceJoinPhase = 'not_open' | 'roster_only' | 'open' | 'closed';

export function occurrenceJoinPhase(occ: Pick<SeriesOccurrence, 'opensAt' | 'priorityUntil' | 'startsAt' | 'status'>, now: EpochMs): OccurrenceJoinPhase {
  if (occ.status !== 'scheduled' || now >= toEpochMs(occ.startsAt)) return 'closed';
  if (now < toEpochMs(occ.opensAt)) return 'not_open';
  if (now < toEpochMs(occ.priorityUntil)) return 'roster_only';
  return 'open';
}

/** True when `userId` is a regular (or the host) of the series. */
export function isRegular(series: Pick<GameSeries, 'hostId'>, roster: readonly RosterMember[], userId: UserId): boolean {
  return userId === series.hostId || roster.some((m) => m.userId === userId && m.status === 'regular');
}

/**
 * AC-GAME-010: only regulars may request to join before `priorityUntil`; then
 * the public (map or link) may. Rejects `roster_priority` for a non-regular in
 * the roster-only window, `game_not_open` before it opens or once closed.
 */
export function checkOccurrenceJoinWindow(
  series: Pick<GameSeries, 'hostId'>,
  occ: Pick<SeriesOccurrence, 'opensAt' | 'priorityUntil' | 'startsAt' | 'status'>,
  roster: readonly RosterMember[],
  userId: UserId,
  now: EpochMs,
): Result<OccurrenceJoinPhase, ErrorCode> {
  const phase = occurrenceJoinPhase(occ, now);
  if (phase === 'closed' || phase === 'not_open') return { ok: false, error: 'game_not_open' };
  if (phase === 'roster_only' && !isRegular(series, roster, userId)) return { ok: false, error: 'roster_priority' };
  return { ok: true, value: phase };
}

export interface RosterJoinInput {
  series: Pick<GameSeries, 'id' | 'hostId' | 'title' | 'status'>;
  existing: RosterMember | null;
  userId: UserId;
  via: RosterJoinSource;
  /** The user and the host block each other (either direction). */
  blocked: boolean;
}

/**
 * Adds a user to the roster. An invite-link join makes them a `regular` at once
 * (PRD §5.4 step 4); a host / played-with invite makes them `invited` until they
 * accept. Rejects `blocked`, `game_not_open` (series ended), `conflict` (already
 * a regular, or already invited by the host).
 */
export function joinRoster(input: RosterJoinInput, now: EpochMs): Result<{ member: RosterMember; effects: Phase15Effect[] }, ErrorCode> {
  const { series, existing, userId, via } = input;
  if (input.blocked) return { ok: false, error: 'blocked' };
  if (series.status === 'ended') return { ok: false, error: 'game_not_open' };
  if (userId === series.hostId || existing?.status === 'regular') return { ok: false, error: 'conflict' };
  if (existing?.status === 'invited' && via !== 'invite_link') return { ok: false, error: 'conflict' };
  const status = via === 'invite_link' ? 'regular' : 'invited';
  const member: RosterMember = {
    seriesId: series.id,
    userId,
    status,
    alwaysIn: false,
    joinedVia: via,
    consecutiveMisses: 0,
    leaveOfferedAt: null,
    joinedAt: toIso(now),
    leftAt: null,
  };
  const at = toIso(now);
  const effects: Phase15Effect[] = [
    { type: 'UpdateRosterMember', seriesId: series.id, userId, patch: member, dedupeKey: `roster:${series.id}:${userId}:${status}:${at}` },
  ];
  if (status === 'invited') {
    effects.push({
      type: 'Notify15',
      userId,
      kind: 'roster_added',
      params: { seriesTitle: series.title, via },
      gameId: null,
      seriesId: series.id,
      dedupeKey: `roster-invite:${series.id}:${userId}:${at}`,
    });
  }
  return { ok: true, value: { member, effects } };
}

function patchMember(member: RosterMember, patch: Partial<RosterMember>, tag: string, now: EpochMs): { member: RosterMember; effects: Phase15Effect[] } {
  return {
    member: { ...member, ...patch },
    effects: [
      {
        type: 'UpdateRosterMember',
        seriesId: member.seriesId,
        userId: member.userId,
        patch,
        dedupeKey: `roster:${member.seriesId}:${member.userId}:${tag}:${toIso(now)}`,
      },
    ],
  };
}

/** The invited user accepts (`invited` → `regular`). Rejects `not_found` otherwise. */
export function acceptRosterInvite(member: RosterMember | null, now: EpochMs): Result<{ member: RosterMember; effects: Phase15Effect[] }, ErrorCode> {
  if (member?.status !== 'invited') return { ok: false, error: 'not_found' };
  return { ok: true, value: patchMember(member, { status: 'regular', joinedAt: toIso(now) }, 'accept', now) };
}

/** Leaving (or being removed): `left`, "always in" off. Rejects `not_found` when not on the roster. */
export function leaveRoster(member: RosterMember | null, now: EpochMs): Result<{ member: RosterMember; effects: Phase15Effect[] }, ErrorCode> {
  if (!member || member.status === 'left') return { ok: false, error: 'not_found' };
  return { ok: true, value: patchMember(member, { status: 'left', alwaysIn: false, leftAt: toIso(now) }, 'left', now) };
}

/** Sets "I'm always in". Only regulars; rejects `forbidden` otherwise. */
export function setAlwaysIn(member: RosterMember | null, alwaysIn: boolean, now: EpochMs): Result<{ member: RosterMember; effects: Phase15Effect[] }, ErrorCode> {
  if (member?.status !== 'regular') return { ok: false, error: 'forbidden' };
  return { ok: true, value: patchMember(member, { alwaysIn }, `always-in-${alwaysIn}`, now) };
}

export interface AutoJoinTickInput {
  series: Pick<GameSeries, 'id' | 'title'>;
  occurrence: SeriesOccurrence;
  autoJoins: readonly AutoJoinRecord[];
  roster: readonly RosterMember[];
}

function held(r: AutoJoinRecord): boolean {
  return r.releasedAt === null && r.reconfirmedAt === null;
}

/**
 * Scheduled job for one occurrence (idempotent; run at least hourly):
 * - at `reconfirmAt` (T−48h): every held, unconfirmed auto-join gets a
 *   `RequestReconfirm` (deadline `releaseAt`) and a `series_reconfirm` notice;
 * - at `releaseAt` (T−24h): every auto-join still unconfirmed is released
 *   (`ReleaseAutoJoin`, no card) and notified. If it was asked to reconfirm,
 *   it counts as a miss; reaching `rosterMissesBeforeLeaveOffer` consecutive
 *   misses sends one `roster_leave_offer` (GAME-011). A member who was never
 *   asked (job outage) is released without a miss.
 */
export function processAutoJoins(input: AutoJoinTickInput, config: DomainConfig = DEFAULT_DOMAIN_CONFIG, now: EpochMs): { effects: Phase15Effect[] } {
  const { occurrence: occ, series } = input;
  const effects: Phase15Effect[] = [];
  if (occ.status !== 'scheduled' || now >= toEpochMs(occ.startsAt) || now < toEpochMs(occ.reconfirmAt)) return { effects };
  const releasing = now >= toEpochMs(occ.releaseAt);
  const records = input.autoJoins.filter(held).sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  for (const r of records) {
    if (!releasing) {
      if (r.reconfirmRequestedAt !== null) continue;
      effects.push(
        { type: 'RequestReconfirm', gameId: r.gameId, userId: r.userId, deadline: occ.releaseAt, dedupeKey: `reconfirm:${r.gameId}:${r.userId}` },
        {
          type: 'Notify15',
          userId: r.userId,
          kind: 'series_reconfirm',
          params: { seriesTitle: series.title, startsAt: occ.startsAt, deadline: occ.releaseAt },
          gameId: r.gameId,
          seriesId: series.id,
          dedupeKey: `notify:series_reconfirm:${r.gameId}:${r.userId}`,
        },
      );
      continue;
    }
    effects.push(
      { type: 'ReleaseAutoJoin', gameId: r.gameId, userId: r.userId, dedupeKey: `release:${r.gameId}:${r.userId}` },
      {
        type: 'Notify15',
        userId: r.userId,
        kind: 'series_auto_released',
        params: { seriesTitle: series.title, startsAt: occ.startsAt },
        gameId: r.gameId,
        seriesId: series.id,
        dedupeKey: `notify:series_auto_released:${r.gameId}:${r.userId}`,
      },
    );
    const member = input.roster.find((m) => m.userId === r.userId);
    if (!member || r.reconfirmRequestedAt === null) continue;
    const misses = member.consecutiveMisses + 1;
    const offer = misses >= config.rosterMissesBeforeLeaveOffer && member.leaveOfferedAt === null;
    effects.push({
      type: 'UpdateRosterMember',
      seriesId: series.id,
      userId: r.userId,
      patch: offer ? { consecutiveMisses: misses, leaveOfferedAt: toIso(now) } : { consecutiveMisses: misses },
      dedupeKey: `roster-miss:${series.id}:${r.userId}:${r.gameId}`,
    });
    if (offer) {
      effects.push({
        type: 'Notify15',
        userId: r.userId,
        kind: 'roster_leave_offer',
        params: { seriesTitle: series.title, misses },
        gameId: null,
        seriesId: series.id,
        dedupeKey: `notify:roster_leave_offer:${series.id}:${r.userId}:${r.gameId}`,
      });
    }
  }
  return { effects };
}

export interface ReconfirmInput {
  seriesId: SeriesId;
  record: AutoJoinRecord | null;
  occurrence: Pick<SeriesOccurrence, 'startsAt' | 'status'>;
  member: RosterMember | null;
}

/**
 * The member answers the reconfirmation. `attending` keeps the spot; `false`
 * releases it without a card, allowed only before the late-cancel window
 * (afterwards `outside_window`: use the normal cancel, which may be a late
 * cancel). Either answer resets the miss streak. Rejects `not_found` without a
 * held auto-join, `game_not_open` once started or cancelled. Persist the
 * returned record.
 */
export function reconfirmAutoJoin(
  input: ReconfirmInput,
  attending: boolean,
  config: DomainConfig = DEFAULT_DOMAIN_CONFIG,
  now: EpochMs,
): Result<{ record: AutoJoinRecord; effects: Phase15Effect[] }, ErrorCode> {
  const { record, occurrence, member } = input;
  if (!record || record.releasedAt !== null) return { ok: false, error: 'not_found' };
  const start = toEpochMs(occurrence.startsAt);
  if (occurrence.status !== 'scheduled' || now >= start) return { ok: false, error: 'game_not_open' };
  const effects: Phase15Effect[] = [];
  let next: AutoJoinRecord;
  if (attending) {
    next = { ...record, reconfirmedAt: toIso(now) };
  } else {
    if (start - now < config.lateCancelWindowHours * HOUR_MS) return { ok: false, error: 'outside_window' };
    next = { ...record, releasedAt: toIso(now) };
    effects.push({ type: 'ReleaseAutoJoin', gameId: record.gameId, userId: record.userId, dedupeKey: `release:${record.gameId}:${record.userId}` });
  }
  if (member && member.consecutiveMisses > 0) {
    effects.push({
      type: 'UpdateRosterMember',
      seriesId: input.seriesId,
      userId: record.userId,
      patch: { consecutiveMisses: 0 },
      dedupeKey: `roster-miss-reset:${input.seriesId}:${record.userId}:${record.gameId}`,
    });
  }
  return { ok: true, value: { record: next, effects } };
}
