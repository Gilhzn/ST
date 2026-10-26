/**
 * Time windows around a game. All boundaries are inclusive unless noted, and
 * every function is pure in `now`. SQL mirrors: `games.ends_at + interval` CHECKs
 * and RPC guards (see golden kind `games.windows`).
 */
import { DEFAULT_TRUST_CONFIG, type EpochMs, type Game, type IsoDateTime, type TrustConfig } from '../types';
import { HOUR_MS, MINUTE_MS, toEpochMs, toIso } from '../time';

/** The two timestamps every window is derived from (a `Game` satisfies it). */
export type GameWindow = Pick<Game, 'startsAt' | 'endsAt'>;

/** A closed interval `[opensAt, closesAt]`. */
export interface TimeWindow {
  opensAt: IsoDateTime;
  closesAt: IsoDateTime;
}

function inside(w: TimeWindow, now: EpochMs): boolean {
  return now >= toEpochMs(w.opensAt) && now <= toEpochMs(w.closesAt);
}

/** Check-in window: `startsAt − checkInOpensMinutesBeforeStart` … `endsAt`. */
export function checkInWindow(game: GameWindow, config: TrustConfig = DEFAULT_TRUST_CONFIG): TimeWindow {
  return {
    opensAt: toIso(toEpochMs(game.startsAt) - config.checkInOpensMinutesBeforeStart * MINUTE_MS),
    closesAt: toIso(toEpochMs(game.endsAt)),
  };
}

/** True while check-in (any method) is accepted. */
export function isCheckInOpen(game: GameWindow, now: EpochMs, config: TrustConfig = DEFAULT_TRUST_CONFIG): boolean {
  return inside(checkInWindow(game, config), now);
}

/** Result window: `endsAt` … `endsAt + resultWindowHours`. */
export function resultWindow(game: GameWindow, config: TrustConfig = DEFAULT_TRUST_CONFIG): TimeWindow {
  const end = toEpochMs(game.endsAt);
  return { opensAt: toIso(end), closesAt: toIso(end + config.resultWindowHours * HOUR_MS) };
}

/** True when a result may be submitted now (after the end, within `resultWindowHours`). */
export function canSubmitResult(game: GameWindow, now: EpochMs, config: TrustConfig = DEFAULT_TRUST_CONFIG): boolean {
  return inside(resultWindow(game, config), now);
}

/** `ChatMessage.expiresAt` for every message of the game: `endsAt + chatTtlHoursAfterEnd`. */
export function chatExpiresAt(game: Pick<Game, 'endsAt'>, config: TrustConfig = DEFAULT_TRUST_CONFIG): IsoDateTime {
  return toIso(toEpochMs(game.endsAt) + config.chatTtlHoursAfterEnd * HOUR_MS);
}

/** True while the chat is readable/writable (strictly before {@link chatExpiresAt}). */
export function isChatOpen(game: Pick<Game, 'endsAt'>, now: EpochMs, config: TrustConfig = DEFAULT_TRUST_CONFIG): boolean {
  return now < toEpochMs(chatExpiresAt(game, config));
}

/**
 * True when cancelling at `cancelledAt` is a late cancel: strictly less than
 * `lateCancelWindowHours` before `startsAt` (cancelling exactly at the
 * boundary, or earlier, is free; cancelling after the start is late).
 */
export function isLateCancel(
  startsAt: IsoDateTime,
  cancelledAt: IsoDateTime,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): boolean {
  return toEpochMs(startsAt) - toEpochMs(cancelledAt) < config.lateCancelWindowHours * HOUR_MS;
}

/** When the deposit hold is placed: `startsAt − depositHoldLeadHours`. */
export function depositHoldAt(game: Pick<Game, 'startsAt'>, config: TrustConfig = DEFAULT_TRUST_CONFIG): IsoDateTime {
  return toIso(toEpochMs(game.startsAt) - config.depositHoldLeadHours * HOUR_MS);
}

/** Derived lifecycle phase of a game at `now` ("live" and "full" are never stored). */
export type GamePhase = 'upcoming' | 'live' | 'ended' | 'cancelled';

export function gamePhase(game: GameWindow & Pick<Game, 'status'>, now: EpochMs): GamePhase {
  if (game.status === 'cancelled') return 'cancelled';
  if (now < toEpochMs(game.startsAt)) return 'upcoming';
  if (now < toEpochMs(game.endsAt)) return 'live';
  return 'ended';
}
