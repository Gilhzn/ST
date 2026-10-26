/**
 * The single place where the InMemoryAdapter reaches business rules.
 *
 * Everything here comes from `@st/domain` (pure, shared with SQL/Edge via golden
 * cases), so e2e tests exercise the real rules. No rule is re-implemented in
 * the app.
 */
export {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  SECOND_MS,
  acceptWaitlistOffer,
  approximateLocation,
  balanceTeams,
  buildSystemSanction,
  canDispute,
  canSubmitResult,
  chatExpiresAt,
  checkCreateGameEligibility,
  checkJoinEligibility,
  combineModerationVerdicts,
  decideJoinOutcome,
  evaluateChatBlocks,
  generateQrToken,
  haversineMeters,
  isChatOpen,
  isCheckInOpen,
  isLateCancel,
  matchBlocklist,
  materializeSanction,
  promoteFromWaitlist,
  mulberry32,
  seedFromString,
  shuffle,
  toEpochMs,
  toIso,
  verifyGps,
  verifyHost,
  verifyPeer,
  verifyQr,
} from '@st/domain';
export type { ChatBlockRecord } from '@st/domain';
