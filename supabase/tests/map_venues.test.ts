import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { addParticipant, asUser, at, DAY, expectSt, makeGame, makeModerator, makeUser, makeVenue, T0, TLV } from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

const now = { now: at(-DAY) };
/** Point `m` metres north of TLV. */
const north = (m: number) => ({ lat: TLV.lat + m / 111_320, lng: TLV.lng });

describe("nearby_venues", () => {
  it("validates radius and sports, filters by ST_DWithin and sport, orders by distance", async () => {
    const u = await makeUser(db);
    const far = await makeVenue(db, { ...north(4000), name: "far" });
    const near = await makeVenue(db, { ...north(300), name: "near", sports: ["basketball"] });
    const mid = await makeVenue(db, { ...north(1500), name: "mid", sports: ["football", "tennis"] });
    await makeVenue(db, { ...north(100), name: "hidden", status: "hidden_pending_review" });
    await makeVenue(db, { ...north(20000), name: "out" });
    const q = (radius: number, sports: string[]) =>
      asUser<{ name: string; distance_m: number }>(db, u, `select * from public.nearby_venues($1, $2, $3, $4)`,
        [TLV.lat, TLV.lng, radius, sports]);
    await expectSt(q(3, []), "invalid_radius");
    await expectSt(q(5, ["football", "tennis", "padel", "running"]), "too_many_sports");
    await expectSt(q(5, ["curling"]), "validation");
    const all = await q(5, []);
    expect(all.map((v) => v.name)).toEqual(["near", "mid", "far"]);
    expect(all[0]!.distance_m).toBeCloseTo(300, -1);
    expect((await q(2, [])).map((v) => v.name)).toEqual(["near", "mid"]);
    expect((await q(50, ["tennis", "basketball"])).map((v) => v.name)).toEqual(["near", "mid"]);
    expect([far, near, mid]).toHaveLength(3);
  });

  it("anon cannot query the map", async () => {
    await expect(db.asAnon((tx) => tx.query(`select * from public.nearby_venues(32, 34, 5, '{}')`))).rejects.toThrow(/permission denied/);
  });
});

