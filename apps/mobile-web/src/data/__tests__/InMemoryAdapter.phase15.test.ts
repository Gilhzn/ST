/** InMemoryAdapter Phase 1.5 (contract v3): series, ratings, Media Vault, network, invites. */
import { describe, expect, it } from 'vitest';

import { InMemoryAdapter } from '../InMemoryAdapter';
import { listMyRatingHistory, reportMedia, uploadPickedMedia } from '../extensions';

const NOW = Date.parse('2026-10-26T10:00:00.000Z');
const DANA = '+972500000001';
const YOSSI = '+972500000002';

async function as(phone: string, now = NOW) {
  let t = now;
  const a = new InMemoryAdapter({ now: () => t });
  await a.sendOtp(phone);
  await a.verifyOtp(phone, '123456');
  return { a, setNow: (v: number) => (t = v) };
}

async function switchTo(a: InMemoryAdapter, phone: string) {
  await a.signOut();
  await a.sendOtp(phone);
  await a.verifyOtp(phone, '123456');
}

describe('series (GAME-010/011)', () => {
  it('seeds the Tel Aviv weekly series with a roster, past weeks and generated occurrences', async () => {
    const { a } = await as(DANA);
    const mine = await a.listMySeries();
    expect(mine.map((s) => s.id).sort()).toEqual(['s-lon-5s', 's-tlv-weekly']);
    const d = await a.getSeries('s-tlv-weekly');
    expect(d?.isHost).toBe(true);
    expect(d?.rosterCount).toBe(13);
    expect(d?.series.inviteToken).toBe('tlv-weekly-football-regulars');
    expect(d?.upcoming.length).toBeGreaterThanOrEqual(4);
    const next = d!.upcoming[0]!;
    const game = await a.getGame(next.gameId);
    expect(game?.seriesId).toBe('s-tlv-weekly');
    // Host + 6 "always in" regulars auto-joined + 3 who joined by hand.
    expect(game?.approvedCount).toBe(10);
    const stats = await a.getMigrationStats({ kind: 'series', seriesId: 's-tlv-weekly' });
    expect(stats.joinedFromLink).toBe(12);
    expect(stats.activeFromLink).toBeGreaterThan(8);
  });

  it('creates a weekly series, skips a date, edits and ends it', async () => {
    const { a } = await as(DANA);
    const created = await a.createSeries({
      sport: 'football',
      title: 'Tuesday Futsal',
      visibility: 'public',
      venueId: 'v-tlv-jaffa',
      hideExactLocation: false,
      capacity: 10,
      depositMinor: 0,
      currency: 'ILS',
      womenOnly: false,
      teamCount: 2,
      recurrence: 'weekly',
      weekday: 2,
      startTime: '19:30',
      timeZone: 'Asia/Jerusalem',
      durationMinutes: 90,
      startDate: '2026-10-26',
      rosterPriorityHours: 12,
    });
    expect(created.upcoming.length).toBe(4);
    expect(created.series.rosterPriorityHours).toBe(12);
    await expect(a.createSeries({ ...created.series, startDate: '2026-10-26', rosterPriorityHours: 100 } as never)).rejects.toMatchObject({ code: 'validation' });
    const key = created.upcoming[1]!.occurrenceKey;
    const skipped = await a.skipOccurrence(created.series.id, key);
    expect(skipped.status).toBe('skipped');
    const after = await a.getSeries(created.series.id);
    expect(after?.upcoming.find((o) => o.occurrenceKey === key)?.status).toBe('skipped');
    const edited = await a.editSeries(created.series.id, { scope: 'following', occurrenceKey: created.upcoming[0]!.occurrenceKey, patch: { capacity: 12 } });
    expect(edited.series.capacity).toBe(12);
    const ended = await a.endSeries(created.series.id);
    expect(ended.status).toBe('ended');
  });

  it('keeps non-regulars out during the priority window, then lets an invited player in', async () => {
    const { a } = await as(DANA);
    const lon = await a.getSeries('s-lon-5s');
    expect(lon?.myRoster?.status).toBe('invited');
    const first = lon!.upcoming[0]!;
    expect(Date.parse(first.priorityUntil)).toBeGreaterThan(NOW);
    await expect(a.requestJoin(first.gameId)).rejects.toMatchObject({ code: 'roster_priority' });
    const accepted = await a.acceptRosterInvite('s-lon-5s');
    expect(accepted.status).toBe('regular');
    const res = await a.requestJoin(first.gameId);
    expect(res.participant.status).toBe('requested');
    const always = await a.setAlwaysIn('s-lon-5s', true);
    expect(always.alwaysIn).toBe(true);
  });

  it('joins the regulars through the invite link and shares a localised message', async () => {
    const { a } = await as('+12015550777');
    await a.createProfile({ displayName: 'Rae', locale: 'en', birthYear: 1993, birthMonth: 3, gender: 'female' });
    const d = await a.resolveSeriesInvite('tlv-weekly-football-regulars');
    expect(d?.series.title).toMatch(/Night Football/);
    const m = await a.joinSeriesViaInvite('tlv-weekly-football-regulars');
    expect(m).toMatchObject({ status: 'regular', joinedVia: 'invite_link' });
    await expect(a.joinSeriesViaInvite('tlv-weekly-football-regulars')).rejects.toMatchObject({ code: 'conflict' });
    await switchTo(a, DANA);
    const msg = await a.getShareMessage({ kind: 'series', seriesId: 's-tlv-weekly' }, 'he');
    expect(msg.key).toBe('invite:share.series.weekly');
    expect(msg.locale).toBe('he');
    expect(msg.params.hasDate).toBe('yes');
    const stats = await a.getMigrationStats({ kind: 'series', seriesId: 's-tlv-weekly' });
    expect(stats.joinedFromLink).toBe(13);
  });
});

