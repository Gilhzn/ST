import {
  DEFAULT_TRUST_CONFIG,
  type CheckInVerdict,
  type EpochMs,
  type Game,
  type Participant,
  type TrustConfig,
  type UserId,
} from '../types';
import { checkInWindow } from '../games/windows';
import { HOST_MARK_GRACE_HOURS } from '../trust/constants';
import { HOUR_MS, toEpochMs } from '../time';

/** Input to {@link verifyHost}. */
export interface HostCheckInInput {
  /** The user performing the action (must be the host). */
  actorId: UserId;
  game: Pick<Game, 'hostId' | 'startsAt' | 'endsAt' | 'status'>;
  /** The participant being marked present, or `null` if not in the game. */
  target: Pick<Participant, 'userId' | 'status' | 'attendance'> | null;
}

/**
 * The host marks a player present (TRUST-008). Checks, in order: `not_host`
 * (also when the host targets themself: no self-attest, the host must check in
 * by GPS / QR / peers), `outside_window` (window is `startsAt − 30 min …
 * endsAt + HOST_MARK_GRACE_HOURS`; cancelled games are always outside),
 * `not_participant` (must be `approved`), `already_checked_in`.
 */
export function verifyHost(input: HostCheckInInput, now: EpochMs, config: TrustConfig = DEFAULT_TRUST_CONFIG): CheckInVerdict {
  const rejected = (reason: 'not_host' | 'outside_window' | 'not_participant' | 'already_checked_in'): CheckInVerdict => ({
    outcome: 'rejected',
    method: 'host',
    reason,
    fallbacks: [],
    signals: [],
  });
  if (input.actorId !== input.game.hostId || input.target?.userId === input.actorId) return rejected('not_host');
  const w = checkInWindow(input.game, config);
  const open = now >= toEpochMs(w.opensAt) && now <= toEpochMs(w.closesAt) + HOST_MARK_GRACE_HOURS * HOUR_MS;
  if (input.game.status === 'cancelled' || !open) return rejected('outside_window');
  if (!input.target || input.target.status !== 'approved') return rejected('not_participant');
  if (input.target.attendance === 'verified') return rejected('already_checked_in');
  return { outcome: 'verified', method: 'host', distanceM: null, signals: [] };
}
