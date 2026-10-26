import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRUST_CONFIG,
  acceptWaitlistOffer,
  checkCreateGameEligibility,
  checkJoinEligibility,
  decideJoinOutcome,
  freeSpots,
  nextWaitlistRank,
  orderWaitlist,
  promoteFromWaitlist,
  regularsPriorityUntil,
  waitlistMode,
  type EligibilityUser,
  type JoinEligibilityInput,
  type WaitlistInput,
  type WaitlistParticipant,
} from '../src';
import { G1, HOST, HOUR_MS, T0, U1, U2, U3, U4, iso } from './helpers';

const wl = (userId: string, rank: number | null, requestedHoursAgo = 10): WaitlistParticipant => ({
  userId,
  status: 'waitlisted',
  waitlistRank: rank,
  requestedAt: iso(T0 - requestedHoursAgo * HOUR_MS),
});
const approved = (userId: string): WaitlistParticipant => ({ userId, status: 'approved', waitlistRank: null, requestedAt: iso(T0 - 20 * HOUR_MS) });
const game = { id: G1, capacity: 2, status: 'scheduled' as const, startsAt: iso(T0) };

describe('waitlist modes and ordering (GAME-045)', () => {
  it('modes by lead time', () => {
    expect(waitlistMode(iso(T0), T0 - 6 * HOUR_MS - 1)).toBe('standard');
    expect(waitlistMode(iso(T0), T0 - 6 * HOUR_MS)).toBe('short');
    expect(waitlistMode(iso(T0), T0 - HOUR_MS)).toBe('short');
    expect(waitlistMode(iso(T0), T0 - HOUR_MS + 1)).toBe('flash');
    expect(waitlistMode(iso(T0), T0)).toBe('closed');
  });
  it('regulars first, then rank, request time, id', () => {
    const order = orderWaitlist([wl(U1, 2), wl(U2, 1), wl(U3, null, 5), wl(U4, null, 9), approved('x')], [U3]);
    expect(order.map((p) => p.userId)).toEqual([U3, U2, U1, U4]);
    expect(orderWaitlist([wl('b', 1), wl('a', 1)]).map((p) => p.userId)).toEqual(['a', 'b']);
    expect(nextWaitlistRank([wl(U1, 2), wl(U2, 5), approved('x')])).toBe(6);
    expect(nextWaitlistRank([])).toBe(1);
    expect(freeSpots(game, [approved('a'), approved('b'), approved('c')])).toBe(0);
    expect(decideJoinOutcome(1, 2)).toBe('approved');
    expect(decideJoinOutcome(2, 2)).toBe('waitlisted');
  });
});