describe('ratings (GAME-071, RATE-*, GLK-*)', () => {
  it('shows Dana a 3.4 football level with history and a provisional basketball level', async () => {
    const { a } = await as(DANA);
    const ratings = await a.listMySkillRatings();
    const football = ratings.find((r) => r.sport === 'football');
    expect(football?.level).toBe(3.4);
    expect(football?.provisional).toBe(false);
    expect(ratings.find((r) => r.sport === 'basketball')?.provisional).toBe(true);
    expect((await listMyRatingHistory(a, 'football')).length).toBe(9);
    expect((await a.getMyPeerSummary('football'))?.raterCount).toBeGreaterThan(3);
  });

  it('gates Dana (active sanction) and lets Yossi confirm the score and rate co-players', async () => {
    const { a } = await as(DANA);
    const dana = await a.getRatingEligibility('g-tlv-wk-1');
    expect(dana.canRate).toBe(false);
    expect(dana.reasons).toContain('active_sanction');
    expect(await a.getGameRatingStatus('g-tlv-wk-2')).toEqual({ eligible: true, reason: null });
    await switchTo(a, YOSSI);
    const e = await a.getRatingEligibility('g-tlv-wk-1');
    expect(e.canRate).toBe(true);
    expect(e.remainingRatees).toBe(5);
    const before = await a.getResultConfirmation('g-tlv-wk-1');
    expect(before?.myVerdict).toBeNull();
    const after = await a.confirmResult('g-tlv-wk-1', 'confirm');
    expect(after.confirms).toBe((before?.confirms ?? 0) + 1);
    const [first, second] = e.rateableUserIds;
    const rows = await a.submitPeerRatings('g-tlv-wk-1', [
      { rateeId: first!, scores: { speed: 4, passing: 5, overall: 4 } },
      { rateeId: second!, scores: { overall: 3 } },
    ]);
    expect(rows).toHaveLength(2);
    expect((await a.getRatingEligibility('g-tlv-wk-1')).remainingRatees).toBe(3);
    await expect(a.submitPeerRatings('g-tlv-wk-1', [{ rateeId: first!, scores: { overall: 4 } }])).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('marks a game with too few verified players as not rated', async () => {
    const { a } = await as(DANA);
    expect((await a.getGameRatingStatus('g-tlv-9')).reason).toBe('no_result');
    await a.submitResult('g-tlv-9', [3, 2]);
    expect(await a.getGameRatingStatus('g-tlv-9')).toEqual({ eligible: false, reason: 'too_few_verified' });
    const bands = await a.getSkillBands('g-tlv-9');
    expect(Object.keys(bands).length).toBeGreaterThan(3);
  });
});

describe('Media Vault (VAULT-*)', () => {
  it('lists the gallery, uploads, tags and keeps the item private until every tag is accepted', async () => {
    const { a } = await as(DANA);
    const items = await a.listGameMedia('g-tlv-9');
    expect(items.length).toBe(6);
    const id = await uploadPickedMedia(a, 'g-tlv-9', { uri: 'data:image/jpeg;base64,AAAA', mimeType: 'image/jpeg', sizeBytes: 1200, kind: 'photo', durationSeconds: null });
    const tags = await a.tagMedia(id, ['u-tlv-0']);
    expect(tags[0]?.status).toBe('requested');
    const opted = await a.setMediaVisibility(id, 'venue_public');
    expect(opted.visibility).toBe('participants');
    expect(opted.publicOptIn).toBe(true);
    await switchTo(a, YOSSI);
    expect((await a.listMyTagRequests()).some((t) => t.mediaId === id)).toBe(true);
    await a.respondToMediaTag(id, true);
    const vault = await a.listVenueMedia('v-tlv-clore');
    expect(vault.some((m) => m.id === id)).toBe(true);
    await reportMedia(a, id, 'privacy');
    await expect(reportMedia(a, id, 'privacy')).rejects.toMatchObject({ code: 'already_reported' });
  });

  it('refuses uploads after the window and from non-attendees', async () => {
    const { a } = await as(DANA);
    await expect(a.createMediaUploadIntent({ gameId: 'g-tlv-wk-1', kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 100 })).rejects.toMatchObject({ code: 'outside_window' });
    await expect(a.createMediaUploadIntent({ gameId: 'g-tlv-1', kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 100 })).rejects.toMatchObject({ code: 'forbidden' });
    const requests = await a.listMyTagRequests();
    expect(requests.map((t) => t.mediaId).sort()).toEqual(['m-tlv9-1', 'm-wk1-1']);
    const yarkon = await a.listVenueMedia('v-tlv-yarkon');
    expect(yarkon.length).toBeGreaterThanOrEqual(4);
  });
});

describe('network', () => {
  it('lists played-with, friends and requests, and only allows requests to co-players', async () => {
    const { a } = await as(DANA);
    const all = await a.listConnections('all');
    expect(all.find((c) => c.user.id === 'u-tlv-0')?.friend).toBe('friends');
    expect((await a.listConnections('requests')).map((c) => c.friend)).toEqual(['incoming']);
    expect(all.find((c) => c.user.id === 'u-tlv-4')?.friend).toBe('outgoing');
    const playedWith = await a.listConnections('played_with');
    expect(playedWith.some((c) => c.user.id === 'u-lon-0')).toBe(true);
    const target = playedWith.find((c) => c.friend === 'none')!;
    expect((await a.requestFriend(target.user.id)).friend).toBe('outgoing');
    await expect(a.requestFriend('u-nyc-0')).rejects.toMatchObject({ code: 'forbidden' });
    expect((await a.respondFriendRequest('u-tlv-3', true)).friend).toBe('friends');
    const games = await a.listFriendsUpcomingGames();
    expect(games.length).toBeGreaterThan(0);
    await a.setNetworkPrivacy('nobody');
    expect((await a.getNetworkPrivacy()).upcomingGamesVisibleTo).toBe('nobody');
    await a.blockUser('u-tlv-1');
    expect((await a.listConnections('friends')).some((c) => c.user.id === 'u-tlv-1')).toBe(false);
  });
});
