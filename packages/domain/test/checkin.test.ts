import { createHmac } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  detectSpoofSignals,
  generateQrToken,
  offsetMeters,
  qrMac,
  qrStep,
  resolveTrustConfig,
  verifyGps,
  verifyHost,
  verifyPeer,
  verifyQr,
  qualifyingPeerConfirmers,
  type GpsSample,
  type LatLng,
  type PeerParticipant,
} from '../src';

const venue: LatLng = { lat: 32.0853, lng: 34.7818 };
const window = { startsAt: '2026-03-01T18:00:00.000Z', endsAt: '2026-03-01T19:30:00.000Z' };
const NOW = Date.parse('2026-03-01T17:50:00.000Z');

function sample(north: number, east: number, dtSec: number, acc = 10, extra: Partial<GpsSample> = {}): GpsSample {
  const p = offsetMeters(venue, north, east);
  return { lat: p.lat, lng: p.lng, accuracyM: acc, timestamp: NOW - 30_000 + dtSec * 1000, ...extra };
}
const good = [sample(20, 10, 0), sample(22, 12, 6), sample(19, 9, 12)];

describe('verifyGps', () => {
  it('verifies 3 accurate, spaced, close samples (AC-TRUST-005a)', () => {
    const v = verifyGps(good, venue, window, NOW);
    expect(v).toMatchObject({ outcome: 'verified', method: 'gps', signals: [] });
    if (v.outcome === 'verified') expect(v.distanceM).toBeGreaterThan(19);
  });

  it('rejects outside the window with no fallbacks', () => {
    expect(verifyGps(good, venue, window, Date.parse('2026-03-01T17:29:59.999Z'))).toMatchObject({ reason: 'outside_window', fallbacks: [] });
    expect(verifyGps(good, venue, window, Date.parse('2026-03-01T19:30:00.001Z'))).toMatchObject({ reason: 'outside_window' });
  });

  it('weak GPS offers fallbacks, never a sanction (AC-TRUST-005b)', () => {
    const weak = good.map((s) => ({ ...s, accuracyM: 60 }));
    expect(verifyGps(weak, venue, window, NOW)).toEqual({
      outcome: 'rejected',
      method: 'gps',
      reason: 'low_accuracy',
      fallbacks: ['gps', 'qr', 'peer', 'host'],
      signals: [],
    });
    expect(verifyGps([good[0]!, { ...good[1]!, accuracyM: 25.01 }], venue, window, NOW)).toMatchObject({ reason: 'low_accuracy' });
    expect(verifyGps([good[0]!, { ...good[1]!, accuracyM: 25 }], venue, window, NOW).outcome).toBe('verified');
  });

  it('insufficient samples, spacing and sample window', () => {
    expect(verifyGps([good[0]!], venue, window, NOW)).toMatchObject({ reason: 'insufficient_samples' });
    expect(verifyGps([sample(20, 10, 0), sample(20, 11, 4.999)], venue, window, NOW)).toMatchObject({ reason: 'samples_too_close' });
    expect(verifyGps([sample(20, 10, 0), sample(20, 11, 5)], venue, window, NOW).outcome).toBe('verified');
    expect(verifyGps([sample(20, 10, -40), sample(20, 11, 20.001)], venue, window, NOW)).toMatchObject({ reason: 'insufficient_samples' });
    expect(verifyGps([sample(20, 10, -40), sample(20, 11, 20)], venue, window, NOW).outcome).toBe('verified');
  });

  it('picks a valid chain among oversampled fixes', () => {
    const burst = Array.from({ length: 10 }, (_, i) => sample(20, 10 + i * 0.1, i));
    expect(verifyGps(burst, venue, window, NOW).outcome).toBe('verified');
  });

  it('distance ≤ base radius + accuracy', () => {
    expect(verifyGps([sample(59, 0, 0, 10), sample(59, 0.5, 6, 10)], venue, window, NOW).outcome).toBe('verified');
    expect(verifyGps([sample(61, 0, 0, 10), sample(61, 0.5, 6, 10)], venue, window, NOW)).toMatchObject({ reason: 'too_far' });
  });

  it('spread must stay below 30 m', () => {
    expect(verifyGps([sample(0, -15, 0, 5), sample(0, 15.5, 6, 5)], venue, window, NOW)).toMatchObject({ reason: 'spread_too_large' });
    expect(verifyGps([sample(0, -14, 0, 5), sample(0, 14, 6, 5)], venue, window, NOW).outcome).toBe('verified');
  });

  it('spoofing signals route to QR/peer/host and are reported', () => {
    const mock = verifyGps([good[0]!, { ...good[1]!, isMock: true }], venue, window, NOW);
    expect(mock).toEqual({
      outcome: 'rejected',
      method: 'gps',
      reason: 'suspected_spoofing',
      fallbacks: ['qr', 'peer', 'host'],
      signals: ['mock_location'],
    });
    const teleport = [sample(0, 0, 0), { ...sample(0, 0, 5), ...offsetMeters(venue, 10_000, 0) }];
    expect(verifyGps(teleport, venue, window, NOW)).toMatchObject({ reason: 'suspected_spoofing', signals: ['impossible_speed'] });
    const far: GpsSample = { ...offsetMeters(venue, 0, 100_000), accuracyM: 10, timestamp: NOW - 120_000 };
    expect(verifyGps(good, venue, window, NOW, far)).toMatchObject({ signals: ['impossible_speed'] });
    expect(verifyGps(good, venue, window, NOW, { ...good[0]!, timestamp: NOW - 3_600_000 })).toMatchObject({ outcome: 'verified' });
    expect(verifyGps(good, venue, window, NOW, { ...good[0]!, isMock: true, timestamp: NOW - 3_600_000 })).toMatchObject({
      signals: ['mock_location'],
    });
    const future = good.map((s) => ({ ...s, timestamp: s.timestamp + 300_000 }));
    expect(verifyGps(future, venue, window, NOW)).toMatchObject({ signals: ['clock_skew'] });
    const stale = good.map((s) => ({ ...s, timestamp: s.timestamp - 600_000 }));
    expect(verifyGps(stale, venue, window, NOW)).toMatchObject({ signals: ['clock_skew'] });
    const synthetic = [sample(10, 10, 0, 1), sample(10, 10, 6, 1)];
    expect(verifyGps(synthetic, venue, window, NOW)).toMatchObject({ signals: ['inconsistent_spread'] });
    expect(detectSpoofSignals([], NOW)).toEqual([]);
  });

  it('accurate jitter does not look like impossible speed', () => {
    const jitter = [sample(0, 0, 0, 20), sample(0, 35, 0.4, 20)];
    expect(detectSpoofSignals(jitter, NOW)).toEqual([]);
  });

  it('property: translating samples and venue together does not change the verdict', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500_000, max: 500_000, noNaN: true }),
        fc.double({ min: -500_000, max: 500_000, noNaN: true }),
        fc.array(fc.record({ n: fc.double({ min: -80, max: 80, noNaN: true }), e: fc.double({ min: -80, max: 80, noNaN: true }), acc: fc.double({ min: 1.5, max: 40, noNaN: true }) }), { minLength: 1, maxLength: 4 }),
        (dn, de, pts) => {
          const v2 = offsetMeters(venue, dn, de);
          const a = pts.map((p, i) => ({ ...offsetMeters(venue, p.n, p.e), accuracyM: p.acc, timestamp: NOW - 30_000 + i * 6000 }));
          const b = pts.map((p, i) => ({ ...offsetMeters(v2, p.n, p.e), accuracyM: p.acc, timestamp: NOW - 30_000 + i * 6000 }));
          const va = verifyGps(a, venue, window, NOW);
          const vb = verifyGps(b, v2, window, NOW);
          // Boundary cases may flip by float error; compare only when not near a threshold.
          const near = pts.some((p) => Math.abs(Math.hypot(p.n, p.e) - 50 - p.acc) < 0.5);
          if (!near) expect(vb.outcome).toBe(va.outcome);
        },
      ),
    );
  });

  it('property: moving the venue farther never turns too_far into verified; mock never verifies', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 200, noNaN: true }), fc.double({ min: 0, max: 200, noNaN: true }), fc.boolean(), (d1, d2, mock) => {
        const [near, farther] = d1 < d2 ? [d1, d2] : [d2, d1];
        const s = (d: number) => [sample(d, 0, 0, 10), sample(d, 1, 6, 10, mock ? { isMock: true } : {})];
        const vNear = verifyGps(s(near), venue, window, NOW);
        const vFar = verifyGps(s(farther), venue, window, NOW);
        if (vNear.outcome === 'rejected') expect(vFar.outcome).toBe('rejected');
        if (mock) expect(vNear.outcome).toBe('rejected');
      }),
    );
  });

  it('respects config overrides', () => {
    const cfg = resolveTrustConfig({ gpsMinSamples: 3 });
    expect(verifyGps(good.slice(0, 2), venue, window, NOW, null, cfg)).toMatchObject({ reason: 'insufficient_samples' });
  });
});

