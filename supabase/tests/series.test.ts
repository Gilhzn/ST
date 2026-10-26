/**
 * Recurring series and rosters (PRD GAME-010/011/044, §5.4): create/validate, rolling generation
 * (4-week horizon, DST-correct in the series' IANA zone), roster-only priority window, joins via
 * the series link, "always in" auto-join with T−48h reconfirmation and T−24h release, skip/edit/end.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { zonedTimeToEpoch } from "@st/domain";
import { createHarness, type Harness } from "./harness";
import { addParticipant, asService, asUser, DAY, expectSt, first, HOUR, makeGame, makeUser, MIN } from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

const NOW = new Date("2026-10-14T12:00:00.000Z"); // Wednesday
const plus = (ms: number) => new Date(NOW.getTime() + ms);

type SeriesRow = { id: string; invite_token: string | null; schedule_revision: number; status: string; roster_count: number };
type Occ = { occurrence_key: string; slot_date: string; game_id: string; starts_at: Date; ends_at: Date; opens_at: Date;
  priority_until: Date; reconfirm_at: Date; release_at: Date; status: string; schedule_revision: number; overridden: boolean };

const input = (o: Record<string, unknown> = {}) => ({
  sport: "football", title: "Tuesday 5-a-side", visibility: "public", venueId: null, location: { lat: 32.08, lng: 34.78 },
  hideExactLocation: false, capacity: 10, depositMinor: 0, currency: "ILS", womenOnly: false, teamCount: 2,
  recurrence: "weekly", weekday: 2, startTime: "20:00", timeZone: "Asia/Jerusalem", durationMinutes: 90,
  startDate: "2026-10-20", ...o,
});

async function createSeries(host: string, o: Record<string, unknown> = {}, now = NOW): Promise<SeriesRow> {
  return first(await asUser<SeriesRow>(db, host, `select * from public.create_series($1::jsonb)`, [JSON.stringify(input(o))], { now }));
}
const occurrences = (seriesId: string) =>
  db.query<Occ>(`select *, slot_date::text as slot_date from public.series_occurrences where series_id = $1
     order by starts_at, schedule_revision`, [seriesId]);
const iso = (d: Date) => d.toISOString();

describe("create_series", () => {
  it("validates the template and schedule (ST:validation, host_suspended, women_only, join_banned)", async () => {
    const host = await makeUser(db);
    const bad = [
      { durationMinutes: 20 }, { durationMinutes: 241 }, { rosterPriorityHours: 5 }, { rosterPriorityHours: 73 },
      { timeZone: "Mars/Olympus" }, { timeZone: "EST5EDT+1" }, { startTime: "25:00" }, { weekday: 8 }, { capacity: 1 },
      { title: " " }, { startDate: "2026-10-01" }, { depositMinor: 123 }, { unknownField: 1 },
      { autoJoinReconfirmHours: 24 },
    ];
    for (const b of bad) {
      await expectSt(asUser(db, host, `select public.create_series($1::jsonb)`, [JSON.stringify(input(b))], { now: NOW }), "validation");
    }
    await db.query(`update profiles set host_suspended_until = $2 where id = $1`, [host, iso(plus(DAY))]);
    await expectSt(createSeries(host), "host_suspended");
    const man = await makeUser(db, { gender: "male" });
    await expectSt(createSeries(man, { womenOnly: true }), "women_only");
    const banned = await makeUser(db);
    await db.query(`update profiles set join_banned_until = $2 where id = $1`, [banned, iso(plus(DAY))]);
    await expectSt(createSeries(banned), "join_banned");
    // A private series is allowed while join-banned (TRUST-026 applies to public games).
    expect((await createSeries(banned, { visibility: "private" })).status).toBe("active");
    await expect(db.asAnon((tx) => tx.query(`select public.create_series('{}'::jsonb)`))).rejects.toThrow(/permission denied/);
  });

  it("anchors on the first weekday on/after startDate and generates a 4-week rolling horizon with the host approved", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host, { startDate: "2026-10-15" }); // Thursday → first Tuesday 2026-10-20
    expect(s.invite_token).toMatch(/^[0-9a-f]{36}$/);
    const occ = await occurrences(s.id);
    // Slots with start in (now, now + 4 weeks]: 10-20, 10-27, 11-03, 11-10 (11-10 18:00Z ≤ 11-11 12:00Z).
    expect(occ.map((o) => o.slot_date)).toEqual(["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10"].map((d) => d));
    for (const o of occ) {
      expect(o.occurrence_key).toBe(`${s.id}:0:${o.slot_date}`);
      const [g] = await db.query<{ series_id: string; host_id: string; time_zone: string }>(
        `select series_id, host_id, time_zone from games where id = $1`, [o.game_id]);
      expect(g).toEqual({ series_id: s.id, host_id: host, time_zone: "Asia/Jerusalem" });
      const [p] = await db.query<{ status: string }>(`select status from game_participants where game_id = $1 and user_id = $2`, [o.game_id, host]);
      expect(p!.status).toBe("approved");
    }
    // Idempotent job; the next run past a week adds exactly the newly-due slot.
    expect(first(await asService<{ n: number }>(db, `select public.generate_occurrences() n`, [], { now: NOW })).n).toBe(0);
    expect(first(await asService<{ n: number }>(db, `select public.generate_occurrences() n`, [], { now: plus(7 * DAY) })).n).toBe(1);
    expect((await occurrences(s.id)).at(-1)!.slot_date).toBe("2026-11-17");
  });

  it("game ids are stableUuid('occurrence:' + key) like the domain", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host);
    const o = first(await occurrences(s.id));
    const [r] = await db.query<{ id: string }>(`select public.dm_stable_uuid('occurrence:' || $1) id`, [o.occurrence_key]);
    expect(o.game_id).toBe(r!.id);
  });
});

describe("DST: wall-clock time in the series' IANA zone", () => {
  it("Europe/London keeps 20:00 local across BST→GMT (2026-10-25)", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host, { timeZone: "Europe/London", startDate: "2026-10-20" });
    const occ = await occurrences(s.id);
    expect(occ.map((o) => iso(o.starts_at))).toEqual([
      "2026-10-20T19:00:00.000Z", // BST (+1)
      "2026-10-27T20:00:00.000Z", // GMT
      "2026-11-03T20:00:00.000Z",
      "2026-11-10T20:00:00.000Z",
    ]);
    expect(occ.map((o) => o.ends_at.getTime() - o.starts_at.getTime())).toEqual(Array(4).fill(90 * MIN));
  });

  it("Asia/Jerusalem keeps 20:00 local across IDT→IST (2026-10-25), biweekly", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host, { weekday: 7, recurrence: "biweekly", startDate: "2026-10-18" });
    const occ = await occurrences(s.id);
    expect(occ.map((o) => [o.slot_date, iso(o.starts_at)])).toEqual([
      ["2026-10-18", "2026-10-18T17:00:00.000Z"], // IDT (+3)
      ["2026-11-01", "2026-11-01T18:00:00.000Z"], // IST (+2)
    ]);
  });

  it("gaps shift forward and overlaps take the earlier instant, exactly like the TS (London and Jerusalem, both transitions)", async () => {
    const cases: [string, string, string][] = [];
    for (const tz of ["Europe/London", "Asia/Jerusalem"]) {
      for (const date of ["2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-10-24", "2026-10-25", "2026-10-26"]) {
        for (const time of ["00:00", "00:30", "01:00", "01:30", "01:59", "02:00", "02:30", "03:00", "03:30", "20:00", "23:59"]) {
          cases.push([date, time, tz]);
        }
      }
    }
    const rows = await db.query<{ d: string; t: string; z: string; at: Date }>(
      `select c->>0 d, c->>1 t, c->>2 z, public.st_local_to_utc((c->>0)::date, (c->>1)::time, c->>2) at
       from jsonb_array_elements($1::jsonb) c`, [JSON.stringify(cases)]);
    for (const r of rows) expect(r.at.getTime(), `${r.z} ${r.d} ${r.t}`).toBe(zonedTimeToEpoch(r.d, r.t, r.z));
    const pick = (tz: string, d: string, t: string) => iso(rows.find((r) => r.z === tz && r.d === d && r.t === t)!.at);
    expect(pick("Europe/London", "2026-03-29", "01:30")).toBe("2026-03-29T01:30:00.000Z"); // gap → 02:30 BST
    expect(pick("Europe/London", "2026-10-25", "01:30")).toBe("2026-10-25T00:30:00.000Z"); // overlap → earlier (BST)
    expect(pick("Asia/Jerusalem", "2026-03-27", "02:30")).toBe("2026-03-27T00:30:00.000Z"); // gap → 03:30 IDT
    expect(pick("Asia/Jerusalem", "2026-10-25", "01:30")).toBe("2026-10-24T22:30:00.000Z"); // overlap → earlier (IDT)
  });
});

describe("roster priority window (AC-GAME-010)", () => {
  async function scenario() {
    const host = await makeUser(db);
    const s = await createSeries(host, { capacity: 12 });
    const regular = await makeUser(db);
    const stranger = await makeUser(db);
    await asUser(db, regular, `select public.join_roster($1)`, [s.invite_token], { now: NOW });
    // The 4th occurrence opened now (startsAt − 4 weeks < now): roster-only until now + 24 h.
    const occ = (await occurrences(s.id)).at(-1)!;
    return { host, s, regular, stranger, occ };
  }

  it("non-regulars get ST:roster_priority until opensAt + rosterPriorityHours; regulars may join; then everyone", async () => {
    const { s, regular, stranger, occ } = await scenario();
    expect(iso(occ.priority_until)).toBe(iso(plus(24 * HOUR)));
    await expectSt(asUser(db, stranger, `select public.request_join($1)`, [occ.game_id], { now: plus(HOUR) }), "roster_priority");
    // The occurrence's own invite token does not bypass the window either.
    const [{ invite_token }] = (await db.query<{ invite_token: string }>(`select invite_token from games where id = $1`, [occ.game_id])) as [{ invite_token: string }];
    await expectSt(asUser(db, stranger, `select public.request_join($1, null, $2)`, [occ.game_id, invite_token], { now: plus(HOUR) }), "roster_priority");
    const [r] = await asUser<{ status: string }>(db, regular, `select * from public.request_join($1)`, [occ.game_id], { now: plus(HOUR) });
    expect(r!.status).toBe("requested");
    const [p] = await asUser<{ status: string }>(db, stranger, `select * from public.request_join($1)`, [occ.game_id], { now: plus(24 * HOUR) });
    expect(p!.status).toBe("requested");
    expect(s.id).toBeTruthy();
  });

  it("the map (nearby_games) lists the occurrence only to regulars until the window ends", async () => {
    const { regular, stranger, occ } = await scenario();
    const list = (u: string, at: Date) =>
      asUser<{ id: string }>(db, u, `select id from public.nearby_games(32.08, 34.78, 5, '{}', $1, $2)`,
        [iso(at), iso(new Date(at.getTime() + 40 * DAY))], { now: at });
    expect((await list(stranger, plus(HOUR))).map((g) => g.id)).not.toContain(occ.game_id);
    expect((await list(regular, plus(HOUR))).map((g) => g.id)).toContain(occ.game_id);
    expect((await list(stranger, plus(25 * HOUR))).map((g) => g.id)).toContain(occ.game_id);
    // Hidden from game_views and series_occurrences too during the window (security review #2 L2).
    expect(await asUser(db, stranger, `select 1 from game_views where id = $1`, [occ.game_id], { now: plus(HOUR) })).toHaveLength(0);
    expect(await asUser(db, stranger, `select 1 from series_occurrences where game_id = $1`, [occ.game_id], { now: plus(HOUR) })).toHaveLength(0);
    const [gv] = await asUser<{ priority_until: Date; series_id: string }>(db, regular,
      `select priority_until, series_id from game_views where id = $1`, [occ.game_id], { now: plus(HOUR) });
    expect(iso(gv!.priority_until)).toBe(iso(occ.priority_until));
    expect(await asUser(db, stranger, `select 1 from game_views where id = $1`, [occ.game_id], { now: plus(25 * HOUR) })).toHaveLength(1);
  });

  it("regulars see private occurrences; waitlist offers go to regulars first (GAME-044)", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host, { visibility: "private", capacity: 2 });
    const regular = await makeUser(db);
    const outsider = await makeUser(db);
    await asUser(db, regular, `select public.join_roster($1)`, [s.invite_token], { now: NOW });
    const occ = first(await occurrences(s.id));
    const seen = await asUser(db, regular, `select id from game_views where id = $1`, [occ.game_id], { now: NOW });
    expect(seen).toHaveLength(1);
    expect(await asUser(db, outsider, `select id from game_views where id = $1`, [occ.game_id], { now: NOW })).toHaveLength(0);
    // Waitlist: an outsider who waitlisted first is still offered after the regular.
    const filler = await makeUser(db);
    await addParticipant(db, occ.game_id, filler, "approved");
    await addParticipant(db, occ.game_id, outsider, "waitlisted", { waitlistedAt: new Date(NOW.getTime() - DAY) });
    await addParticipant(db, occ.game_id, regular, "waitlisted", { waitlistedAt: NOW });
    await asUser(db, filler, `select public.cancel_participation($1)`, [occ.game_id], { now: plus(HOUR) });
    const offers = await db.query<{ user_id: string }>(`select user_id from waitlist_offers where game_id = $1`, [occ.game_id]);
    expect(offers.map((o) => o.user_id)).toEqual([regular]);
  });
});

describe("roster: join through the link, leave, invites, always-in", () => {
  it("join_roster: invite_link regular, tracked in invite_joins; conflict, blocked, women_only, removed, ended", async () => {
    const host = await makeUser(db, { gender: "female" });
    const s = await createSeries(host);
    const u = await makeUser(db);
    const [m] = await asUser<{ status: string; joined_via: string }>(db, u, `select * from public.join_roster($1)`, [s.invite_token], { now: NOW });
    expect(m).toMatchObject({ status: "regular", joined_via: "invite_link" });
    expect(await db.query(`select 1 from invite_joins where kind = 'series' and series_id = $1 and user_id = $2`, [s.id, u])).toHaveLength(1);
    await expectSt(asUser(db, u, `select public.join_roster($1)`, [s.invite_token], { now: NOW }), "conflict");
    await expectSt(asUser(db, host, `select public.join_roster($1)`, [s.invite_token], { now: NOW }), "conflict");
    await expectSt(asUser(db, u, `select public.join_roster('ffffffffffffffffffffffff')`, [], { now: NOW }), "not_found");
    const b = await makeUser(db);
    await db.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [host, b]);
    await expectSt(asUser(db, b, `select public.join_roster($1)`, [s.invite_token], { now: NOW }), "blocked");
    const ws = await createSeries(host, { womenOnly: true, title: "Women" });
    const man = await makeUser(db, { gender: "male" });
    await expectSt(asUser(db, man, `select public.join_roster($1)`, [ws.invite_token], { now: NOW }), "women_only");
    await asUser(db, host, `select public.remove_from_roster($1, $2)`, [s.id, u], { now: NOW });
    await expectSt(asUser(db, u, `select public.join_roster($1)`, [s.invite_token], { now: NOW }), "forbidden");
    await expectSt(asUser(db, host, `select public.remove_from_roster($1, $2)`, [s.id, host], { now: NOW }), "forbidden");
    await asUser(db, host, `select public.end_series($1)`, [ws.id], { now: NOW });
    const w = await makeUser(db, { gender: "female" });
    await expectSt(asUser(db, w, `select public.join_roster($1)`, [ws.invite_token], { now: NOW }), "game_not_open");
  });

  it("leave_roster / set_always_in (regulars only → forbidden) / invite_to_roster requires played-with", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host);
    const u = await makeUser(db);
    await expectSt(asUser(db, u, `select public.set_always_in($1, true)`, [s.id], { now: NOW }), "forbidden");
    await expectSt(asUser(db, u, `select public.leave_roster($1)`, [s.id], { now: NOW }), "not_found");
    await asUser(db, u, `select public.join_roster($1)`, [s.invite_token], { now: NOW });
    const [a] = await asUser<{ always_in: boolean }>(db, u, `select * from public.set_always_in($1, true)`, [s.id], { now: NOW });
    expect(a!.always_in).toBe(true);
    const [l] = await asUser<{ status: string; always_in: boolean }>(db, u, `select * from public.leave_roster($1)`, [s.id], { now: NOW });
    expect(l).toMatchObject({ status: "left", always_in: false });
    const friend = await makeUser(db);
    await expectSt(asUser(db, host, `select public.invite_to_roster($1, $2)`, [s.id, friend], { now: NOW }), "forbidden");
    await db.query(`insert into connections (user_a, user_b, games_together) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 1)`, [host, friend]);
    const [inv] = await asUser<{ status: string }>(db, host, `select * from public.invite_to_roster($1, $2)`, [s.id, friend], { now: NOW });
    expect(inv!.status).toBe("invited");
    await expectSt(asUser(db, u, `select public.invite_to_roster($1, $2)`, [s.id, friend], { now: NOW }), "forbidden");
    const [acc] = await asUser<{ status: string }>(db, friend, `select * from public.accept_roster_invite($1)`, [s.id], { now: NOW });
    expect(acc!.status).toBe("regular");
  });

  it("always-in regulars are auto-joined in seniority order (host holds a seat), overflow waitlisted; deposits never", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host, { capacity: 3, startDate: "2026-11-24" }, NOW); // first slot beyond the horizon
    expect(await occurrences(s.id)).toHaveLength(0);
    const users = [await makeUser(db), await makeUser(db), await makeUser(db)];
    for (const [i, u] of users.entries()) {
      await asUser(db, u, `select public.join_roster($1)`, [s.invite_token], { now: plus(i * MIN) });
      await asUser(db, u, `select public.set_always_in($1, true)`, [s.id], { now: plus(i * MIN) });
    }
    await asService(db, `select public.generate_occurrences()`, [], { now: plus(14 * DAY) });
    const occ = first(await occurrences(s.id));
    const parts = await db.query<{ user_id: string; status: string }>(
      `select user_id, status from game_participants where game_id = $1 and user_id <> $2`, [occ.game_id, host]);
    const by = Object.fromEntries(parts.map((p) => [p.user_id, p.status]));
    expect([by[users[0]!], by[users[1]!], by[users[2]!]]).toEqual(["approved", "approved", "waitlisted"]);
    expect(await db.query(`select 1 from series_auto_joins where game_id = $1`, [occ.game_id])).toHaveLength(3);
  });

  it("T−48h reconfirmation, T−24h release (no card), GAME-011 leave offer after 3 misses; reconfirm keeps the spot", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host, { startDate: "2026-11-24" });
    const keep = await makeUser(db);
    const lapse = await makeUser(db);
    for (const u of [keep, lapse]) {
      await asUser(db, u, `select public.join_roster($1)`, [s.invite_token], { now: NOW });
      await asUser(db, u, `select public.set_always_in($1, true)`, [s.id], { now: NOW });
    }
    await db.query(`update series_roster set consecutive_misses = 2 where user_id = $1`, [lapse]);
    await asService(db, `select public.generate_occurrences()`, [], { now: plus(14 * DAY) });
    const occ = first(await occurrences(s.id));
    const at = (h: number) => new Date(occ.starts_at.getTime() - h * HOUR);
    expect(first(await asService<{ n: number }>(db, `select public.always_in_autojoin() n`, [], { now: at(49) })).n).toBe(0);
    expect(first(await asService<{ n: number }>(db, `select public.always_in_autojoin() n`, [], { now: at(48) })).n).toBe(2);
    expect(first(await asService<{ n: number }>(db, `select public.always_in_autojoin() n`, [], { now: at(47) })).n).toBe(0); // asked once
    const notes = await db.query<{ user_id: string; kind: string }>(`select user_id, kind from notifications where kind = 'series_reconfirm'`);
    expect(notes).toHaveLength(2);
    await asUser(db, keep, `select public.reconfirm_auto_join($1, true)`, [occ.game_id], { now: at(30) });
    await asService(db, `select public.always_in_autojoin()`, [], { now: at(24) });
    const st = async (u: string) => (await db.query<{ status: string; late_cancel: boolean }>(
      `select status, late_cancel from game_participants where game_id = $1 and user_id = $2`, [occ.game_id, u]))[0];
    expect(await st(keep)).toEqual({ status: "approved", late_cancel: false });
    expect(await st(lapse)).toEqual({ status: "cancelled", late_cancel: false });
    expect(await db.query(`select 1 from sanctions where user_id = $1`, [lapse])).toHaveLength(0);
    const [rm] = await db.query<{ consecutive_misses: number; leave_offered_at: Date | null }>(
      `select consecutive_misses, leave_offered_at from series_roster where user_id = $1`, [lapse]);
    expect(rm!.consecutive_misses).toBe(3);
    expect(rm!.leave_offered_at).not.toBeNull();
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'roster_leave_offer'`, [lapse])).toHaveLength(1);
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'series_auto_released'`, [lapse])).toHaveLength(1);
  });

  it("reconfirm_auto_join: false releases before the late window, outside_window inside it; not_found / game_not_open", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host, { startDate: "2026-11-24" });
    const u = await makeUser(db);
    await asUser(db, u, `select public.join_roster($1)`, [s.invite_token], { now: NOW });
    await asUser(db, u, `select public.set_always_in($1, true)`, [s.id], { now: NOW });
    await asService(db, `select public.generate_occurrences()`, [], { now: plus(14 * DAY) });
    const occ = first(await occurrences(s.id));
    const before = (h: number) => new Date(occ.starts_at.getTime() - h * HOUR);
    await expectSt(asUser(db, u, `select public.reconfirm_auto_join($1, false)`, [occ.game_id], { now: before(1) }), "outside_window");
    await expectSt(asUser(db, u, `select public.reconfirm_auto_join($1, true)`, [occ.game_id], { now: before(-1) }), "game_not_open");
    const [p] = await asUser<{ status: string }>(db, u, `select * from public.reconfirm_auto_join($1, false)`, [occ.game_id], { now: before(30) });
    expect(p!.status).toBe("cancelled");
    await expectSt(asUser(db, u, `select public.reconfirm_auto_join($1, true)`, [occ.game_id], { now: before(29) }), "not_found");
    const other = await makeUser(db);
    await expectSt(asUser(db, other, `select public.reconfirm_auto_join($1, true)`, [occ.game_id], { now: before(29) }), "not_found");
  });
});

describe("skip / edit / end", () => {
  it("skip_occurrence: generated → cancelled+notified (skipped), future slot → skipped_dates; conflict, not_found, forbidden", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host);
    const p = await makeUser(db);
    const occ = first(await occurrences(s.id));
    await addParticipant(db, occ.game_id, p, "approved");
    const [r] = await asUser<{ status: string }>(db, host, `select * from public.skip_occurrence($1, $2)`, [s.id, occ.occurrence_key], { now: NOW });
    expect(r!.status).toBe("skipped");
    expect(first(await db.query<{ status: string }>(`select status from games where id = $1`, [occ.game_id])).status).toBe("cancelled");
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'occurrence_skipped'`, [p])).toHaveLength(1);
    expect(await db.query(`select 1 from sanctions where user_id = $1`, [host])).toHaveLength(0); // > 2 h before: no host card
    await expectSt(asUser(db, host, `select public.skip_occurrence($1, $2)`, [s.id, occ.occurrence_key], { now: NOW }), "conflict");
    const future = `${s.id}:0:2026-12-01`;
    const [f] = await asUser<{ status: string; game_id: string }>(db, host, `select * from public.skip_occurrence($1, $2)`, [s.id, future], { now: NOW });
    expect(f!.status).toBe("skipped");
    const [row] = await db.query<{ skipped_dates: string[] }>(`select skipped_dates::text[] from game_series where id = $1`, [s.id]);
    expect(row!.skipped_dates).toEqual(["2026-10-20", "2026-12-01"]);
    await expectSt(asUser(db, host, `select public.skip_occurrence($1, $2)`, [s.id, future], { now: NOW }), "conflict");
    await expectSt(asUser(db, host, `select public.skip_occurrence($1, $2)`, [s.id, `${s.id}:0:2026-12-02`], { now: NOW }), "not_found");
    await expectSt(asUser(db, p, `select public.skip_occurrence($1, $2)`, [s.id, future], { now: NOW }), "forbidden");
    // Skipped slots are never regenerated.
    await asService(db, `select public.generate_occurrences()`, [], { now: plus(50 * DAY) });
    expect((await occurrences(s.id)).filter((o) => o.slot_date === "2026-12-01")).toHaveLength(0);
    expect((await occurrences(s.id)).some((o) => o.slot_date === "2026-12-08")).toBe(true);
  });

  it("skipping inside the late-cancel window with participants is a host late game cancellation (M6)", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host);
    const occ = first(await occurrences(s.id));
    await addParticipant(db, occ.game_id, await makeUser(db), "approved");
    await asUser(db, host, `select public.skip_occurrence($1, $2)`, [s.id, occ.occurrence_key], { now: new Date(occ.starts_at.getTime() - HOUR) });
    const cards = await db.query<{ reason_code: string }>(`select reason_code from sanctions where user_id = $1`, [host]);
    expect(cards.map((c) => c.reason_code)).toEqual(["late_cancel"]);
  });

  it("update_series 'this': edits and marks one occurrence; moving it inside the late window with players → outside_window", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host);
    const [o1, o2] = await occurrences(s.id);
    const p = await makeUser(db);
    await addParticipant(db, o1!.game_id, p, "approved");
    const patch = { title: "Cup night", capacity: 12, startsAt: iso(new Date(o1!.starts_at.getTime() + HOUR)) };
    await asUser(db, host, `select public.update_series($1, 'this', $2, $3::jsonb)`, [s.id, o1!.occurrence_key, JSON.stringify(patch)], { now: NOW });
    const [g] = await db.query<{ title: string; capacity: number; starts_at: Date }>(`select title, capacity, starts_at from games where id = $1`, [o1!.game_id]);
    expect(g).toMatchObject({ title: "Cup night", capacity: 12 });
    expect(iso(g!.starts_at)).toBe(patch.startsAt);
    const [o] = await db.query<{ overridden: boolean; reconfirm_at: Date }>(`select overridden, reconfirm_at from series_occurrences where occurrence_key = $1`, [o1!.occurrence_key]);
    expect(o!.overridden).toBe(true);
    expect(iso(o!.reconfirm_at)).toBe(iso(new Date(Date.parse(patch.startsAt) - 48 * HOUR)));
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'occurrence_updated'`, [p])).toHaveLength(1);
    expect(first(await db.query<{ title: string }>(`select title from games where id = $1`, [o2!.game_id])).title).toBe("Tuesday 5-a-side");
    const late = new Date(Date.parse(patch.startsAt) - HOUR);
    await expectSt(asUser(db, host, `select public.update_series($1, 'this', $2, $3::jsonb)`,
      [s.id, o1!.occurrence_key, JSON.stringify({ startsAt: iso(new Date(Date.parse(patch.startsAt) + HOUR)) })], { now: late }), "outside_window");
    await expectSt(asUser(db, host, `select public.update_series($1, 'this', $2, $3::jsonb)`,
      [s.id, o1!.occurrence_key, JSON.stringify({ weekday: 3 })], { now: NOW }), "validation");
    await expectSt(asUser(db, p, `select public.update_series($1, 'this', $2, '{}'::jsonb)`, [s.id, o1!.occurrence_key], { now: NOW }), "forbidden");
    await expectSt(asUser(db, host, `select public.update_series($1, 'this', 'nope', '{}'::jsonb)`, [s.id], { now: NOW }), "not_found");
  });

  it("update_series 'following' with a schedule change reschedules: revision + 1, later occurrences cancelled and regenerated", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host);
    const before = await occurrences(s.id);
    const p = await makeUser(db);
    await addParticipant(db, before[1]!.game_id, p, "approved");
    const [v] = await asUser<{ schedule_revision: number; weekday: number; anchor_date: string }>(db, host,
      `select schedule_revision, weekday, anchor_date::text from public.update_series($1, 'following', $2, $3::jsonb)`,
      [s.id, before[1]!.occurrence_key, JSON.stringify({ weekday: 4, startTime: "19:00" })], { now: NOW });
    expect(v).toEqual({ schedule_revision: 1, weekday: 4, anchor_date: "2026-10-29" });
    const after = await occurrences(s.id);
    const live = after.filter((o) => o.status === "scheduled");
    // Horizon: (now, now + 4 weeks] → 2026-11-12 19:00 IST is beyond 2026-11-11 12:00Z.
    expect(live.map((o) => o.occurrence_key)).toEqual([before[0]!.occurrence_key, `${s.id}:1:2026-10-29`, `${s.id}:1:2026-11-05`]);
    expect(iso(live[1]!.starts_at)).toBe("2026-10-29T17:00:00.000Z"); // 19:00 IST (+2)
    // Only the occurrence someone had joined stays as cancelled; never-joined ones are hard-deleted (security review #2 M4).
    expect(after.filter((o) => o.status === "cancelled").map((o) => o.slot_date)).toEqual(["2026-10-27"]);
    expect(await db.query(`select 1 from games where id = $1`, [before[2]!.game_id])).toHaveLength(0);
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'occurrence_rescheduled'`, [p])).toHaveLength(1);
    // Template-only edit on the following ones (no reschedule): titles change, no new revision.
    await asUser(db, host, `select public.update_series($1, 'following', $2, $3::jsonb)`,
      [s.id, live[2]!.occurrence_key, JSON.stringify({ title: "Thursday 5-a-side" })], { now: NOW });
    const titles = await db.query<{ title: string }>(`select g.title from series_occurrences o join games g on g.id = o.game_id
      where o.series_id = $1 and o.status = 'scheduled' order by o.starts_at`, [s.id]);
    expect(titles.map((t) => t.title)).toEqual(["Tuesday 5-a-side", "Tuesday 5-a-side", "Thursday 5-a-side"]);
  });

  it("end_series cancels later occurrences and stops generation; conflict when already ended", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host);
    const [v] = await asUser<{ status: string }>(db, host, `select status from public.end_series($1)`, [s.id], { now: NOW });
    expect(v!.status).toBe("ended");
    expect((await occurrences(s.id)).every((o) => o.status === "cancelled")).toBe(true);
    await asService(db, `select public.generate_occurrences()`, [], { now: plus(30 * DAY) });
    expect((await occurrences(s.id)).every((o) => o.status === "cancelled")).toBe(true);
    await expectSt(asUser(db, host, `select public.end_series($1)`, [s.id], { now: NOW }), "conflict");
  });

  it("generation pauses while the host is suspended and resumes afterwards", async () => {
    const host = await makeUser(db);
    const s = await createSeries(host, { startDate: "2026-11-24" });
    await db.query(`update profiles set host_suspended_until = $2 where id = $1`, [host, iso(plus(20 * DAY))]);
    await asService(db, `select public.generate_occurrences()`, [], { now: plus(14 * DAY) });
    expect(await occurrences(s.id)).toHaveLength(0);
    await asService(db, `select public.generate_occurrences()`, [], { now: plus(21 * DAY) });
    expect((await occurrences(s.id)).length).toBeGreaterThan(0);
  });
});

describe("RLS: series reads", () => {
  it("series_views masks location and invite token; private series are invisible to outsiders", async () => {
    const host = await makeUser(db);
    const pub = await createSeries(host, { hideExactLocation: true });
    const priv = await createSeries(host, { visibility: "private", title: "Private" });
    const stranger = await makeUser(db);
    const rows = await asUser<{ id: string; lat: number | null; approx_lat: number; invite_token: string | null }>(db, stranger,
      `select id, lat, approx_lat, invite_token from series_views`, [], { now: NOW });
    expect(rows.map((r) => r.id)).toEqual([pub.id]);
    expect(rows[0]).toMatchObject({ lat: null, invite_token: null });
    const own = await asUser<{ invite_token: string | null; lat: number | null }>(db, host,
      `select invite_token, lat from series_views where id = $1`, [priv.id], { now: NOW });
    expect(own[0]!.invite_token).toBe(priv.invite_token);
    await expect(asUser(db, stranger, `select geog from game_series`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, stranger, `select invite_token from game_series`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, host, `update game_series set title = 'x'`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, stranger, `insert into series_roster (series_id, user_id, joined_via) values ($1, $2, 'host')`, [pub.id, stranger]))
      .rejects.toThrow(/permission denied/);
    // A game made with the fixtures (no series) is unaffected.
    const g = await makeGame(db, host);
    expect(await asUser(db, stranger, `select id from game_views where id = $1 and series_id is null`, [g], { now: NOW })).toHaveLength(1);
  });
});
