/**
 * Invite links and WhatsApp migration (PRD §5.4, GAME-030) — including the anon rich preview privacy
 * guarantees — and the network (played-with, friends, privacy, friends' upcoming games).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { addParticipant, asService, asUser, at, DAY, expectSt, first, HOUR, iso, makeGame, makeUser, makeVenue, T0 } from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

const before = { now: at(-DAY) };
const PREVIEW_KEYS = ["areaLabel", "capacity", "hostDisplayName", "localStartTime", "ogImageUrl", "recurrence", "sport", "spotsLeft",
  "startsAt", "timeZone", "title", "weekday", "womenOnly"];
const tokenOf = async (gameId: string) =>
  first(await db.query<{ invite_token: string }>(`select invite_token from games where id = $1`, [gameId])).invite_token;
const preview = async (token: string, now = at(-DAY)) =>
  first(await db.asAnon(async (tx) => (await tx.query<{ p: Record<string, unknown> | null }>(
    `select public.get_invite_preview($1) p`, [token])).rows, { now })).p;

describe("get_invite_preview (anon)", () => {
  it("public game: safe public fields only (no coordinates, no address of hidden games, no phone)", async () => {
    const host = await makeUser(db, { name: "Avi" });
    const venue = await makeVenue(db, { name: "Yarkon Pitch 3" });
    const g = await makeGame(db, host, { venueId: venue, capacity: 10 });
    await addParticipant(db, g, await makeUser(db));
    const p = (await preview(await tokenOf(g)))!;
    expect(Object.keys(p).sort()).toEqual(PREVIEW_KEYS);
    expect(p).toMatchObject({ sport: "football", title: "Pickup", areaLabel: "Yarkon Pitch 3", spotsLeft: 8, capacity: 10,
      womenOnly: false, hostDisplayName: "Avi", startsAt: iso(T0), recurrence: null, ogImageUrl: null });
    const phone = first(await db.query<{ phone: string }>(`select phone from profile_private where user_id = $1`, [host])).phone;
    expect(JSON.stringify(p)).not.toContain(phone);
    expect(JSON.stringify(p)).not.toMatch(/32\.07|34\.77|lat|lng/);
  });

  it("never exposes the exact location of hidden, private or women-only games (no venue/area label)", async () => {
    const host = await makeUser(db, { gender: "female" });
    const venue = await makeVenue(db, { name: "Secret Court" });
    const cases = [
      await makeGame(db, host, { venueId: venue, hideExactLocation: true }),
      await makeGame(db, host, { venueId: venue, visibility: "private" }),
      await makeGame(db, host, { venueId: venue, womenOnly: true, hideExactLocation: false }),
    ];
    for (const g of cases) {
      const p = (await preview(await tokenOf(g)))!;
      expect(p.areaLabel).toBeNull();
      expect(JSON.stringify(p)).not.toContain("Secret Court");
      expect(JSON.stringify(p)).not.toMatch(/32\.07|34\.77/);
    }
  });

  it("null for unknown, malformed, rotated, cancelled, ended games and hidden (banned) hosts", async () => {
    const host = await makeUser(db);
    const g = await makeGame(db, host);
    const tok = await tokenOf(g);
    expect(await preview("0".repeat(36))).toBeNull();
    expect(await preview("'; select 1 --")).toBeNull();
    expect(await preview(tok, at(3 * HOUR))).toBeNull(); // ended
    const [newTok] = await asUser<{ t: string }>(db, host, `select public.rotate_invite_link('game', $1) t`, [g], before);
    expect(await preview(tok)).toBeNull();
    expect(await preview(newTok!.t)).not.toBeNull();
    await db.query(`update profiles set permanently_banned = true where id = $1`, [host]);
    expect(await preview(newTok!.t)).toBeNull();
    await db.query(`update profiles set permanently_banned = false where id = $1`, [host]);
    await db.query(`update games set status = 'cancelled' where id = $1`, [g]);
    expect(await preview(newTok!.t)).toBeNull();
  });

  it("series link: next occurrence, local weekday/time and zone; one-off games carry their zone too", async () => {
    const host = await makeUser(db);
    const now = new Date("2026-10-14T12:00:00Z");
    const [s] = await asUser<{ invite_token: string }>(db, host, `select invite_token from public.create_series($1::jsonb)`, [JSON.stringify({
      sport: "basketball", title: "Hoops", visibility: "public", venueId: null, location: { lat: 51.5, lng: -0.12 },
      hideExactLocation: false, capacity: 10, depositMinor: 0, currency: "GBP", womenOnly: false, teamCount: 2,
      recurrence: "weekly", weekday: 4, startTime: "19:30", timeZone: "Europe/London", durationMinutes: 60, startDate: "2026-10-15" })],
    { now });
    const p = (await preview(s!.invite_token, now))!;
    expect(p).toMatchObject({ sport: "basketball", recurrence: "weekly", weekday: 4, localStartTime: "19:30",
      timeZone: "Europe/London", startsAt: "2026-10-15T18:30:00.000Z", spotsLeft: 9, areaLabel: null });
    const [g] = await asUser<{ id: string }>(db, host,
      `select id from public.create_game('football', 'One-off', 'public', null, 32.08, 34.78, null, 10, $1, $2,
                                         p_time_zone => 'Asia/Jerusalem')`, [iso(T0), iso(at(HOUR))], before);
    expect((await preview(await tokenOf(g!.id)))!.timeZone).toBe("Asia/Jerusalem");
    await expectSt(asUser(db, host, `select public.create_game('football', 'x', 'public', null, 32.08, 34.78, null, 10, $1, $2,
      p_time_zone => 'Not/AZone')`, [iso(T0), iso(at(HOUR))], before), "validation");
  });
});

describe("migration stats and rotation", () => {
  it("counts link joins (game token via request_join, series via join_roster) for the host only", async () => {
    const host = await makeUser(db);
    const g = await makeGame(db, host, { visibility: "private" });
    const tok = await tokenOf(g);
    const a = await makeUser(db);
    const b = await makeUser(db);
    for (const u of [a, b]) await asUser(db, u, `select public.request_join($1, null, $2)`, [g, tok], before);
    await db.query(`update game_participants set status = 'approved', attendance = 'verified', check_in_method = 'qr', checked_in_at = $3
                    where game_id = $1 and user_id = $2`, [g, a, iso(T0)]);
    const [st] = await asUser<{ s: Record<string, unknown> }>(db, host, `select public.migration_stats('game', $1) s`, [g], before);
    expect(st!.s).toMatchObject({ target: { kind: "game", gameId: g }, joinedFromLink: 2, activeFromLink: 1, rosterSize: 0, totalMembers: 1 });
    await expectSt(asUser(db, a, `select public.migration_stats('game', $1)`, [g], before), "forbidden");
    await expectSt(asUser(db, a, `select public.rotate_invite_link('game', $1)`, [g], before), "forbidden");
    await expectSt(asUser(db, host, `select public.rotate_invite_link('team', $1)`, [g], before), "validation");
  });
});

describe("network: played-with, friends, privacy", () => {
  async function played(...users: string[]) {
    const host = users[0]!;
    const g = await makeGame(db, host, { startsAt: at(-3 * DAY), endsAt: at(-3 * DAY + HOUR) });
    await db.query(`update game_participants set attendance = 'verified', check_in_method = 'qr', checked_in_at = $2 where game_id = $1`,
      [g, iso(at(-3 * DAY))]);
    for (const u of users.slice(1)) await addParticipant(db, g, u, "approved", { attendance: "verified" });
    return g;
  }

  it("derive_played_with: co-verified pairs within the lookback, blocked pairs excluded, idempotent", async () => {
    const [a, b, c] = [await makeUser(db), await makeUser(db), await makeUser(db)];
    await played(a, b, c);
    await played(a, b);
    await db.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [c, a]);
    expect(first(await asService<{ n: number }>(db, `select public.derive_played_with() n`, [], { now: T0 })).n).toBe(2);
    const rows = await db.query<{ ua: string; ub: string; n: number }>(
      `select user_a ua, user_b ub, games_together n from connections order by games_together desc`);
    const pair = (x: string, y: string) => rows.find((r) => [r.ua, r.ub].sort().join() === [x, y].sort().join());
    expect(pair(a, b)!.n).toBe(2);
    expect(pair(b, c)!.n).toBe(1);
    expect(pair(a, c)).toBeUndefined();
    expect(first(await asService<{ n: number }>(db, `select public.derive_played_with() n`, [], { now: T0 })).n).toBe(2);
    // Outside the 365-day lookback the counters drop to zero.
    await asService(db, `select public.derive_played_with()`, [], { now: at(400 * DAY) });
    expect(await db.query(`select 1 from connections`)).toHaveLength(0);
  });

  it("friend state machine: forbidden without playing, request → conflict, mutual auto-accept, decline, remove, blocks", async () => {
    const [a, b, s] = [await makeUser(db), await makeUser(db), await makeUser(db)];
    await expectSt(asUser(db, a, `select public.request_friend($1)`, [s], { now: T0 }), "forbidden");
    await expectSt(asUser(db, a, `select public.request_friend($1)`, [a], { now: T0 }), "validation");
    await played(a, b);
    await asService(db, `select public.derive_played_with()`, [], { now: T0 });
    const [r] = await asUser<{ v: { friend: string; playedWith: boolean } }>(db, a, `select public.request_friend($1) v`, [b], { now: T0 });
    expect(r!.v).toMatchObject({ friend: "outgoing", playedWith: true });
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'friend_request'`, [b])).toHaveLength(1);
    await expectSt(asUser(db, a, `select public.request_friend($1)`, [b], { now: T0 }), "conflict");
    await expectSt(asUser(db, a, `select public.respond_friend($1, true)`, [b], { now: T0 }), "not_found");
    const [m] = await asUser<{ v: { friend: string } }>(db, b, `select public.request_friend($1) v`, [a], { now: T0 }); // mutual
    expect(m!.v.friend).toBe("friends");
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'friend_accepted'`, [a])).toHaveLength(1);
    await asUser(db, a, `select public.remove_friend($1)`, [b], { now: T0 });
    await expectSt(asUser(db, a, `select public.remove_friend($1)`, [b], { now: T0 }), "not_found");
    await asUser(db, a, `select public.request_friend($1)`, [b], { now: T0 });
    const [d] = await asUser<{ v: { friend: string } }>(db, b, `select public.respond_friend($1, false) v`, [a], { now: T0 });
    expect(d!.v.friend).toBe("none");
    // 30-day cooldown for the pair after a decline (security review #2 M2).
    await expectSt(asUser(db, a, `select public.request_friend($1)`, [b], { now: at(DAY) }), "rate_limited");
    const later = { now: at(31 * DAY) };
    // A block deletes the friendship and prevents (re)requests; the pair is hidden from both lists.
    await asUser(db, a, `select public.request_friend($1)`, [b], later);
    await asUser(db, b, `select public.respond_friend($1, true)`, [a], later);
    await asUser(db, a, `select public.block_user($1)`, [b], later);
    expect(first(await db.query<{ f: string | null }>(`select friend_status::text f from connections`)).f).toBeNull();
    await expectSt(asUser(db, b, `select public.request_friend($1)`, [a], later), "blocked");
    expect(await asUser(db, a, `select * from public.list_network('all')`, [], later)).toHaveLength(0);
    expect(await asUser(db, b, `select * from connections`, [], later)).toHaveLength(0);
  });

  it("friends_upcoming_games: friends' public games only, privacy respected, location masked, blocked hosts hidden", async () => {
    const [me, friend, host2] = [await makeUser(db), await makeUser(db), await makeUser(db, { gender: "female" })];
    await db.query(`insert into connections (user_a, user_b, games_together, friend_status, friend_requested_by, friend_requested_at, friend_accepted_at)
                    values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 1, 'accepted', $1, now(), now())`, [me, friend]);
    const pub = await makeGame(db, friend, { title: "Friend's public" });
    const priv = await makeGame(db, friend, { visibility: "private", title: "Friend's private" });
    const women = await makeGame(db, host2, { womenOnly: true, hideExactLocation: true, title: "Women-only" });
    await addParticipant(db, women, friend);
    const list = async () => (await asUser<{ g: { friend: { id: string }; game: Record<string, unknown> } }>(db, me,
      `select g from public.friends_upcoming_games() g`, [], before)).map((r) => r.g);
    const got = await list();
    expect(got.map((x) => x.game.title).sort()).toEqual(["Friend's public", "Women-only"]);
    expect(got.map((x) => x.game.id)).not.toContain(priv);
    const w = got.find((x) => x.game.title === "Women-only")!;
    expect(w.game.lat).toBeNull();
    expect(w.game.venue_id).toBeNull();
    expect(w.game.approx_lat).not.toBeNull();
    expect(got.find((x) => x.game.id === pub)!.friend.id).toBe(friend);
    await db.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [host2, me]);
    expect((await list()).map((x) => x.game.title)).toEqual(["Friend's public"]);
    const [p] = await asUser<{ v: { upcomingGamesVisibleTo: string } }>(db, friend, `select public.set_network_privacy('nobody') v`, [], before);
    expect(p!.v.upcomingGamesVisibleTo).toBe("nobody");
    expect(await list()).toEqual([]);
    const [def] = await asUser<{ v: { upcomingGamesVisibleTo: string } }>(db, me, `select public.get_network_privacy() v`, [], before);
    expect(def!.v.upcomingGamesVisibleTo).toBe("friends");
  });
});

describe("account deletion covers Phase 1.5 data (GDPR Art. 17)", () => {
  it("hosted series end; roster, auto-joins, invite joins, ratings, connections and privacy rows go", async () => {
    const host = await makeUser(db);
    const now = new Date("2026-10-14T12:00:00Z");
    const [s] = await asUser<{ id: string; invite_token: string }>(db, host, `select id, invite_token from public.create_series($1::jsonb)`, [JSON.stringify({
      sport: "football", title: "W", visibility: "public", venueId: null, location: { lat: 32.08, lng: 34.78 }, hideExactLocation: false,
      capacity: 10, depositMinor: 0, currency: "ILS", womenOnly: false, teamCount: 2, recurrence: "weekly", weekday: 2, startTime: "20:00",
      timeZone: "Asia/Jerusalem", durationMinutes: 90, startDate: "2026-10-20" })], { now });
    const u = await makeUser(db);
    await asUser(db, u, `select public.join_roster($1)`, [s!.invite_token], { now });
    const g = await makeGame(db, host);
    await db.query(`insert into skill_ratings (user_id, sport, format_family, r, rd, sigma) values ($1, 'football', 'small_sided', 1500, 350, 0.06)`, [u]);
    await db.query(`insert into peer_ratings (game_id, rater_id, ratee_id, sport, scores) values ($1, $2, $3, 'football', '{"overall":3}')`, [g, host, u]);
    await db.query(`insert into connections (user_a, user_b, games_together) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 2)`, [host, u]);
    await db.query(`insert into network_privacy (user_id) values ($1)`, [u]);
    await asUser(db, u, `select public.delete_my_account()`, [], { now });
    for (const t of ["series_roster", "invite_joins", "skill_ratings", "network_privacy"]) {
      expect(await db.query(`select 1 from ${t} where user_id = $1`, [u]), t).toHaveLength(0);
    }
    expect(await db.query(`select 1 from peer_ratings where ratee_id = $1`, [u])).toHaveLength(0);
    expect(await db.query(`select 1 from connections where user_a = $1 or user_b = $1`, [u])).toHaveLength(0);
    await asUser(db, host, `select public.delete_my_account()`, [], { now });
    const [row] = await db.query<{ status: string; invite_token: string | null }>(`select status, invite_token from game_series where id = $1`, [s!.id]);
    expect(row).toEqual({ status: "ended", invite_token: null });
    expect(await db.query(`select 1 from series_occurrences where series_id = $1 and status = 'scheduled'`, [s!.id])).toHaveLength(0);
  });
});