describe('promoteFromWaitlist', () => {
  const base: WaitlistInput = { game, participants: [approved(HOST), wl(U1, 1), wl(U2, 2), wl(U3, 3)] };

  it('standard: offers the next player a 2h window (AC-GAME-045a)', () => {
    const now = T0 - 10 * HOUR_MS;
    const plan = promoteFromWaitlist(base, now);
    expect(plan).toMatchObject({ mode: 'standard', freeSpots: 1 });
    expect(plan.offers).toEqual([{ userId: U1, offeredAt: iso(now), acceptBy: iso(now + 2 * HOUR_MS), mode: 'standard' }]);
    expect(plan.effects).toEqual([
      { type: 'Notify', userId: U1, kind: 'waitlist_offer', params: { offer: 1, mode: 'standard', acceptBy: iso(now + 2 * HOUR_MS) }, gameId: G1, sanctionDedupeKey: null },
    ]);
    expect(promoteFromWaitlist({ ...base, offers: plan.offers }, now + HOUR_MS).offers).toEqual([]);
    const next = promoteFromWaitlist({ ...base, offers: plan.offers }, now + 2 * HOUR_MS);
    expect(next.offers.map((o) => o.userId)).toEqual([U2]);
  });

  it('offer windows come from TrustConfig', () => {
    const config = { ...DEFAULT_TRUST_CONFIG, waitlistLongThresholdHours: 12, waitlistConfirmShortMinutes: 45, waitlistFlashFillHours: 2 };
    const now = T0 - 10 * HOUR_MS;
    expect(promoteFromWaitlist(base, now, config).offers[0]).toMatchObject({ mode: 'short', acceptBy: iso(now + 45 * 60_000) });
    expect(promoteFromWaitlist(base, T0 - 90 * 60_000, config).mode).toBe('flash');
  });

  it('short window: 20 minutes, capped at the start', () => {
    const now = T0 - 3 * HOUR_MS;
    expect(promoteFromWaitlist(base, now).offers[0]).toMatchObject({ mode: 'short', acceptBy: iso(now + 20 * 60_000) });
  });

  it('flash fill: everyone notified at once, accept by the start (AC-GAME-045b)', () => {
    const now = T0 - 40 * 60_000;
    const plan = promoteFromWaitlist(base, now);
    expect(plan.mode).toBe('flash');
    expect(plan.offers.map((o) => [o.userId, o.acceptBy])).toEqual([
      [U1, iso(T0)],
      [U2, iso(T0)],
      [U3, iso(T0)],
    ]);
    expect(promoteFromWaitlist({ ...base, offers: plan.offers }, now + 60_000).offers).toEqual([]);
  });

  it('nothing to offer: full, closed, cancelled', () => {
    const full = { ...base, participants: [...base.participants, approved(U4)] };
    expect(promoteFromWaitlist(full, T0 - 10 * HOUR_MS).offers).toEqual([]);
    expect(promoteFromWaitlist(base, T0).mode).toBe('closed');
    expect(promoteFromWaitlist({ ...base, game: { ...game, status: 'cancelled' } }, T0 - HOUR_MS).mode).toBe('closed');
  });

  it('regulars get priority in the queue', () => {
    expect(promoteFromWaitlist({ ...base, regularIds: [U3] }, T0 - 10 * HOUR_MS).offers.map((o) => o.userId)).toEqual([U3]);
  });

  it('acceptWaitlistOffer: first to accept wins, others are told the spot was taken', () => {
    const now = T0 - 40 * 60_000;
    const plan = promoteFromWaitlist(base, now);
    const input = { ...base, offers: plan.offers };
    const ok = acceptWaitlistOffer(input, U2, now + 1000);
    expect(ok).toEqual({
      ok: true,
      value: [
        { type: 'PromoteWaitlist', gameId: G1, userId: U2 },
        { type: 'Notify', userId: U2, kind: 'waitlist_promoted', params: { mode: 'flash' }, gameId: G1, sanctionDedupeKey: null },
        { type: 'Notify', userId: U1, kind: 'join_waitlisted', params: { spotTaken: 1 }, gameId: G1, sanctionDedupeKey: null },
        { type: 'Notify', userId: U3, kind: 'join_waitlisted', params: { spotTaken: 1 }, gameId: G1, sanctionDedupeKey: null },
      ],
    });
    const after = { ...input, participants: [approved(HOST), wl(U1, 1), approved(U2), wl(U3, 3)] };
    expect(acceptWaitlistOffer(after, U1, now + 2000)).toEqual({ ok: false, error: 'game_full' });
    expect(acceptWaitlistOffer(input, U4, now)).toEqual({ ok: false, error: 'not_found' });
    expect(acceptWaitlistOffer(input, U1, T0)).toEqual({ ok: false, error: 'game_not_open' });
    const std = promoteFromWaitlist(base, T0 - 10 * HOUR_MS);
    expect(acceptWaitlistOffer({ ...base, offers: std.offers }, U1, T0 - 7 * HOUR_MS)).toEqual({ ok: false, error: 'outside_window' });
    const two = { ...base, game: { ...game, capacity: 3 } };
    const r = acceptWaitlistOffer({ ...two, offers: std.offers }, U1, T0 - 9 * HOUR_MS);
    expect(r.ok && r.value.length).toBe(2);
  });
});