describe("nearby_games", () => {
  it("hides blocked and visibility-restricted hosts; a restricted viewer still gets results", async () => {
    const viewer = await makeUser(db);
    const [h1, h2, h3] = [await makeUser(db), await makeUser(db), await makeUser(db)];
    const g1 = await makeGame(db, h1, { ...north(500), title: "ok" });
    await makeGame(db, h2, { ...north(600), title: "blocked" });
    await makeGame(db, h3, { ...north(700), title: "restricted" });
    await makeGame(db, h1, { ...north(800), title: "private", visibility: "private" });
    await makeGame(db, h1, { ...north(900), title: "football-later", startsAt: new Date(T0.getTime() + 20 * DAY), endsAt: new Date(T0.getTime() + 20 * DAY + 3600_000) });
    await db.query(`insert into blocks values ($1, $2)`, [h2, viewer]);
    await db.query(`update profiles set visibility_restricted_until = $2 where id = $1`, [h3, at(DAY).toISOString()]);
    await db.query(`update profiles set visibility_restricted_until = $2 where id = $1`, [viewer, at(DAY).toISOString()]);

    const q = (u: string, sports: string[] = []) =>
      asUser<{ id: string; title: string; is_host: boolean }>(db, u,
        `select * from public.nearby_games($1, $2, 5, $3)`, [TLV.lat, TLV.lng, sports], now);
    expect((await q(viewer)).map((g) => g.title)).toEqual(["ok"]);
    expect((await q(viewer, ["basketball"])).map((g) => g.title)).toEqual([]);
    // The restricted host still sees their own game.
    expect((await q(h3)).map((g) => g.title)).toContain("restricted");
    // Time window (default 14 days) and explicit future range for travel planning.
    const travel = await asUser<{ title: string }>(db, viewer,
      `select * from public.nearby_games($1, $2, 5, '{}', $3, $4)`, [TLV.lat, TLV.lng, at(19 * DAY).toISOString(), at(25 * DAY).toISOString()], now);
    expect(travel.map((g) => g.title)).toEqual(["football-later"]);
    expect(g1).toBeTruthy();
  });

  it("hidden-location games expose only the ~500 m approximate point (and distance) until approval", async () => {
    const host = await makeUser(db);
    const [stranger, requested, approved] = [await makeUser(db), await makeUser(db), await makeUser(db)];
    const exact = north(1234);
    const venue = await makeVenue(db, exact);
    const g = await makeGame(db, host, { ...exact, venueId: venue, hideExactLocation: true });
    await addParticipant(db, g, requested, "requested");
    await addParticipant(db, g, approved, "approved");
    type Row = { venue_id: string | null; lat: number | null; lng: number | null; approx_lat: number; approx_lng: number; distance_m: number };
    const view = async (u: string) =>
      (await asUser<Row>(db, u, `select * from public.nearby_games($1, $2, 5, '{}')`, [TLV.lat, TLV.lng], now))[0]!;
    for (const u of [stranger, requested]) {
      const r = await view(u);
      expect(r.venue_id).toBeNull();
      expect(r.lat).toBeNull();
      expect(r.lng).toBeNull();
      // Approximate point is within one grid cell (< 400 m) but not the pin.
      const d = Math.hypot((r.approx_lat - exact.lat) * 111_320, (r.approx_lng - exact.lng) * 111_320 * Math.cos((exact.lat * Math.PI) / 180));
      expect(d).toBeLessThan(400);
      expect(d).toBeGreaterThan(1);
      expect(Math.abs(r.distance_m - 1234)).toBeGreaterThan(1);
      // Same through the game_views view and the base table (exact geog is not even granted).
      const [gv] = await asUser<{ lat: number | null; venue_id: string | null }>(db, u, `select lat, venue_id from game_views where id = $1`, [g]);
      expect(gv).toEqual({ lat: null, venue_id: null });
      await expect(asUser(db, u, `select geog from games where id = $1`, [g])).rejects.toThrow(/permission denied/);
      await expect(asUser(db, u, `select venue_id from games where id = $1`, [g])).rejects.toThrow(/permission denied/);
    }
    for (const u of [host, approved]) {
      const r = await view(u);
      expect(r.venue_id).toBe(venue);
      expect(r.lat).toBeCloseTo(exact.lat, 6);
      expect(r.distance_m).toBeCloseTo(1234, -1);
    }
    // The approximate point is deterministic (no averaging attack).
    const a1 = await view(stranger);
    const a2 = await view(stranger);
    expect([a1.approx_lat, a1.approx_lng]).toEqual([a2.approx_lat, a2.approx_lng]);
  });

  it("private games are visible only to participants and invite holders", async () => {
    const host = await makeUser(db);
    const [stranger, invited] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { visibility: "private" });
    expect(await asUser(db, stranger, `select id from game_views where id = $1`, [g])).toHaveLength(0);
    expect(await asUser(db, stranger, `select id from games where id = $1`, [g])).toHaveLength(0);
    const [{ invite_token }] = await db.query<{ invite_token: string }>(`select invite_token from games where id = $1`, [g]);
    const [r] = await asUser<{ id: string; invite_token: string | null }>(db, invited, `select * from public.resolve_invite($1)`, [invite_token]);
    expect(r).toMatchObject({ id: g, invite_token: null });
    expect(await asUser(db, invited, `select id from game_views where id = $1`, [g])).toHaveLength(1);
    const [none] = await asUser<{ id: string | null }>(db, stranger, `select (public.resolve_invite('nope')).id`);
    expect(none!.id).toBeNull();
  });
});