describe('QR tokens', () => {
  const secret = 'qr-secret-1';
  const gameId = '00000000-0000-4000-8000-0000000000aa';
  const now = Date.parse('2026-03-01T18:00:10.000Z');

  it('matches the documented wire format (HMAC over `${gameId}|${step}`, 128-bit)', () => {
    const t = generateQrToken(secret, gameId, now);
    const step = Math.floor(now / 30_000);
    expect(t.step).toBe(step);
    expect(t.token).toBe(`${step}.${createHmac('sha256', secret).update(`${gameId}|${step}`).digest('hex').slice(0, 32)}`);
    expect(t.expiresAt).toBe(new Date((step + 1) * 30_000).toISOString());
    expect(qrStep(now)).toBe(step);
  });

  it('accepts current ±1 step only', () => {
    const t = generateQrToken(secret, gameId, now);
    for (const d of [-1, 0, 1]) expect(verifyQr(t.token, secret, gameId, now + d * 30_000).outcome).toBe('verified');
    for (const d of [-2, 2, 6]) expect(verifyQr(t.token, secret, gameId, now + d * 30_000)).toMatchObject({ reason: 'expired_qr' });
  });

  it('rejects forged, malformed and other-game tokens', () => {
    const t = generateQrToken(secret, gameId, now);
    expect(verifyQr(t.token, 'other', gameId, now)).toMatchObject({ reason: 'invalid_qr', fallbacks: ['qr', 'peer', 'host'] });
    expect(verifyQr(t.token, secret, 'g2', now)).toMatchObject({ reason: 'invalid_qr' });
    expect(verifyQr('garbage', secret, gameId, now)).toMatchObject({ reason: 'invalid_qr' });
    expect(verifyQr(`${t.step}.${'0'.repeat(32)}`, secret, gameId, now)).toMatchObject({ reason: 'invalid_qr' });
    expect(verifyQr(` ${t.token} `, secret, gameId, now).outcome).toBe('verified');
  });

  it('honours the check-in window when given', () => {
    const t = generateQrToken(secret, gameId, now);
    const w = { startsAt: '2026-03-01T19:00:00.000Z', endsAt: '2026-03-01T20:00:00.000Z' };
    expect(verifyQr(t.token, secret, gameId, now, undefined, w)).toMatchObject({ reason: 'outside_window', fallbacks: [] });
    expect(verifyQr(t.token, secret, gameId, now, undefined, { startsAt: '2026-03-01T18:00:00.000Z', endsAt: w.endsAt }).outcome).toBe('verified');
  });

  it('property: any single-character change of secret or gameId invalidates', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), fc.nat(), fc.integer({ min: 0, max: 0xffff }), (s, pos, cp) => {
        const t = generateQrToken(s, gameId, now);
        const i = pos % s.length;
        const changed = s.slice(0, i) + String.fromCharCode(cp) + s.slice(i + 1);
        fc.pre(changed !== s);
        expect(verifyQr(t.token, changed, gameId, now).outcome).toBe('rejected');
        const gid = gameId.slice(0, 5) + (gameId[5] === 'a' ? 'b' : 'a') + gameId.slice(6);
        expect(verifyQr(t.token, s, gid, now).outcome).toBe('rejected');
      }),
    );
    expect(qrMac('k', 'g', 1)).toHaveLength(32);
  });
});

