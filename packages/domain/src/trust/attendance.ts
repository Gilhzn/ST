/**
 * Attendance finalisation (TRUST-010 / 011 / 020 / 021), run by the
 * `process_no_shows` job once `now ≥ endsAt + ATTENDANCE_FINALIZE_HOURS_AFTER_END`.
 *
 * - The game *happened* when ≥ max({@link GAME_HAPPENED_MIN_VERIFIED}, ⌈minPlayers/2⌉)
 *   approved participants are verified. Otherwise nobody gets a card: every
 *   undetermined attendance becomes `excused`, every deposit is released, and the
 *   host is queued for review (TRUST-052).
 * - When it happened: approved participants (host excluded — the host is
 *   reviewed via host reliability) with attendance `unknown` become
 *   `no_show_unverified` and an `AttendanceFinalized` event is produced (→ a
 *   disputable yellow card); verified ones produce `AttendanceFinalized(verified)`
 *   (→ deposit release); each late canceller produces `LateCancelFinalized`
 *   with `refilled` computed from `refills`.
 * Returns effects to apply now plus events to feed into {@link applyTrustEvent}
 * (one per affected user, with that user's state).
 */
import type { Effect, EpochMs, Game, Participant, UserId, IsoDateTime } from '../types';
import { HOUR_MS, toEpochMs } from '../time';
import { ATTENDANCE_FINALIZE_HOURS_AFTER_END, GAME_HAPPENED_MIN_VERIFIED } from './constants';
import type { DomainTrustEvent } from './events';
import { buildReviewItem } from './sanctions';

/** A waitlisted player promoted into the spot a canceller freed. */
export interface LateCancelRefill {
  cancelledUserId: UserId;
  replacementUserId: UserId;
  promotedAt: IsoDateTime;
}

export interface FinalizeAttendanceInput {
  game: Pick<Game, 'id' | 'hostId' | 'startsAt' | 'endsAt' | 'status'>;
  participants: readonly Pick<Participant, 'userId' | 'status' | 'attendance' | 'lateCancel' | 'cancelledAt'>[];
  refills?: readonly LateCancelRefill[];
  /** TODO(contract): `Game.minPlayers`; defaults to 0 (threshold {@link GAME_HAPPENED_MIN_VERIFIED}). */
  minPlayers?: number;
}

export interface FinalizeAttendanceResult {
  /** False when it is too early or the game was cancelled (nothing to do). */
  finalized: boolean;
  gameHappened: boolean | null;
  verifiedCount: number;
  effects: Effect[];
  events: DomainTrustEvent[];
}

/** Earliest time attendance may be finalised. */
export function attendanceFinalizeAt(game: Pick<Game, 'endsAt'>): EpochMs {
  return toEpochMs(game.endsAt) + ATTENDANCE_FINALIZE_HOURS_AFTER_END * HOUR_MS;
}

export function processNoShows(input: FinalizeAttendanceInput, now: EpochMs): FinalizeAttendanceResult {
  const { game } = input;
  const approved = input.participants
    .filter((p) => p.status === 'approved')
    .slice()
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const verifiedCount = approved.filter((p) => p.attendance === 'verified').length;
  const result: FinalizeAttendanceResult = { finalized: false, gameHappened: null, verifiedCount, effects: [], events: [] };
  if (game.status === 'cancelled' || now < attendanceFinalizeAt(game)) return result;
  result.finalized = true;
  const threshold = Math.max(GAME_HAPPENED_MIN_VERIFIED, Math.ceil((input.minPlayers ?? 0) / 2));
  const happened = verifiedCount >= threshold;
  result.gameHappened = happened;
  const lateCancellers = input.participants
    .filter((p) => p.status === 'cancelled' && p.lateCancel && p.cancelledAt !== null)
    .slice()
    .sort((a, b) => (a.userId < b.userId ? -1 : 1));

  if (!happened) {
    for (const p of approved) {
      if (p.attendance === 'unknown') {
        result.effects.push({ type: 'SetAttendance', gameId: game.id, userId: p.userId, attendance: 'excused' });
      }
      result.effects.push({ type: 'SettleDeposit', gameId: game.id, userId: p.userId, outcome: 'release' });
    }
    for (const p of lateCancellers) {
      result.effects.push({ type: 'SettleDeposit', gameId: game.id, userId: p.userId, outcome: 'release' });
    }
    result.effects.push({
      type: 'EnqueueReview',
      item: buildReviewItem(
        {
          kind: 'host_reliability',
          priority: 'normal',
          dedupeKey: `game_not_happened:${game.id}`,
          subjectUserId: game.hostId,
          gameId: game.id,
          evidence: { reason: 'game_not_happened', verifiedCount, threshold },
        },
        now,
      ),
    });
    return result;
  }

  for (const p of approved) {
    if (p.userId === game.hostId) continue;
    if (p.attendance === 'unknown') {
      result.effects.push({ type: 'SetAttendance', gameId: game.id, userId: p.userId, attendance: 'no_show_unverified' });
      result.events.push({ type: 'AttendanceFinalized', gameId: game.id, userId: p.userId, attendance: 'no_show_unverified', endsAt: game.endsAt });
    } else {
      result.events.push({ type: 'AttendanceFinalized', gameId: game.id, userId: p.userId, attendance: p.attendance, endsAt: game.endsAt });
    }
  }
  const byUser = new Map(input.participants.map((p) => [p.userId, p] as const));
  for (const p of lateCancellers) {
    const cancelledAt = p.cancelledAt as IsoDateTime;
    const refilled = (input.refills ?? []).some((r) => {
      const at = toEpochMs(r.promotedAt);
      const replacement = byUser.get(r.replacementUserId);
      return (
        r.cancelledUserId === p.userId &&
        at >= toEpochMs(cancelledAt) &&
        at < toEpochMs(game.startsAt) &&
        replacement?.status === 'approved' &&
        replacement.attendance === 'verified'
      );
    });
    result.events.push({ type: 'LateCancelFinalized', gameId: game.id, userId: p.userId, startsAt: game.startsAt, cancelledAt, refilled });
  }
  return result;
}