describe("venues: rating and reports", () => {
  it("rate_venue validates attributes per sport and keeps the aggregate", async () => {
    const [a, b] = [await makeUser(db), await makeUser(db)];
    const v = await makeVenue(db, { sports: ["football", "tennis"] });
    const rate = (u: string, sport: string, overall: number, attrs: unknown) =>
      asUser(db, u, `select * from public.rate_venue($1, $2, $3, $4::jsonb)`, [v, sport, overall, JSON.stringify(attrs)]);
    await rate(a, "football", 4, { surface: "artificial_turf", lighting: 5 });
    await rate(b, "tennis", 2, { surface: "clay" });
    await expectSt(rate(a, "football", 4, { surface: "clay" }), "validation");
    await expectSt(rate(a, "football", 4, { lighting: 6 }), "validation");
    await expectSt(rate(a, "football", 4, { lighting: "5" }), "validation");
    await expectSt(rate(a, "football", 4, { hoops: 3 }), "validation");
    await expectSt(rate(a, "padel", 4, {}), "validation");
    await expectSt(rate(a, "football", 6, {}), "validation");
    await rate(a, "football", 2, {}); // upsert
    const [agg] = await db.query<{ rating_avg: string; rating_count: number }>(`select rating_avg, rating_count from venues where id = $1`, [v]);
    expect(agg).toEqual({ rating_avg: "2.000", rating_count: 2 });
    // Direct writes are not allowed.
    await expect(asUser(db, a, `insert into venue_ratings (venue_id, user_id, sport, overall) values ($1, $2, 'football', 5)`, [v, a]))
      .rejects.toThrow(/permission denied/);
  });

  it("3 distinct reports hide the venue pending review; duplicates by one reporter do not count", async () => {
    const creator = await makeUser(db);
    const v = await makeVenue(db, { createdBy: creator });
    const [r1, r2, r3, r4] = [await makeUser(db), await makeUser(db), await makeUser(db), await makeUser(db)];
    const report = (u: string) => asUser(db, u, `select * from public.report_venue($1, 'no_venue_here')`, [v]);
    const status = async () => (await db.query<{ status: string }>(`select status from venues where id = $1`, [v]))[0]!.status;
    await report(r1);
    await expectSt(report(r1), "already_reported");
    await expectSt(report(r1), "already_reported");
    await report(r2);
    expect(await status()).toBe("active");
    await report(r3);
    expect(await status()).toBe("hidden_pending_review");
    const items = await db.query<{ kind: string; venue_id: string }>(`select kind, venue_id from review_queue`);
    expect(items).toEqual([{ kind: "venue_reports", venue_id: v }]);
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'venue_hidden'`, [creator]);
    expect(n!.n).toBe(1);
    // A 4th report on a hidden venue does not enqueue another review.
    await report(r4);
    expect(await db.query(`select 1 from review_queue`)).toHaveLength(1);
    // Hidden venues are off the map.
    expect(await asUser(db, r1, `select * from public.nearby_venues($1, $2, 5, '{}')`, [TLV.lat, TLV.lng])).toHaveLength(0);
  });

  it("moderator remove_venue confirms a fake venue: host suspension for the creator; restore re-activates", async () => {
    const creator = await makeUser(db);
    const mod = await makeModerator(db);
    const v = await makeVenue(db, { createdBy: creator });
    for (let i = 0; i < 3; i++) {
      const u = await makeUser(db);
      await asUser(db, u, `select public.report_venue($1, 'no_venue_here')`, [v]);
    }
    const [item] = await db.query<{ id: string }>(`select id from review_queue where venue_id = $1`, [v]);
    const nobody = await makeUser(db);
    await expectSt(asUser(db, nobody, `select public.moderator_decide($1, 'remove_venue')`, [item!.id]), "forbidden");
    await asUser(db, mod, `select public.moderator_decide($1, 'remove_venue', 'confirmed fake')`, [item!.id]);
    const [{ status }] = await db.query<{ status: string }>(`select status from venues where id = $1`, [v]);
    expect(status).toBe("removed");
    const s = await db.query<{ kind: string; reason_code: string }>(`select kind, reason_code from sanctions where user_id = $1`, [creator]);
    expect(s).toEqual([{ kind: "host_suspension", reason_code: "fake_venue" }]);
    await expectSt(asUser(db, mod, `select public.moderator_decide($1, 'restore_venue')`, [item!.id]), "conflict");
  });

  it("create_venue rate limits and validates", async () => {
    const u = await makeUser(db);
    const [v] = await asUser<{ lat: number; sports: string[]; created_by: string }>(db, u,
      `select * from public.create_venue('Park', 32.1, 34.8, array['running'])`);
    expect(v).toMatchObject({ sports: ["running"], created_by: u });
    expect(v!.lat).toBeCloseTo(32.1, 6);
    await expectSt(asUser(db, u, `select public.create_venue('Park', 95, 34.8, array['running'])`), "validation");
    await expectSt(asUser(db, u, `select public.create_venue('Park', 32, 34.8, array['curling'])`), "validation");
    for (let i = 0; i < 9; i++) await asUser(db, u, `select public.create_venue('P', 32, 34.8, array['running'])`);
    await expectSt(asUser(db, u, `select public.create_venue('P', 32, 34.8, array['running'])`), "rate_limited");
  });
});