describe('verifyHost', () => {
  const game = { hostId: 'h', startsAt: '2026-03-01T18:00:00.000Z', endsAt: '2026-03-01T19:30:00.000Z', status: 'scheduled' as const };
  const target = { userId: 'p', status: 'approved' as const, attendance: 'unknown' as const };
  const at = Date.parse('2026-03-01T18:30:00.000Z');
  it('verifies an approved player marked by the host, until endsAt + 2h', () => {
    expect(verifyHost({ actorId: 'h', game, target }, at)).toEqual({ outcome: 'verified', method: 'host', distanceM: null, signals: [] });
    expect(verifyHost({ actorId: 'h', game, target }, Date.parse('2026-03-01T21:30:00.000Z')).outcome).toBe('verified');
    expect(verifyHost({ actorId: 'h', game, target }, Date.parse('2026-03-01T21:30:00.001Z'))).toMatchObject({ reason: 'outside_window' });
    expect(verifyHost({ actorId: 'h', game, target }, Date.parse('2026-03-01T17:29:00.000Z'))).toMatchObject({ reason: 'outside_window' });
  });
  it('rejections', () => {
    expect(verifyHost({ actorId: 'x', game, target }, at)).toMatchObject({ reason: 'not_host' });
    expect(verifyHost({ actorId: 'h', game, target: { ...target, userId: 'h' } }, at)).toMatchObject({ reason: 'not_host' });
    expect(verifyHost({ actorId: 'h', game: { ...game, status: 'cancelled' }, target }, at)).toMatchObject({ reason: 'outside_window' });
    expect(verifyHost({ actorId: 'h', game, target: null }, at)).toMatchObject({ reason: 'not_participant' });
    expect(verifyHost({ actorId: 'h', game, target: { ...target, status: 'waitlisted' } }, at)).toMatchObject({ reason: 'not_participant' });
    expect(verifyHost({ actorId: 'h', game, target: { ...target, attendance: 'verified' } }, at)).toMatchObject({ reason: 'already_checked_in' });
  });
});

