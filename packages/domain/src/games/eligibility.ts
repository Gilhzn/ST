/**
 * Join / create eligibility (client UX mirror of the `request_join` and
 * `create_game` RPC checks; the server is authoritative). Checks run in a
 * fixed order so the returned `ErrorCode` is deterministic.
 */
import type { Block, EpochMs, ErrorCode, Game, GameVisibility, Gender, IsoDateTime, Participant, Result, UserId } from '../types';
import { HOUR_MS, toEpochMs } from '../time';
import { REGULARS_PRIORITY_HOURS } from '../trust/constants';

/** Restriction fields of the acting user (from `Profile`). */
export interface EligibilityUser {
  id: UserId;
  gender: Gender;
  permanentlyBanned: boolean;
  joinBannedUntil: IsoDateTime | null;
  visibilityRestrictedUntil: IsoDateTime | null;
  hostSuspendedUntil?: IsoDateTime | null;
}

export interface JoinEligibilityInput {
  game: Pick<Game, 'id' | 'hostId' | 'status' | 'startsAt' | 'capacity' | 'womenOnly' | 'visibility' | 'createdAt'>;
  user: EligibilityUser;
  /** The user's existing participation in this game, if any. */
  existing: Pick<Participant, 'status'> | null;
  /** Approved participants (capacity and block checks). */
  approvedUserIds: readonly UserId[];
  blocks: readonly Pick<Block, 'blockerId' | 'blockedId'>[];
  /** For an instance of a recurring series: its regulars, who alone may join for the priority window. */
  regularIds?: readonly UserId[];
}

function until(iso: IsoDateTime | null | undefined, now: EpochMs): boolean {
  return iso !== null && iso !== undefined && toEpochMs(iso) > now;
}

/** End of the regulars-only window (AC-GAME-010), or `null` for non-series games. */
export function regularsPriorityUntil(game: Pick<Game, 'createdAt'>, regularIds?: readonly UserId[]): EpochMs | null {
  if (!regularIds || regularIds.length === 0) return null;
  return toEpochMs(game.createdAt) + REGULARS_PRIORITY_HOURS * HOUR_MS;
}

/**
 * Order: `account_banned`, `join_banned`, `forbidden` (visibility-restricted user
 * and a public game, TRUST-043; the host requesting their own game; removed by
 * the host), `game_not_open` (not scheduled, started, or regulars-only window),
 * `conflict` (already requested/approved/waitlisted/rejected), `blocked` (with the
 * host or any approved participant, either direction), `women_only`.
 * On success `full` says the request would be waitlisted after approval.
 */
export function checkJoinEligibility(input: JoinEligibilityInput, now: EpochMs): Result<{ full: boolean }, ErrorCode> {
  const { game, user } = input;
  const fail = (error: ErrorCode): Result<{ full: boolean }, ErrorCode> => ({ ok: false, error });
  if (user.permanentlyBanned) return fail('account_banned');
  if (until(user.joinBannedUntil, now)) return fail('join_banned');
  if (game.visibility === 'public' && until(user.visibilityRestrictedUntil, now)) return fail('forbidden');
  if (game.hostId === user.id) return fail('forbidden');
  if (input.existing?.status === 'removed') return fail('forbidden');
  if (game.status !== 'scheduled' || now >= toEpochMs(game.startsAt)) return fail('game_not_open');
  const priorityUntil = regularsPriorityUntil(game, input.regularIds);
  if (priorityUntil !== null && now < priorityUntil && !(input.regularIds ?? []).includes(user.id)) {
    return fail('game_not_open');
  }
  const st = input.existing?.status;
  if (st === 'requested' || st === 'approved' || st === 'waitlisted' || st === 'rejected') return fail('conflict');
  const others = new Set([game.hostId, ...input.approvedUserIds]);
  if (input.blocks.some((b) => (b.blockerId === user.id && others.has(b.blockedId)) || (b.blockedId === user.id && others.has(b.blockerId)))) {
    return fail('blocked');
  }
  if (game.womenOnly && user.gender !== 'female') return fail('women_only');
  return { ok: true, value: { full: input.approvedUserIds.length >= game.capacity } };
}

/**
 * Game creation (TRUST-026 / 043 / GAME-016): `account_banned`, `host_suspended`,
 * `join_banned` and `forbidden` (visibility restriction) for public games, and
 * `women_only` when a non-female host creates a women-only game.
 */
export function checkCreateGameEligibility(
  user: EligibilityUser,
  game: { visibility: GameVisibility; womenOnly: boolean },
  now: EpochMs,
): Result<true, ErrorCode> {
  if (user.permanentlyBanned) return { ok: false, error: 'account_banned' };
  if (until(user.hostSuspendedUntil, now)) return { ok: false, error: 'host_suspended' };
  if (game.visibility === 'public' && until(user.joinBannedUntil, now)) return { ok: false, error: 'join_banned' };
  if (game.visibility === 'public' && until(user.visibilityRestrictedUntil, now)) return { ok: false, error: 'forbidden' };
  if (game.womenOnly && user.gender !== 'female') return { ok: false, error: 'women_only' };
  return { ok: true, value: true };
}