describe('join eligibility', () => {
  const user: EligibilityUser = { id: U1, gender: 'female', permanentlyBanned: false, joinBannedUntil: null, visibilityRestrictedUntil: null };
  const input: JoinEligibilityInput = {
    game: { id: G1, hostId: HOST, status: 'scheduled', startsAt: iso(T0), capacity: 2, womenOnly: true, visibility: 'public', createdAt: iso(T0 - 72 * HOUR_MS) },
    user,
    existing: null,
    approvedUserIds: [HOST],
    blocks: [],
  };
  const now = T0 - HOUR_MS;
  const check = (patch: Partial<JoinEligibilityInput>, at = now) => checkJoinEligibility({ ...input, ...patch }, at);

  it('ok, with full flag', () => {
    expect(check({})).toEqual({ ok: true, value: { full: false } });
    expect(check({ approvedUserIds: [HOST, U2] })).toEqual({ ok: true, value: { full: true } });
  });
  it('error codes in order', () => {
    expect(check({ user: { ...user, permanentlyBanned: true } })).toEqual({ ok: false, error: 'account_banned' });
    expect(check({ user: { ...user, joinBannedUntil: iso(now + 1) } })).toEqual({ ok: false, error: 'join_banned' });
    expect(check({ user: { ...user, joinBannedUntil: iso(now) } }).ok).toBe(true);
    expect(check({ user: { ...user, visibilityRestrictedUntil: iso(now + 1) } })).toEqual({ ok: false, error: 'forbidden' });
    expect(check({ user: { ...user, visibilityRestrictedUntil: iso(now + 1) }, game: { ...input.game, visibility: 'private' } }).ok).toBe(true);
    expect(check({ user: { ...user, id: HOST } })).toEqual({ ok: false, error: 'forbidden' });
    expect(check({ existing: { status: 'removed' } })).toEqual({ ok: false, error: 'forbidden' });
    expect(check({ game: { ...input.game, status: 'cancelled' } })).toEqual({ ok: false, error: 'game_not_open' });
    expect(check({}, T0)).toEqual({ ok: false, error: 'game_not_open' });
    for (const status of ['requested', 'approved', 'waitlisted', 'rejected'] as const) {
      expect(check({ existing: { status } })).toEqual({ ok: false, error: 'conflict' });
    }
    expect(check({ existing: { status: 'cancelled' } }).ok).toBe(true);
    expect(check({ blocks: [{ blockerId: HOST, blockedId: U1 }] })).toEqual({ ok: false, error: 'blocked' });
    expect(check({ approvedUserIds: [HOST, U2], blocks: [{ blockerId: U1, blockedId: U2 }] })).toEqual({ ok: false, error: 'blocked' });
    expect(check({ blocks: [{ blockerId: U3, blockedId: U1 }] }).ok).toBe(true);
    expect(check({ user: { ...user, gender: 'male' } })).toEqual({ ok: false, error: 'women_only' });
  });
  it('regulars-only priority window (AC-GAME-010)', () => {
    const series = { game: { ...input.game, createdAt: iso(now - 10 * HOUR_MS) }, regularIds: [U2] };
    expect(check(series)).toEqual({ ok: false, error: 'game_not_open' });
    expect(check({ ...series, regularIds: [U1] }).ok).toBe(true);
    expect(check({ ...series, game: { ...series.game, createdAt: iso(now - 24 * HOUR_MS) } }).ok).toBe(true);
    expect(regularsPriorityUntil(input.game)).toBeNull();
    expect(regularsPriorityUntil(input.game, [])).toBeNull();
  });
  it('create eligibility (TRUST-026/043)', () => {
    const pub = { visibility: 'public' as const, womenOnly: false };
    expect(checkCreateGameEligibility(user, pub, now)).toEqual({ ok: true, value: true });
    expect(checkCreateGameEligibility({ ...user, permanentlyBanned: true }, pub, now)).toMatchObject({ error: 'account_banned' });
    expect(checkCreateGameEligibility({ ...user, hostSuspendedUntil: iso(now + 1) }, pub, now)).toMatchObject({ error: 'host_suspended' });
    expect(checkCreateGameEligibility({ ...user, joinBannedUntil: iso(now + 1) }, pub, now)).toMatchObject({ error: 'join_banned' });
    expect(checkCreateGameEligibility({ ...user, joinBannedUntil: iso(now + 1) }, { ...pub, visibility: 'private' }, now).ok).toBe(true);
    expect(checkCreateGameEligibility({ ...user, visibilityRestrictedUntil: iso(now + 1) }, pub, now)).toMatchObject({ error: 'forbidden' });
    expect(checkCreateGameEligibility({ ...user, gender: 'male' }, { ...pub, womenOnly: true }, now)).toMatchObject({ error: 'women_only' });
  });
});
