/**
 * checkin-verify: stage-2 GPS check-in (architecture §5.2).
 *
 * POST { gameId, samples: GpsSample[2..10], integrity?: { platform, token } }  (user JWT)
 * → 200 CheckInVerdict (verified, or rejected with fallbacks: qr / peer / host)
 *
 * The exact pin is read *as the caller* (`game_views`: only approved
 * participants see it when the location is hidden). The domain `verifyGps`
 * decides; the verdict is recorded with the service role through
 * `record_checkin_verdict` (which also marks attendance). Raw samples are
 * never persisted or logged; only verdict, best distance and spoof signals.
 * Spoof signals and failed device-integrity checks only route to fallbacks,
 * never to a sanction.
 */
import {
  NON_GPS_FALLBACKS,
  StError,
  verifyGps,
  type CheckInMethod,
  type CheckInVerdict,
  type GameId,
  type GameStatus,
  type GpsSample,
  type IsoDateTime,
  type LatLng,
  type ParticipantStatus,
  type AttendanceStatus,
  type UserId,
} from '@st/domain';
import { requireUser, type AuthVerifier } from '#shared/auth';
import type { ConfigSource } from '#shared/config';
import { json, readJson, route, type CorsOptions } from '#shared/http';
import type { Logger } from '#shared/log';
import type { Clock, RateLimiter } from '#shared/runtime';
import { arrayField, finiteNumber, objectValue, uuidField } from '#shared/validate';

export interface CheckinGame {
  id: GameId;
  status: GameStatus;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  /** Exact pin, `null` when hidden from the caller. */
  location: LatLng | null;
}

export interface CheckinStore {
  /** Reads `game_views` with the caller's token; `null` when not visible. */
  loadGame(accessToken: string, gameId: GameId): Promise<CheckinGame | null>;
  loadParticipant(gameId: GameId, userId: UserId): Promise<{ status: ParticipantStatus; attendance: AttendanceStatus } | null>;
  /** `record_checkin_verdict` (service role). Returns the stored verdict. */
  recordVerdict(gameId: GameId, userId: UserId, verdict: CheckInVerdict): Promise<CheckInVerdict>;
}

export type IntegrityPlatform = 'ios' | 'android' | 'web';

/** Device attestation (App Attest / Play Integrity) seam. MVP: not configured → `unavailable`. */
export interface IntegrityVerifier {
  verify(platform: IntegrityPlatform, token: string, nonce: string): Promise<'pass' | 'fail' | 'unavailable'>;
}

export const integrityNotConfigured: IntegrityVerifier = { verify: () => Promise.resolve('unavailable') };

export interface CheckinDeps {
  auth: AuthVerifier;
  store: CheckinStore;
  integrity: IntegrityVerifier;
  config: ConfigSource;
  rateLimiter: RateLimiter;
  clock: Clock;
  log: Logger;
  cors: CorsOptions;
}

export const MAX_SAMPLES = 10;

function parseSample(raw: unknown, i: number): GpsSample {
  const o = objectValue(raw, `samples[${i}]`);
  const sample: GpsSample = {
    lat: finiteNumber(o['lat'], `samples[${i}].lat`, -90, 90),
    lng: finiteNumber(o['lng'], `samples[${i}].lng`, -180, 180),
    accuracyM: finiteNumber(o['accuracyM'], `samples[${i}].accuracyM`, 0, 100_000),
    timestamp: finiteNumber(o['timestamp'], `samples[${i}].timestamp`, 0, 8.64e15),
  };
  if (o['isMock'] !== undefined) {
    if (typeof o['isMock'] !== 'boolean') throw new StError('validation', 'isMock must be boolean', { field: `samples[${i}].isMock` });
    sample.isMock = o['isMock'];
  }
  return sample;
}

function rejected(reason: Extract<CheckInVerdict, { outcome: 'rejected' }>['reason'], fallbacks: readonly CheckInMethod[]): CheckInVerdict {
  return { outcome: 'rejected', method: 'gps', reason, fallbacks, signals: [] };
}

export async function handle(req: Request, deps: CheckinDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'], cors: deps.cors }, async (cors) => {
    const user = await requireUser(req, deps.auth);
    const input = await readJson(req, 16 * 1024);
    const gameId = uuidField(input, 'gameId');
    const samples = arrayField(input, 'samples', MAX_SAMPLES).map(parseSample);
    const integrity = input['integrity'] === undefined || input['integrity'] === null ? null : objectValue(input['integrity'], 'integrity');

    const limit = await deps.rateLimiter.hit(`checkin:${user.userId}:${gameId}`, 10, 10 * 60_000);
    if (!limit.allowed) throw new StError('rate_limited', 'too many check-in attempts', { retryAfterMs: limit.retryAfterMs });

    const game = await deps.store.loadGame(user.accessToken, gameId);
    if (!game) throw new StError('not_found');
    const participant = await deps.store.loadParticipant(gameId, user.userId);
    const now = deps.clock.now();
    const config = await deps.config.get();

    let verdict: CheckInVerdict;
    if (!participant || participant.status !== 'approved' || !game.location) {
      verdict = rejected('not_participant', []);
    } else if (participant.attendance === 'verified') {
      return json({ outcome: 'verified', method: 'gps', distanceM: null, signals: [] } satisfies CheckInVerdict, 200, cors);
    } else if (game.status !== 'scheduled') {
      verdict = rejected('outside_window', []);
    } else {
      verdict = verifyGps(samples, game.location, { startsAt: game.startsAt, endsAt: game.endsAt }, now, null, config);
      if (verdict.outcome === 'verified' && integrity) {
        const platform = integrity['platform'];
        const token = integrity['token'];
        if ((platform === 'ios' || platform === 'android' || platform === 'web') && typeof token === 'string' && token.length > 0 && token.length <= 8192) {
          const result = await deps.integrity.verify(platform, token, `${gameId}:${user.userId}`);
          if (result === 'fail') verdict = { outcome: 'rejected', method: 'gps', reason: 'suspected_spoofing', fallbacks: NON_GPS_FALLBACKS, signals: [] };
        }
      }
    }

    // Rejections for non-participants are not recorded (they would reveal nothing useful and add noise).
    const stored = verdict.outcome === 'rejected' && verdict.reason === 'not_participant' ? verdict : await deps.store.recordVerdict(gameId, user.userId, verdict);
    deps.log.info('checkin.verdict', {
      gameId,
      outcome: stored.outcome,
      reason: stored.outcome === 'rejected' ? stored.reason : null,
      signals: stored.signals,
      sampleCount: samples.length,
    });
    return json(stored, 200, cors);
  });
}