describe('verifyPeer', () => {
  const P = (userId: string, method: PeerParticipant['checkInMethod'], attendance: PeerParticipant['attendance'] = 'verified'): PeerParticipant => ({
    userId,
    status: 'approved',
    attendance,
    checkInMethod: method,
  });
  const base = {
    targetUserId: 't',
    participants: [P('t', null, 'unknown'), P('a', 'gps'), P('b', 'qr'), P('c', 'peer'), P('d', 'host'), P('e', 'gps', 'unknown')],
    confirmations: [] as { confirmerId: string; targetId: string }[],
    blocks: [] as { blockerId: string; blockedId: string }[],
  };
  const now = Date.parse('2026-03-01T18:30:00.000Z');

  it('verifies with two GPS/QR-verified confirmers', () => {
    const r = verifyPeer({ ...base, confirmations: [{ confirmerId: 'a', targetId: 't' }, { confirmerId: 'b', targetId: 't' }] }, now);
    expect(r).toEqual({ confirmations: 2, verdict: { outcome: 'verified', method: 'peer', distanceM: null, signals: [] } });
  });

  it('ignores self, unverified, host-marked and duplicate confirmations', () => {
    const r = verifyPeer(
      {
        ...base,
        confirmations: [
          { confirmerId: 'a', targetId: 't' },
          { confirmerId: 'a', targetId: 't' },
          { confirmerId: 't', targetId: 't' },
          { confirmerId: 'd', targetId: 't' },
          { confirmerId: 'e', targetId: 't' },
          { confirmerId: 'zz', targetId: 't' },
        ],
      },
      now,
    );
    expect(r).toMatchObject({ confirmations: 1, verdict: { reason: 'insufficient_peers', fallbacks: ['qr', 'host'] } });
  });

  it('reciprocal-only and blocked pairs', () => {
    const recip = verifyPeer(
      {
        ...base,
        confirmations: [
          { confirmerId: 'a', targetId: 't' },
          { confirmerId: 'c', targetId: 't' },
          { confirmerId: 't', targetId: 'c' },
        ],
      },
      now,
    );
    expect(recip.verdict).toMatchObject({ reason: 'reciprocal_only' });
    const blocked = verifyPeer(
      { ...base, confirmations: [{ confirmerId: 'a', targetId: 't' }, { confirmerId: 'b', targetId: 't' }], blocks: [{ blockerId: 'b', blockedId: 't' }] },
      now,
    );
    expect(blocked).toMatchObject({ confirmations: 1, verdict: { reason: 'blocked_pair' } });
    const blocked2 = qualifyingPeerConfirmers({ ...base, confirmations: [{ confirmerId: 'a', targetId: 't' }], blocks: [{ blockerId: 't', blockedId: 'a' }] });
    expect(blocked2).toEqual({ qualifying: [], excludedReciprocal: [], excludedBlocked: ['a'] });
  });

  it('caps confirmations per confirmer at 6', () => {
    const many = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'].map((x) => ({ confirmerId: 'a', targetId: x }));
    const r = verifyPeer({ ...base, confirmations: [...many, { confirmerId: 'a', targetId: 't' }, { confirmerId: 'b', targetId: 't' }] }, now);
    expect(r.confirmations).toBe(1);
  });

  it('target and window checks', () => {
    const conf = [{ confirmerId: 'a', targetId: 't' }, { confirmerId: 'b', targetId: 't' }];
    expect(verifyPeer({ ...base, confirmations: conf, targetUserId: 'nobody' }, now).verdict).toMatchObject({ reason: 'not_participant', fallbacks: [] });
    expect(verifyPeer({ ...base, confirmations: conf, targetUserId: 'a' }, now).verdict).toMatchObject({ reason: 'already_checked_in' });
    const w = { startsAt: '2026-03-01T20:00:00.000Z', endsAt: '2026-03-01T21:00:00.000Z' };
    expect(verifyPeer({ ...base, confirmations: conf, window: w }, now).verdict).toMatchObject({ reason: 'outside_window' });
  });
});
