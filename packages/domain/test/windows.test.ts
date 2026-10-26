import { describe, expect, it } from 'vitest';
import {
  canSubmitResult,
  chatExpiresAt,
  checkInWindow,
  depositHoldAt,
  gamePhase,
  isChatOpen,
  isCheckInOpen,
  isLateCancel,
  resolveTrustConfig,
  resultWindow,
  toEpochMs,
  addMs,
  DEFAULT_TRUST_CONFIG,
} from '../src';

const game = { startsAt: '2026-03-01T18:00:00.000Z', endsAt: '2026-03-01T19:30:00.000Z', status: 'scheduled' as const };
const t = (s: string) => Date.parse(s);

describe('game windows', () => {
  it('check-in window is startsAt − 30 min … endsAt inclusive', () => {
    expect(checkInWindow(game)).toEqual({ opensAt: '2026-03-01T17:30:00.000Z', closesAt: '2026-03-01T19:30:00.000Z' });
    expect(isCheckInOpen(game, t('2026-03-01T17:29:59.999Z'))).toBe(false);
    expect(isCheckInOpen(game, t('2026-03-01T17:30:00.000Z'))).toBe(true);
    expect(isCheckInOpen(game, t('2026-03-01T19:30:00.000Z'))).toBe(true);
    expect(isCheckInOpen(game, t('2026-03-01T19:30:00.001Z'))).toBe(false);
  });
  it('results can be submitted from endsAt until endsAt + 2h', () => {
    expect(resultWindow(game).closesAt).toBe('2026-03-01T21:30:00.000Z');
    expect(canSubmitResult(game, t('2026-03-01T19:29:59.999Z'))).toBe(false);
    expect(canSubmitResult(game, t('2026-03-01T21:30:00.000Z'))).toBe(true);
    expect(canSubmitResult(game, t('2026-03-01T21:30:00.001Z'))).toBe(false);
  });
  it('chat expires at endsAt + 3h (exclusive)', () => {
    expect(chatExpiresAt(game)).toBe('2026-03-01T22:30:00.000Z');
    expect(isChatOpen(game, t('2026-03-01T22:29:59.999Z'))).toBe(true);
    expect(isChatOpen(game, t('2026-03-01T22:30:00.000Z'))).toBe(false);
  });
  it('late cancel is strictly less than 2h before start', () => {
    expect(isLateCancel(game.startsAt, '2026-03-01T16:00:00.000Z')).toBe(false);
    expect(isLateCancel(game.startsAt, '2026-03-01T16:00:00.001Z')).toBe(true);
    expect(isLateCancel(game.startsAt, '2026-03-01T18:10:00.000Z')).toBe(true);
    expect(isLateCancel(game.startsAt, '2026-03-01T15:00:00.000Z', resolveTrustConfig({ lateCancelWindowHours: 6 }))).toBe(true);
  });
  it('deposit hold and phase', () => {
    expect(depositHoldAt(game)).toBe('2026-02-28T18:00:00.000Z');
    expect(gamePhase(game, t('2026-03-01T17:00:00Z'))).toBe('upcoming');
    expect(gamePhase(game, t('2026-03-01T18:00:00Z'))).toBe('live');
    expect(gamePhase(game, t('2026-03-01T19:30:00Z'))).toBe('ended');
    expect(gamePhase({ ...game, status: 'cancelled' }, 0)).toBe('cancelled');
  });
});

describe('time and config helpers', () => {
  it('toEpochMs rejects invalid timestamps', () => {
    expect(() => toEpochMs('nope')).toThrow(RangeError);
    expect(addMs('2026-03-01T00:00:00.000Z', 1000)).toBe('2026-03-01T00:00:01.000Z');
  });
  it('resolveTrustConfig merges partial overrides and ignores undefined', () => {
    expect(resolveTrustConfig()).toEqual(DEFAULT_TRUST_CONFIG);
    expect(resolveTrustConfig(null)).toEqual(DEFAULT_TRUST_CONFIG);
    const c = resolveTrustConfig({ gpsMaxAccuracyM: 10, gpsBaseRadiusM: undefined });
    expect(c.gpsMaxAccuracyM).toBe(10);
    expect(c.gpsBaseRadiusM).toBe(50);
    expect(Object.isFrozen(DEFAULT_TRUST_CONFIG)).toBe(true);
  });
});
