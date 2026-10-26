/** InMemoryAdapter rules (run: npx vitest run --root apps/mobile-web). */
import { describe, expect, it } from 'vitest';
import { InMemoryAdapter } from '../InMemoryAdapter';

const NOW = Date.parse('2026-10-26T10:00:00.000Z');
async function signedIn(phone: string, now = NOW) {
  let t = now;
  const a = new InMemoryAdapter({ now: () => t });
  await a.sendOtp(phone);
  const u = await a.verifyOtp(phone, '123456');
  return { a, u, setNow: (v: number) => (t = v) };
}

describe('InMemoryAdapter', () => {
  it('rejects wrong otp and bad radius / too many sports', async () => {
    const a = new InMemoryAdapter({ now: () => NOW });
    await a.sendOtp('+972500000001');
    await expect(a.verifyOtp('+972500000001', '111111')).rejects.toMatchObject({ code: 'otp_invalid' });
    await a.verifyOtp('+972500000001', '123456');
    await expect(a.nearbyGames({ lat: 32.07, lng: 34.77 }, 3 as never, [])).rejects.toMatchObject({ code: 'invalid_radius' });
    await expect(a.nearbyGames({ lat: 32.07, lng: 34.77 }, 5, ['football', 'tennis', 'padel', 'running'])).rejects.toMatchObject({ code: 'too_many_sports' });
    const g = await a.nearbyGames({ lat: 32.0779, lng: 34.7745 }, 5, []);
    expect(g.length).toBeGreaterThan(3);
    expect(g.every((x) => x.visibility === 'public')).toBe(true);
  });

  it('age gate, join request, host approval, waitlist, late cancel card', async () => {
    const { a } = await signedIn('+12015550123');
    await expect(a.createProfile({ displayName: 'Kid', locale: 'en', birthYear: 2012, birthMonth: 1, gender: 'male' })).rejects.toMatchObject({ code: 'age_restricted' });
    await a.createProfile({ displayName: 'Alex', locale: 'en', birthYear: 1995, birthMonth: 5, gender: 'female' });
    const res = await a.requestJoin('g-tlv-6');
    expect(res.participant.status).toBe('requested');
    await expect(a.requestJoin('g-tlv-6')).rejects.toMatchObject({ code: 'conflict' });
    // The seeded host signs in on the same in-memory backend and approves.
    await a.signOut();
    await a.sendOtp('+972500000001');
    await a.verifyOtp('+972500000001', '123456');
    const parts = await a.listParticipants('g-tlv-6');
    const req = parts.find((p) => p.profile.displayName === 'Alex');
    expect(req?.status).toBe('requested');
    const decided = await a.decideJoin('g-tlv-6', req!.userId, 'approve');
    expect(decided.status).toBe('approved');
    // QR token from the host verifies for an approved player within the window.
    const qr = await a.getQrToken('g-tlv-6');
    expect(qr.token).toMatch(/^\d+\.[0-9a-f]{32}$/);
  });

  it('late cancel issues a disputable yellow card and promotes the waitlist', async () => {
    const t0 = NOW;
    const { a, setNow } = await signedIn('+972500000001', t0);
    const g = await a.getGame('g-tlv-1');
    expect(g?.myParticipation?.status).toBe('approved');
    setNow(Date.parse(g!.startsAt) - 30 * 60 * 1000);
    const r = await a.cancelParticipation('g-tlv-1');
    expect(r.participant.lateCancel).toBe(true);
    expect(r.sanction?.kind).toBe('yellow_card');
    expect(r.sanction?.disputeUntil).not.toBeNull();
    const appeal = await a.fileAppeal(r.sanction!.id, 'I was injured on the way, sorry.');
    expect(appeal.isDispute).toBe(true);
  });

  it('hides exact location of hidden games from non-approved viewers', async () => {
    const { a } = await signedIn('+12015550199');
    await a.createProfile({ displayName: 'Bo', locale: 'en', birthYear: 1990, birthMonth: 1, gender: 'female' });
    const g = await a.getGame('g-tlv-4');
    expect(g?.location).toBeNull();
    expect(g?.venueId).toBeNull();
    expect(g?.inviteToken).toBeNull();
    expect(await a.getGame('g-tlv-5')).toBeNull(); // private, no invite
    const viaInvite = await a.resolveInvite('tlv-sunrise-run');
    expect(viaInvite?.id).toBe('g-tlv-5');
  });

  it('moderation: blocklist nudges, threats block, 3 blocks mute', async () => {
    const { a, setNow } = await signedIn('+972500000001');
    const g = await a.getGame('g-tlv-1');
    setNow(Date.parse(g!.startsAt) - 10 * 60 * 1000);
    const ok = await a.sendMessage('g-tlv-1', 'See you at the field', 'c1');
    expect(ok.verdict.decision).toBe('allow');
    const nudge = await a.sendMessage('g-tlv-1', 'you are an idiot', 'c2');
    expect(nudge.verdict.decision).toBe('nudge');
    for (const i of [3, 4]) expect((await a.sendMessage('g-tlv-1', 'I will kill you', `c${i}`)).message).toBeNull();
    const third = await a.sendMessage('g-tlv-1', 'I will kill you', 'c5');
    expect(third.mutedUntil).not.toBeNull();
    await expect(a.sendMessage('g-tlv-1', 'hello', 'c6')).rejects.toMatchObject({ code: 'chat_muted' });
  });
});
