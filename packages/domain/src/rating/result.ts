/**
 * Result confirmation (GAME-071) and Glicko eligibility of a game (GLK-003).
 */
import type {
  GameRatingEligibility,
  IsoDateTime,
  ResultConfirmation,
  ResultConfirmationSummary,
  ResultStatus,
  SportId,
  UserId,
} from '../types';
import { toEpochMs } from '../time';
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from '../config';
import { formatFamilyFor } from './glicko2';

export interface ResultConfirmationInput {
  gameId: string;
  /** Who submitted the result (counts as a confirm when verified). */
  submittedBy: UserId;
  /** Verified attendees (the electorate). */
  verifiedUserIds: readonly UserId[];
  /** Stored verdicts; the latest per user wins; non-verified users are ignored. */
  confirmations: readonly ResultConfirmation[];
}

/**
 * Majority of the verified participants: `disputed` when disputes > half,
 * `confirmed` when confirms (incl. the verified submitter) > half, else `pending`.
 */
export function summarizeResultConfirmations(input: ResultConfirmationInput, viewerId?: UserId): ResultConfirmationSummary {
  const verified = new Set(input.verifiedUserIds);
  const latest = new Map<UserId, ResultConfirmation>();
  for (const c of input.confirmations) {
    if (!verified.has(c.userId)) continue;
    const prev = latest.get(c.userId);
    if (!prev || c.createdAt >= prev.createdAt) latest.set(c.userId, c);
  }
  if (verified.has(input.submittedBy) && !latest.has(input.submittedBy)) {
    latest.set(input.submittedBy, { gameId: input.gameId, userId: input.submittedBy, verdict: 'confirm', createdAt: '' });
  }
  let confirms = 0;
  let disputes = 0;
  for (const c of latest.values()) {
    if (c.verdict === 'confirm') confirms++;
    else disputes++;
  }
  const n = verified.size;
  const status: ResultStatus = disputes * 2 > n ? 'disputed' : confirms * 2 > n ? 'confirmed' : 'pending';
  return {
    gameId: input.gameId,
    status,
    confirms,
    disputes,
    verifiedCount: n,
    myVerdict: viewerId === undefined ? null : (latest.get(viewerId)?.verdict ?? null),
  };
}

export interface GameRatingInput {
  sport: SportId;
  startsAt: IsoDateTime;
  /** Submitted scores (one per side), or `null` without a result. */
  teamScores: readonly number[] | null;
  resultStatus: ResultStatus;
  approvedCount: number;
  verifiedCount: number;
  /** When teams were published (GAME-062), or `null`. */
  teamsPublishedAt: IsoDateTime | null;
  /** Verified players per side as published. */
  teams: readonly (readonly UserId[])[];
}

/**
 * GLK-003, first failing check wins: `unrated_sport`, `no_result`,
 * `too_few_verified` (verified / approved < `glickoMinVerifiedRatio`; AC-GLK-003),
 * `teams_not_published` (missing or after kickoff), `not_two_sides` (fewer than
 * two sides, an empty side, or not one score per side), `result_disputed`,
 * `result_not_confirmed`.
 */
export function gameRatingEligibility(input: GameRatingInput, config: DomainConfig = DEFAULT_DOMAIN_CONFIG): GameRatingEligibility {
  const no = (reason: Exclude<GameRatingEligibility['reason'], null>): GameRatingEligibility => ({ eligible: false, reason });
  if (formatFamilyFor(input.sport, 1) === null) return no('unrated_sport');
  if (!input.teamScores) return no('no_result');
  if (input.approvedCount <= 0 || input.verifiedCount / input.approvedCount < config.glickoMinVerifiedRatio) return no('too_few_verified');
  if (input.teamsPublishedAt === null || toEpochMs(input.teamsPublishedAt) > toEpochMs(input.startsAt)) return no('teams_not_published');
  if (input.teams.length < 2 || input.teams.some((t) => t.length === 0) || input.teamScores.length !== input.teams.length) return no('not_two_sides');
  if (input.resultStatus === 'disputed') return no('result_disputed');
  if (input.resultStatus !== 'confirmed') return no('result_not_confirmed');
  return { eligible: true, reason: null };
}
