import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOMAIN_CONFIG,
  acceptRosterInvite,
  buildOccurrence,
  buildSeries,
  checkJoinEligibility,
  checkOccurrenceJoinWindow,
  deriveOccurrenceGameId,
  editSeries,
  endSeries,
  isSeriesSlot,
  joinRoster,
  leaveRoster,
  occurrenceJoinPhase,
  occurrenceKey,
  parseOccurrenceKey,
  planSeriesOccurrences,
  processAutoJoins,
  reconfirmAutoJoin,
  resolveDomainConfig,
  setAlwaysIn,
  skipOccurrence,
  slotDatesBetween,
  validateSeriesCreate,
  type AutoJoinRecord,
  type GameSeries,
  type GameSeriesCreateInput,
  type Phase15Effect,
  type RosterMember,
  type SeriesChangeInput,
  type SeriesOccurrence,
} from '../src';
import { DAY_MS, HOST, HOUR_MS, U1, U2, U3, U4, U5 } from './helpers';

const C = DEFAULT_DOMAIN_CONFIG;
const SID = '00000000-0000-4000-8000-000000005e51';
const NOW = Date.parse('2026-10-06T12:00:00.000Z'); // Tuesday

const input: GameSeriesCreateInput = {
  sport: 'football',
  title: 'Tuesday 5-a-side',
  visibility: 'public',
  venueId: null,
  location: { lat: 51.5, lng: -0.12 },
  hideExactLocation: false,
  capacity: 3,
  depositMinor: 0,
  currency: 'GBP',
  womenOnly: false,
  teamCount: 2,
  recurrence: 'weekly',
  weekday: 2,
  startTime: '20:00',
  timeZone: 'Europe/London',
  durationMinutes: 60,
  startDate: '2026-10-05',
};
const series: GameSeries = buildSeries(input, { id: SID, hostId: HOST, approxLocation: { lat: 51.5, lng: -0.12 }, inviteToken: 'tok' }, C, NOW - 30 * DAY_MS);

const member = (userId: string, o: Partial<RosterMember> = {}): RosterMember => ({
  seriesId: SID,
  userId,
  status: 'regular',
  alwaysIn: true,
  joinedVia: 'invite_link',
  consecutiveMisses: 0,
  leaveOfferedAt: null,
  joinedAt: `2026-09-0${userId.slice(-1)}T10:00:00.000Z`,
  leftAt: null,
  ...o,
});
const types = (effects: readonly Phase15Effect[]) => effects.map((e) => e.type);

