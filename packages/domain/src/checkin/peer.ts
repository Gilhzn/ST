/**
 * Peer check-in: a player is verified once at least `peerMinConfirmations`
 * *qualifying* attendees confirm them. A confirmation from C for target T
 * qualifies when C ≠ T, C is an approved participant with attendance
 * `verified`, C and T have not blocked each other (either direction), and the
 * pair is not *reciprocal-only*: C was itself verified by peers **and** T
 * confirmed C. A confirmer verified independently (GPS / QR / host) counts even
 * if T confirmed them too, because their own presence does not depend on T.
 *
 * Mirrored by SQL `peer_confirm` (golden kind `checkin.verifyPeer`).
 */
import {
  DEFAULT_TRUST_CONFIG,
  type Block,
  type CheckInVerdict,
  type EpochMs,
  type Participant,
  type PeerConfirmResult,
  type TrustConfig,
  type UserId,
} from '../types';
import { isCheckInOpen, type GameWindow } from '../games/windows';

/** One stored peer confirmation (`peer_confirmations` row) within a game. */
export interface PeerConfirmation {
  confirmerId: UserId;
  targetId: UserId;
}

/** The participant fields peer verification reads. */
export type PeerParticipant = Pick<Participant, 'userId' | 'status' | 'attendance' | 'checkInMethod'>;

/** Input to {@link verifyPeer}. */
export interface PeerCheckInInput {
  targetUserId: UserId;
  participants: readonly PeerParticipant[];
  /** All confirmations of the game (other targets are ignored). */
  confirmations: readonly PeerConfirmation[];
  /** Blocks involving any participant (direction is irrelevant). */
  blocks: readonly Pick<Block, 'blockerId' | 'blockedId'>[];
  /** When given, confirmations outside the check-in window are rejected. */
  window?: GameWindow;
}

/** Ids of confirmers that currently qualify for the target, sorted. */
export function qualifyingPeerConfirmers(input: PeerCheckInInput): {
  qualifying: UserId[];
  excludedReciprocal: UserId[];
  excludedBlocked: UserId[];
} {
  const byId = new Map(input.participants.map((p) => [p.userId, p] as const));
  const t = input.targetUserId;
  const targetConfirmed = new Set(input.confirmations.filter((c) => c.confirmerId === t).map((c) => c.targetId));
  const blocked = new Set<UserId>();
  for (const b of input.blocks) {
    if (b.blockerId === t) blocked.add(b.blockedId);
    if (b.blockedId === t) blocked.add(b.blockerId);
  }
  const confirmers = [...new Set(input.confirmations.filter((c) => c.targetId === t).map((c) => c.confirmerId))].sort();
  const qualifying: UserId[] = [];
  const excludedReciprocal: UserId[] = [];
  const excludedBlocked: UserId[] = [];
  for (const c of confirmers) {
    const p = byId.get(c);
    if (c === t || !p || p.status !== 'approved' || p.attendance !== 'verified') continue;
    if (blocked.has(c)) excludedBlocked.push(c);
    else if (p.checkInMethod === 'peer' && targetConfirmed.has(c)) excludedReciprocal.push(c);
    else qualifying.push(c);
  }
  return { qualifying, excludedReciprocal, excludedBlocked };
}

/**
 * Evaluates the target's peer check-in. Rejection reasons in order:
 * `outside_window`, `not_participant`, `already_checked_in`, then when short of
 * confirmations: `reciprocal_only` (would pass counting reciprocal pairs),
 * `blocked_pair` (would pass counting blocked pairs), else `insufficient_peers`.
 */
export function verifyPeer(
  input: PeerCheckInInput,
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): PeerConfirmResult {
  const { qualifying, excludedReciprocal, excludedBlocked } = qualifyingPeerConfirmers(input);
  const confirmations = qualifying.length;
  const rejected = (
    reason: 'outside_window' | 'not_participant' | 'already_checked_in' | 'reciprocal_only' | 'blocked_pair' | 'insufficient_peers',
  ): PeerConfirmResult => ({
    confirmations,
    verdict: {
      outcome: 'rejected',
      method: 'peer',
      reason,
      fallbacks: reason === 'outside_window' || reason === 'not_participant' || reason === 'already_checked_in' ? [] : ['qr', 'host'],
      signals: [],
    },
  });
  if (input.window && !isCheckInOpen(input.window, now, config)) return rejected('outside_window');
  const target = input.participants.find((p) => p.userId === input.targetUserId);
  if (!target || target.status !== 'approved') return rejected('not_participant');
  if (target.attendance === 'verified') return rejected('already_checked_in');
  const min = config.peerMinConfirmations;
  if (confirmations >= min) {
    const verdict: CheckInVerdict = { outcome: 'verified', method: 'peer', distanceM: null, signals: [] };
    return { confirmations, verdict };
  }
  if (confirmations + excludedReciprocal.length >= min) return rejected('reciprocal_only');
  if (confirmations + excludedReciprocal.length + excludedBlocked.length >= min) return rejected('blocked_pair');
  return rejected('insufficient_peers');
}
