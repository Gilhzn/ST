/**
 * Rotating QR check-in tokens.
 *
 * Wire format (documented for the SQL/Edge mirrors):
 * ```
 * step  = floor(now_ms / 1000 / qrStepSeconds)
 * mac   = lower(hex(HMAC_SHA256(key = utf8(qrSecret), msg = utf8(gameId + "|" + step))))
 * token = step + "." + mac[0:32]        -- 128-bit truncated MAC (RFC 2104 §5)
 * ```
 * pgcrypto: `step || '.' || left(encode(hmac(game_id::text || '|' || step, qr_secret, 'sha256'), 'hex'), 32)`.
 * The token carries its step so an old-but-authentic token is reported as
 * `expired_qr` rather than `invalid_qr`. Rotating `qr_secret` invalidates all
 * outstanding tokens (screenshots die).
 */
import {
  DEFAULT_TRUST_CONFIG,
  type CheckInVerdict,
  type EpochMs,
  type GameId,
  type QrToken,
  type TrustConfig,
} from '../types';
import { constantTimeEqual, hmacSha256Hex } from '../crypto/sha256';
import { isCheckInOpen, type GameWindow } from '../games/windows';
import { SECOND_MS, toIso } from '../time';
import { NON_GPS_FALLBACKS } from './gps';

/** Hex characters of the MAC kept in the token (128 bits). */
export const QR_MAC_HEX_LENGTH = 32;

const TOKEN_RE = /^(\d{1,15})\.([0-9a-f]+)$/;

/** Time-step index for `now`. */
export function qrStep(now: EpochMs, config: TrustConfig = DEFAULT_TRUST_CONFIG): number {
  return Math.floor(now / (config.qrStepSeconds * SECOND_MS));
}

/** The MAC part of the token for one step. */
export function qrMac(qrSecret: string, gameId: GameId, step: number): string {
  return hmacSha256Hex(qrSecret, `${gameId}|${step}`).slice(0, QR_MAC_HEX_LENGTH);
}

/** Builds the token the host displays for `now` (host only; requires the secret). */
export function generateQrToken(
  qrSecret: string,
  gameId: GameId,
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): QrToken {
  const step = qrStep(now, config);
  return {
    token: `${step}.${qrMac(qrSecret, gameId, step)}`,
    step,
    expiresAt: toIso((step + 1) * config.qrStepSeconds * SECOND_MS),
  };
}

/**
 * Verifies a scanned token: valid for steps `current ± qrAllowedDriftSteps`.
 * If `window` is given, scans outside the check-in window are `outside_window`.
 */
export function verifyQr(
  token: string,
  qrSecret: string,
  gameId: GameId,
  now: EpochMs,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
  window?: GameWindow,
): CheckInVerdict {
  if (window && !isCheckInOpen(window, now, config)) {
    return { outcome: 'rejected', method: 'qr', reason: 'outside_window', fallbacks: [], signals: [] };
  }
  const invalid: CheckInVerdict = {
    outcome: 'rejected',
    method: 'qr',
    reason: 'invalid_qr',
    fallbacks: NON_GPS_FALLBACKS,
    signals: [],
  };
  const m = TOKEN_RE.exec(token.trim());
  if (!m) return invalid;
  const step = Number(m[1]);
  const mac = m[2] as string;
  if (!constantTimeEqual(mac, qrMac(qrSecret, gameId, step))) return invalid;
  if (Math.abs(step - qrStep(now, config)) > config.qrAllowedDriftSteps) {
    return { ...invalid, reason: 'expired_qr' };
  }
  return { outcome: 'verified', method: 'qr', distanceM: null, signals: [] };
}