describe('series creation', () => {
  it('builds with defaults; anchor is the first weekday on/after startDate', () => {
    expect(series).toMatchObject({
      anchorDate: '2026-10-06',
      horizonWeeks: 4,
      rosterPriorityHours: 24,
      autoJoinReconfirmHours: 48,
      minPlayers: 2,
      depositForfeitTo: 'host',
      scheduleRevision: 0,
      status: 'active',
      skippedDates: [],
      endDate: null,
    });
    expect(buildSeries({ ...input, venueId: 'v1', location: null }, { id: SID, hostId: HOST, approxLocation: { lat: 1, lng: 1 }, location: { lat: 2, lng: 2 }, inviteToken: null }, C, NOW).location).toEqual({ lat: 2, lng: 2 });
  });
  it('validates every field (GAME-004 durations, 6–72 h priority, IANA tz)', () => {
    expect(validateSeriesCreate(input)).toEqual([]);
    expect(
      validateSeriesCreate({
        ...input,
        title: ' ',
        capacity: 1,
        minPlayers: 3,
        teamCount: 0,
        depositMinor: -1,
        recurrence: 'daily' as never,
        weekday: 8 as never,
        startTime: '8pm',
        timeZone: 'Mars/Base',
        durationMinutes: 241,
        rosterPriorityHours: 5,
        autoJoinReconfirmHours: 24,
        location: null,
        startDate: '2026-13-01',
        endDate: 'x',
      }),
    ).toEqual(['title', 'capacity', 'minPlayers', 'teamCount', 'depositMinor', 'recurrence', 'weekday', 'startTime', 'timeZone', 'durationMinutes', 'rosterPriorityHours', 'autoJoinReconfirmHours', 'location', 'startDate', 'endDate']);
    expect(validateSeriesCreate({ ...input, endDate: '2026-10-01' })).toEqual(['endDate']);
    expect(validateSeriesCreate({ ...input, rosterPriorityHours: 72, autoJoinReconfirmHours: 672 })).toEqual([]);
    expect(validateSeriesCreate({ ...input, autoJoinReconfirmHours: 673 })).toEqual(['autoJoinReconfirmHours']);
    expect(() => buildSeries({ ...input, capacity: 0 }, { id: SID, hostId: HOST, approxLocation: { lat: 0, lng: 0 }, inviteToken: null }, C, NOW)).toThrow(RangeError);
  });
  it('slots and keys', () => {
    expect(slotDatesBetween({ ...series, recurrence: 'biweekly' }, '2026-10-01', '2026-11-30')).toEqual(['2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17']);
    expect(slotDatesBetween({ ...series, endDate: '2026-10-13' }, '2026-10-01', '2026-11-30')).toEqual(['2026-10-06', '2026-10-13']);
    expect(isSeriesSlot(series, '2026-10-13')).toBe(true);
    expect(isSeriesSlot(series, '2026-10-14')).toBe(false);
    expect(isSeriesSlot(series, '2026-09-29')).toBe(false);
    expect(isSeriesSlot({ ...series, endDate: '2026-10-06' }, '2026-10-13')).toBe(false);
    expect(isSeriesSlot(series, 'bad')).toBe(false);
    const k = occurrenceKey(SID, 2, '2026-10-13');
    expect(parseOccurrenceKey(k)).toEqual({ seriesId: SID, scheduleRevision: 2, slotDate: '2026-10-13' });
    expect(parseOccurrenceKey('nope')).toBeNull();
    expect(parseOccurrenceKey(`${SID}:x:2026-10-13`)).toBeNull();
    expect(deriveOccurrenceGameId(k)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('rolling generation (GAME-010)', () => {
  it('4-week horizon, DST-correct local time, opens now, priority 24 h', () => {
    const plan = planSeriesOccurrences({ series, existing: [], roster: [] }, C, NOW);
    expect(plan.occurrences.map((o) => [o.slotDate, o.startsAt])).toEqual([
      ['2026-10-06', '2026-10-06T19:00:00.000Z'],
      ['2026-10-13', '2026-10-13T19:00:00.000Z'],
      ['2026-10-20', '2026-10-20T19:00:00.000Z'],
      ['2026-10-27', '2026-10-27T20:00:00.000Z'],
    ]);
    const first = plan.occurrences[0]!;
    expect(first).toMatchObject({
      occurrenceKey: `${SID}:0:2026-10-06`,
      endsAt: '2026-10-06T20:00:00.000Z',
      opensAt: '2026-10-06T12:00:00.000Z',
      priorityUntil: '2026-10-06T19:00:00.000Z',
      reconfirmAt: '2026-10-04T19:00:00.000Z',
      releaseAt: '2026-10-05T19:00:00.000Z',
      status: 'scheduled',
      overridden: false,
    });
    expect(plan.occurrences[3]!.priorityUntil).toBe('2026-10-07T12:00:00.000Z');
    expect(types(plan.effects)).toEqual(['CreateOccurrence', 'CreateOccurrence', 'CreateOccurrence', 'CreateOccurrence']);
    const create = plan.effects[0] as Extract<Phase15Effect, { type: 'CreateOccurrence' }>;
    expect(create.game).toMatchObject({ id: first.gameId, seriesId: SID, hostId: HOST, capacity: 3, startsAt: first.startsAt });
    expect(create.dedupeKey).toBe(`occurrence:${first.occurrenceKey}`);
  });
  it('steady state: a week later only the new slot appears, opening when generated', () => {
    const before = planSeriesOccurrences({ series, existing: [], roster: [] }, C, NOW).occurrences;
    const later = Date.parse('2026-11-03T20:00:00.000Z') - 28 * DAY_MS + HOUR_MS;
    const plan = planSeriesOccurrences({ series, existing: before, roster: [] }, C, later);
    expect(plan.occurrences.map((o) => [o.slotDate, o.opensAt])).toEqual([['2026-11-03', '2026-10-06T21:00:00.000Z']]);
  });
  it('skips skipped dates, other-revision scheduled duplicates, paused series; respects endDate', () => {
    const occ = buildOccurrence({ ...series, scheduleRevision: 7 }, '2026-10-13', C, NOW);
    const plan = planSeriesOccurrences({ series: { ...series, skippedDates: ['2026-10-20'], endDate: '2026-10-27' }, existing: [occ], roster: [] }, C, NOW);
    expect(plan.occurrences.map((o) => o.slotDate)).toEqual(['2026-10-06', '2026-10-27']);
    expect(planSeriesOccurrences({ series: { ...series, status: 'paused' }, existing: [], roster: [] }, C, NOW)).toEqual({ occurrences: [], effects: [] });
  });
  it('always-in regulars auto-join by seniority: approved while seats remain, then waitlisted', () => {
    const roster = [
      member(U3),
      member(U1),
      member(U2),
      member(U4, { alwaysIn: false }),
      member(U5, { status: 'invited' }),
      member(HOST),
    ];
    const at = Date.parse('2026-10-14T21:00:00.000Z'); // only 2026-11-10 is new; 2026-10-13 … 11-03 exist
    const existing = planSeriesOccurrences({ series, existing: [], roster: [] }, C, Date.parse('2026-10-13T00:00:00.000Z')).occurrences;
    const plan = planSeriesOccurrences({ series, existing, roster, ineligibleUserIds: [U2] }, C, at);
    expect(plan.occurrences.map((o) => o.slotDate)).toEqual(['2026-11-10']);
    expect(plan.effects.slice(1).map((e) => e.type === 'AutoJoin' && [e.userId, e.joinedAs])).toEqual([
      [U1, 'approved'],
      [U3, 'approved'],
    ]);
    const full = planSeriesOccurrences({ series: { ...series, capacity: 2 }, existing, roster }, C, at);
    expect(full.effects.slice(1).map((e) => e.type === 'AutoJoin' && [e.userId, e.joinedAs])).toEqual([
      [U1, 'approved'],
      [U2, 'waitlisted'],
      [U3, 'waitlisted'],
    ]);
  });
  it('no auto-join when generated after reconfirmAt (no time to reconfirm)', () => {
    const plan = planSeriesOccurrences({ series, existing: [], roster: [member(U1)] }, C, NOW);
    expect(types(plan.effects).filter((t) => t === 'AutoJoin')).toHaveLength(3);
  });
});

describe('priority window (AC-GAME-010)', () => {
  const occ = buildOccurrence(series, '2026-10-27', C, NOW);
  const roster = [member(U1), member(U2, { status: 'left' })];
  it('regulars only for 24 h, then everyone; closed after start', () => {
    const t = Date.parse(occ.opensAt);
    expect(occurrenceJoinPhase(occ, t - 1)).toBe('not_open');
    expect(occurrenceJoinPhase(occ, t)).toBe('roster_only');
    expect(checkOccurrenceJoinWindow(series, occ, roster, U1, t)).toEqual({ ok: true, value: 'roster_only' });
    expect(checkOccurrenceJoinWindow(series, occ, roster, HOST, t)).toEqual({ ok: true, value: 'roster_only' });
    expect(checkOccurrenceJoinWindow(series, occ, roster, U2, t)).toEqual({ ok: false, error: 'roster_priority' });
    expect(checkOccurrenceJoinWindow(series, occ, roster, U2, t + 24 * HOUR_MS)).toEqual({ ok: true, value: 'open' });
    expect(checkOccurrenceJoinWindow(series, occ, roster, U1, t - 1)).toEqual({ ok: false, error: 'game_not_open' });
    expect(occurrenceJoinPhase(occ, Date.parse(occ.startsAt))).toBe('closed');
    expect(occurrenceJoinPhase({ ...occ, status: 'skipped' }, t)).toBe('closed');
  });
  it('checkJoinEligibility honours the occurrence priorityUntil', () => {
    const base = {
      game: { id: occ.gameId, hostId: HOST, status: 'scheduled' as const, startsAt: occ.startsAt, capacity: 10, womenOnly: false, visibility: 'public' as const, createdAt: '2026-01-01T00:00:00.000Z' },
      user: { id: U3, gender: 'male' as const, permanentlyBanned: false, joinBannedUntil: null, visibilityRestrictedUntil: null },
      existing: null,
      approvedUserIds: [],
      blocks: [],
      regularIds: [U1],
    };
    const t = Date.parse(occ.priorityUntil);
    expect(checkJoinEligibility({ ...base, priorityUntil: occ.priorityUntil }, t - 1)).toEqual({ ok: false, error: 'roster_priority' });
    expect(checkJoinEligibility({ ...base, priorityUntil: occ.priorityUntil }, t).ok).toBe(true);
    expect(checkJoinEligibility(base, t - 1).ok).toBe(true);
  });
});

describe('roster membership', () => {
  const s = { id: SID, hostId: HOST, title: 'T', status: 'active' as const };
  it('invite link → regular; host/played-with → invited then accept', () => {
    const viaLink = joinRoster({ series: s, existing: null, userId: U1, via: 'invite_link', blocked: false }, NOW);
    expect(viaLink.ok && viaLink.value.member.status).toBe('regular');
    expect(viaLink.ok && types(viaLink.value.effects)).toEqual(['UpdateRosterMember']);
    const invited = joinRoster({ series: s, existing: null, userId: U2, via: 'played_with', blocked: false }, NOW);
    expect(invited.ok && invited.value.member.status).toBe('invited');
    expect(invited.ok && types(invited.value.effects)).toEqual(['UpdateRosterMember', 'Notify15']);
    const accepted = acceptRosterInvite(invited.ok ? invited.value.member : null, NOW + 1);
    expect(accepted.ok && accepted.value.member.status).toBe('regular');
    expect(acceptRosterInvite(null, NOW)).toEqual({ ok: false, error: 'not_found' });
    const relink = joinRoster({ series: s, existing: member(U2, { status: 'invited' }), userId: U2, via: 'invite_link', blocked: false }, NOW);
    expect(relink.ok && relink.value.member.status).toBe('regular');
    const rejoin = joinRoster({ series: s, existing: member(U2, { status: 'left' }), userId: U2, via: 'invite_link', blocked: false }, NOW);
    expect(rejoin.ok).toBe(true);
  });
  it('rejections', () => {
    const j = (o: Partial<Parameters<typeof joinRoster>[0]>) => joinRoster({ series: s, existing: null, userId: U1, via: 'host', blocked: false, ...o }, NOW);
    expect(j({ blocked: true })).toEqual({ ok: false, error: 'blocked' });
    expect(j({ series: { ...s, status: 'ended' } })).toEqual({ ok: false, error: 'game_not_open' });
    expect(j({ userId: HOST })).toEqual({ ok: false, error: 'conflict' });
    expect(j({ existing: member(U1) })).toEqual({ ok: false, error: 'conflict' });
    expect(j({ existing: member(U1, { status: 'invited' }) })).toEqual({ ok: false, error: 'conflict' });
  });
  it('leave and always-in', () => {
    const left = leaveRoster(member(U1), NOW);
    expect(left.ok && left.value.member).toMatchObject({ status: 'left', alwaysIn: false });
    expect(leaveRoster(member(U1, { status: 'left' }), NOW)).toEqual({ ok: false, error: 'not_found' });
    expect(leaveRoster(null, NOW)).toEqual({ ok: false, error: 'not_found' });
    const on = setAlwaysIn(member(U1, { alwaysIn: false }), true, NOW);
    expect(on.ok && on.value.member.alwaysIn).toBe(true);
    expect(setAlwaysIn(member(U1, { status: 'invited' }), true, NOW)).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('always-in reconfirm and release (T−48h / T−24h, GAME-011)', () => {
  const occ = buildOccurrence(series, '2026-10-27', C, NOW);
  const rec = (userId: string, o: Partial<AutoJoinRecord> = {}): AutoJoinRecord => ({
    gameId: occ.gameId,
    seriesId: SID,
    userId,
    joinedAs: 'approved',
    reconfirmRequestedAt: null,
    reconfirmedAt: null,
    releasedAt: null,
    ...o,
  });
  const tick = (autoJoins: AutoJoinRecord[], roster: RosterMember[], at: number) =>
    processAutoJoins({ series, occurrence: occ, autoJoins, roster }, C, at).effects;
  const reconfirmAt = Date.parse(occ.reconfirmAt);
  const releaseAt = Date.parse(occ.releaseAt);

  it('nothing before T−48h; requests once at T−48h', () => {
    expect(tick([rec(U1)], [member(U1)], reconfirmAt - 1)).toEqual([]);
    expect(types(tick([rec(U2), rec(U1), rec(U3, { reconfirmRequestedAt: occ.reconfirmAt })], [], reconfirmAt))).toEqual([
      'RequestReconfirm',
      'Notify15',
      'RequestReconfirm',
      'Notify15',
    ]);
    expect(tick([rec(U1, { reconfirmedAt: occ.reconfirmAt })], [], reconfirmAt)).toEqual([]);
  });
  it('releases unconfirmed at T−24h, counts misses, offers to leave at the 3rd (no card)', () => {
    const asked = rec(U1, { reconfirmRequestedAt: occ.reconfirmAt });
    const e1 = tick([asked], [member(U1, { consecutiveMisses: 1 })], releaseAt);
    expect(types(e1)).toEqual(['ReleaseAutoJoin', 'Notify15', 'UpdateRosterMember']);
    expect((e1[2] as Extract<Phase15Effect, { type: 'UpdateRosterMember' }>).patch).toEqual({ consecutiveMisses: 2 });
    const e2 = tick([asked], [member(U1, { consecutiveMisses: 2 })], releaseAt);
    expect(types(e2)).toEqual(['ReleaseAutoJoin', 'Notify15', 'UpdateRosterMember', 'Notify15']);
    expect(e2[3]).toMatchObject({ kind: 'roster_leave_offer', params: { misses: 3 } });
    const e3 = tick([asked], [member(U1, { consecutiveMisses: 5, leaveOfferedAt: '2026-01-01T00:00:00.000Z' })], releaseAt);
    expect(types(e3)).toEqual(['ReleaseAutoJoin', 'Notify15', 'UpdateRosterMember']);
    expect(types(tick([rec(U2)], [member(U2)], releaseAt))).toEqual(['ReleaseAutoJoin', 'Notify15']);
    expect(types(tick([asked], [], releaseAt))).toEqual(['ReleaseAutoJoin', 'Notify15']);
  });
  it('inactive after start or for a cancelled occurrence', () => {
    expect(tick([rec(U1)], [], Date.parse(occ.startsAt))).toEqual([]);
    expect(processAutoJoins({ series, occurrence: { ...occ, status: 'cancelled' }, autoJoins: [rec(U1)], roster: [] }, C, releaseAt).effects).toEqual([]);
  });
  it('reconfirm: keep resets misses; decline releases before the late window only', () => {
    const r = (record: AutoJoinRecord | null, attending: boolean, at: number, m: RosterMember | null = member(U1, { consecutiveMisses: 2 })) =>
      reconfirmAutoJoin({ seriesId: SID, record, occurrence: occ, member: m }, attending, C, at);
    const keep = r(rec(U1), true, reconfirmAt + 1);
    expect(keep.ok && keep.value.record.reconfirmedAt).toBe(new Date(reconfirmAt + 1).toISOString());
    expect(keep.ok && types(keep.value.effects)).toEqual(['UpdateRosterMember']);
    const decline = r(rec(U1), false, reconfirmAt + 1, member(U1));
    expect(decline.ok && types(decline.value.effects)).toEqual(['ReleaseAutoJoin']);
    expect(decline.ok && decline.value.record.releasedAt).not.toBeNull();
    const start = Date.parse(occ.startsAt);
    expect(r(rec(U1), false, start - 2 * HOUR_MS + 1)).toEqual({ ok: false, error: 'outside_window' });
    expect(r(rec(U1), true, start - 2 * HOUR_MS + 1).ok).toBe(true);
    expect(r(null, true, start - HOUR_MS)).toEqual({ ok: false, error: 'not_found' });
    expect(r(rec(U1, { releasedAt: occ.releaseAt }), true, start - HOUR_MS)).toEqual({ ok: false, error: 'not_found' });
    expect(r(rec(U1), true, start)).toEqual({ ok: false, error: 'game_not_open' });
  });
});

describe('skip, edit this / following, end', () => {
  const occurrences = planSeriesOccurrences({ series, existing: [], roster: [] }, C, NOW).occurrences; // 10-06 … 10-27
  const o = (date: string) => occurrences.find((x) => x.slotDate === date) as SeriesOccurrence;
  const ctx = (extra: Partial<SeriesChangeInput> = {}): SeriesChangeInput => ({
    series,
    occurrences,
    roster: [member(U1)],
    participants: { [o('2026-10-13').gameId]: [U1, U2], [o('2026-10-06').gameId]: [U1] },
    ...extra,
  });
  const T = NOW + HOUR_MS;

  it('skips a generated occurrence; late flag inside 2 h with participants', () => {
    const r = skipOccurrence(ctx(), o('2026-10-13').occurrenceKey, C, T);
    expect(r.ok && types(r.value.effects)).toEqual(['CancelOccurrence', 'Notify15', 'Notify15', 'UpdateSeries']);
    expect(r.ok && r.value.effects[0]).toMatchObject({ reason: 'skipped', lateCancel: false });
    expect(r.ok && r.value.series.skippedDates).toEqual(['2026-10-13']);
    expect(r.ok && r.value.occurrences[0]!.status).toBe('skipped');
    const late = skipOccurrence(ctx(), o('2026-10-06').occurrenceKey, C, Date.parse(o('2026-10-06').startsAt) - HOUR_MS);
    expect(late.ok && late.value.effects[0]).toMatchObject({ lateCancel: true });
    const already = skipOccurrence(ctx({ series: { ...series, skippedDates: ['2026-10-13'] } }), o('2026-10-13').occurrenceKey, C, T);
    expect(already.ok && already.value.series.skippedDates).toEqual(['2026-10-13']);
  });
  it('skips a future slot that is not generated yet', () => {
    const key = occurrenceKey(SID, 0, '2026-11-17');
    const r = skipOccurrence(ctx(), key, C, T);
    expect(r.ok && types(r.value.effects)).toEqual(['UpdateSeries']);
    expect(r.ok && r.value.series.skippedDates).toEqual(['2026-11-17']);
    expect(skipOccurrence(ctx({ series: { ...series, skippedDates: ['2026-11-17'] } }), key, C, T)).toEqual({ ok: false, error: 'conflict' });
  });
  it('skip rejections', () => {
    expect(skipOccurrence(ctx(), 'garbage', C, T)).toEqual({ ok: false, error: 'not_found' });
    expect(skipOccurrence(ctx(), occurrenceKey(SID, 1, '2026-11-17'), C, T)).toEqual({ ok: false, error: 'not_found' });
    expect(skipOccurrence(ctx(), occurrenceKey(SID, 0, '2026-11-18'), C, T)).toEqual({ ok: false, error: 'not_found' });
    expect(skipOccurrence(ctx(), occurrenceKey('other', 0, '2026-11-17'), C, T)).toEqual({ ok: false, error: 'not_found' });
    expect(skipOccurrence(ctx({ occurrences: [] }), occurrenceKey(SID, 0, '2026-10-06'), C, Date.parse('2026-10-06T19:00:00.000Z'))).toEqual({ ok: false, error: 'outside_window' });
    expect(skipOccurrence(ctx(), o('2026-10-06').occurrenceKey, C, Date.parse(o('2026-10-06').startsAt))).toEqual({ ok: false, error: 'outside_window' });
    expect(skipOccurrence(ctx({ occurrences: [{ ...o('2026-10-13'), status: 'skipped' }] }), o('2026-10-13').occurrenceKey, C, T)).toEqual({ ok: false, error: 'conflict' });
  });

  it('edit this: title and move; marks overridden; notifies participants', () => {
    const key = o('2026-10-13').occurrenceKey;
    const r = editSeries(ctx(), { scope: 'this', occurrenceKey: key, patch: { title: 'Cup night', startsAt: '2026-10-14T19:00:00.000Z', durationMinutes: 90 } }, C, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const upd = r.value.effects[0] as Extract<Phase15Effect, { type: 'UpdateOccurrence' }>;
    expect(upd.patch).toEqual({ title: 'Cup night', startsAt: '2026-10-14T19:00:00.000Z', endsAt: '2026-10-14T20:30:00.000Z' });
    expect(upd.occurrence).toMatchObject({ overridden: true, startsAt: '2026-10-14T19:00:00.000Z', reconfirmAt: '2026-10-12T19:00:00.000Z', slotDate: '2026-10-13' });
    expect(types(r.value.effects)).toEqual(['UpdateOccurrence', 'Notify15', 'Notify15']);
    const titleOnly = editSeries(ctx(), { scope: 'this', occurrenceKey: key, patch: { notes: 'bring bibs' } }, C, T);
    expect(titleOnly.ok && (titleOnly.value.effects[0] as Extract<Phase15Effect, { type: 'UpdateOccurrence' }>).patch).toEqual({ notes: 'bring bibs' });
  });
  it('edit this rejections', () => {
    const key = o('2026-10-06').occurrenceKey;
    const e = (patch: object, at = T, extra: Partial<SeriesChangeInput> = {}) => editSeries(ctx(extra), { scope: 'this', occurrenceKey: key, patch }, C, at);
    expect(e({ capacity: 1 })).toEqual({ ok: false, error: 'validation' });
    expect(e({ durationMinutes: 10 })).toEqual({ ok: false, error: 'validation' });
    expect(e({ startsAt: 'nope' })).toEqual({ ok: false, error: 'validation' });
    expect(e({ startsAt: new Date(T - 1).toISOString() })).toEqual({ ok: false, error: 'validation' });
    const start = Date.parse(o('2026-10-06').startsAt);
    expect(e({ startsAt: new Date(start + DAY_MS).toISOString() }, start - HOUR_MS)).toEqual({ ok: false, error: 'outside_window' });
    expect(e({ startsAt: new Date(T + HOUR_MS).toISOString() })).toEqual({ ok: false, error: 'outside_window' });
    expect(e({ startsAt: new Date(start + DAY_MS).toISOString() }, start - HOUR_MS, { participants: {} }).ok).toBe(true);
    expect(e({}, start)).toEqual({ ok: false, error: 'outside_window' });
    expect(editSeries(ctx(), { scope: 'this', occurrenceKey: 'x', patch: {} }, C, T)).toEqual({ ok: false, error: 'not_found' });
    expect(e({}, T, { occurrences: [{ ...o('2026-10-06'), status: 'cancelled' }] })).toEqual({ ok: false, error: 'conflict' });
    expect(e({}, T, { series: { ...series, status: 'ended' } })).toEqual({ ok: false, error: 'conflict' });
  });

  it('edit following (template): later occurrences updated, earlier untouched', () => {
    const r = editSeries(ctx(), { scope: 'following', occurrenceKey: o('2026-10-20').occurrenceKey, patch: { capacity: 12, rosterPriorityHours: 6 } }, C, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.series).toMatchObject({ capacity: 12, rosterPriorityHours: 6, scheduleRevision: 0 });
    const upd = r.value.effects.filter((x): x is Extract<Phase15Effect, { type: 'UpdateOccurrence' }> => x.type === 'UpdateOccurrence');
    expect(upd.map((u) => u.occurrence.slotDate)).toEqual(['2026-10-20', '2026-10-27']);
    expect(upd[1]!.patch).toEqual({ capacity: 12 });
    expect(upd[1]!.occurrence.priorityUntil).toBe('2026-10-06T18:00:00.000Z');
    expect(types(r.value.effects).at(-1)).toBe('UpdateSeries');
  });
  it('edit following (schedule): reschedule = cancel later occurrences + regenerate under revision 1', () => {
    const r = editSeries(ctx(), { scope: 'following', occurrenceKey: o('2026-10-13').occurrenceKey, patch: { weekday: 4, startTime: '19:30' } }, C, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.series).toMatchObject({ weekday: 4, startTime: '19:30', scheduleRevision: 1, anchorDate: '2026-10-15' });
    const cancels = r.value.effects.filter((x) => x.type === 'CancelOccurrence');
    expect(cancels.map((x) => x.type === 'CancelOccurrence' && [x.occurrenceKey.slice(-10), x.reason])).toEqual([
      ['2026-10-13', 'rescheduled'],
      ['2026-10-20', 'rescheduled'],
      ['2026-10-27', 'rescheduled'],
    ]);
    const created = r.value.effects.filter((x): x is Extract<Phase15Effect, { type: 'CreateOccurrence' }> => x.type === 'CreateOccurrence');
    expect(created.map((x) => [x.occurrence.occurrenceKey.slice(-12), x.occurrence.startsAt])).toEqual([
      ['1:2026-10-15', '2026-10-15T18:30:00.000Z'],
      ['1:2026-10-22', '2026-10-22T18:30:00.000Z'],
      ['1:2026-10-29', '2026-10-29T19:30:00.000Z'],
    ]);
    expect(r.value.effects.filter((x) => x.type === 'Notify15').map((x) => x.type === 'Notify15' && x.kind)).toEqual(['occurrence_rescheduled', 'occurrence_rescheduled']);
    const same = editSeries(ctx(), { scope: 'following', occurrenceKey: o('2026-10-13').occurrenceKey, patch: { startTime: '21:00' } }, C, T);
    expect(same.ok && same.value.series.anchorDate).toBe('2026-10-13');
  });
  it('edit following: endDate cancels later occurrences; validation and late-window guards', () => {
    const r = editSeries(ctx(), { scope: 'following', occurrenceKey: o('2026-10-13').occurrenceKey, patch: { endDate: '2026-10-20' } }, C, T);
    expect(r.ok && r.value.effects.filter((x) => x.type === 'CancelOccurrence').map((x) => x.type === 'CancelOccurrence' && x.reason)).toEqual(['series_ended']);
    const key = o('2026-10-06').occurrenceKey;
    const f = (patch: object, at = T) => editSeries(ctx(), { scope: 'following', occurrenceKey: key, patch }, C, at);
    expect(f({ endDate: '2026-10-01' })).toEqual({ ok: false, error: 'validation' });
    expect(f({ rosterPriorityHours: 100 })).toEqual({ ok: false, error: 'validation' });
    expect(f({ timeZone: 'Bad/Zone' })).toEqual({ ok: false, error: 'validation' });
    const start = Date.parse(o('2026-10-06').startsAt);
    expect(f({ startTime: '21:00' }, start - HOUR_MS)).toEqual({ ok: false, error: 'outside_window' });
    expect(f({ title: 'Later' }, start - HOUR_MS).ok).toBe(true);
    expect(f({ startTime: '20:00' }, start - HOUR_MS).ok).toBe(true);
  });
  it('end series cancels future scheduled occurrences', () => {
    const r = endSeries(ctx(), C, T);
    expect(r.ok && r.value.series.status).toBe('ended');
    expect(r.ok && r.value.occurrences.map((x) => x.status)).toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled']);
    expect(endSeries(ctx({ series: { ...series, status: 'ended' } }), C, T)).toEqual({ ok: false, error: 'conflict' });
  });
  it('config resolution merges trust and Phase 1.5 overrides', () => {
    const c = resolveDomainConfig({ lateCancelWindowHours: 6, rosterPriorityHoursDefault: 12, seriesHorizonWeeks: undefined });
    expect(c.lateCancelWindowHours).toBe(6);
    expect(c.rosterPriorityHoursDefault).toBe(12);
    expect(c.seriesHorizonWeeks).toBe(4);
    expect(resolveDomainConfig(null)).toEqual(DEFAULT_DOMAIN_CONFIG);
  });
});
