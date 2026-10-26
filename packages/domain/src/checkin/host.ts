import {
  DEFAULT_TRUST_CONFIG,
  type CheckInVerdict,
  type EpochMs,
  type Game,
  type Participant,
  type TrustConfig,
  type UserId,
} from '../types';
import { isCheckInOpen } from '../games/windows';

/** Input to {@link verifyHost}. */
export interface HostCheckInInput {
  /** The user performing the action (must be the host). */
  actorId: UserId;
  game: Pick<Game, 'hostId' | 'startsAt' | 'endsAt' | 'status'>;
  /** The participant being marked present, or `null` if not in the game. */
  target: Pick<Participant, 'userId' | 'status' | 'attendance'> | null;
}

/**
 * The host marks a player present. Checks, in order: `not_host`,
 * `outside_window` (also for cancelled games), `not_participant` (must be
 * `approved`), `already_checked_in`. The host may mark themself present.
 */
export function verifyHost(input: HostCheckInInput, now: EpochMs, config: TrustConfig = DEFAULT_TRUST_CONFIG): CheckInVerdict {
  const rejected = (reason: 'not_host' | 'outside_window' | 'not_participant' | 'already_checked_in'): CheckInVerdict => ({
    outcome: 'rejected',
    method: 'host',
    reason,
    fallbacks: [],
    signals: [],
  });
  if (input.actorId !== input.game.hostId) return rejected('not_host');
  if (input.game.status === 'cancelled' || !isCheckInOpen(input.game, now, config)) return rejected('outside_window');
  if (!input.target || input.target.status !== 'approved') return rejected('not_participant');
  if (input.target.attendance === 'verified') return rejected('already_checked_in');
  return { outcome: 'verified', method: 'host', distanceM: null, signals: [] };
}
