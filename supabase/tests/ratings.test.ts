/**
 * Result confirmation (GAME-071), Glicko-2 rating periods (GLK-001..004, AC-GLK-003/004), peer ratings
 * (RATE-001..005, AC-RATE-002) and their privacy (never public, never used for sanctions), plus a
 * TS ≡ SQL fuzz of the Glicko-2 update to 1e-6.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { glicko2Update, processRatingPeriod, resolveDomainConfig, type SkillRating } from "@st/domain";
import { createHarness, type Harness } from "./harness";
import { addParticipant, asService, asUser, at, DAY, expectSt, first, HOUR, iso, makeGame, makeUser, MIN, T0 } from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

// T0 = Monday 2026-11-02 18:00Z → ISO week 2026-W45 (ends 2026-11-09T00:00Z); processed ≥ 48 h later.
const PERIOD = "2026-W45";
const AFTER_PERIOD = new Date("2026-11-11T01:00:00.000Z");
const END = at(90 * MIN);

/** 10 approved (host + 9) on two teams; `verified` of them checked in; result 3–1 by the host. */
async function ratedGame(verified: number, opts: { confirm?: boolean; publishTeams?: boolean; reliability?: (i: number) => number | null } = {}) {
  const host = await makeUser(db);
  const g = await makeGame(db, host, { capacity: 10 });
  const users = [host];
  for (let i = 1; i < 10; i++) {
    const u = await makeUser(db);
    users.push(u);
    await addParticipant(db, g, u, "approved");
  }
  for (const [i, u] of users.entries()) {
    await db.query(`update game_participants set team = $3 where game_id = $1 and user_id = $2`, [g, u, i % 2]);
    if (i < verified) {
      await db.query(`update game_participants set attendance = 'verified', check_in_method = 'qr', checked_in_at = $3
                      where game_id = $1 and user_id = $2`, [g, u, iso(T0)]);
    }
    const rel = opts.reliability ? opts.reliability(i) : 0.9;
    await db.query(`update profiles set reliability_score = $2 where id = $1`, [u, rel]);
  }
  if (opts.publishTeams ?? true) await db.query(`update games set teams_published_at = $2 where id = $1`, [g, iso(at(-HOUR))]);
  await db.query(`insert into game_results (game_id, team_scores, submitted_by, submitted_at, game_ends_at) values ($1, '{3,1}', $2, $3, $3)`,
    [g, host, iso(END)]);
  if (opts.confirm ?? true) {
    for (const u of users.slice(0, Math.min(verified, 5))) {
      await db.query(`insert into result_confirmations (game_id, user_id, verdict) values ($1, $2, 'confirm')`, [g, u]);
    }
  }
  await db.query(`update games set status = 'completed', happened = true where id = $1`, [g]);
  return { g, host, users };
}

describe("result confirmation (GAME-071)", () => {
  it("verified participants confirm/dispute until endsAt + 48 h; majority decides; others are rejected", async () => {
    const host = await makeUser(db);
    const g = await makeGame(db, host);
    const [a, b, c, outsider] = [await makeUser(db), await makeUser(db), await makeUser(db), await makeUser(db)];
    for (const u of [a, b, c]) await addParticipant(db, g, u, "approved", { attendance: "verified" });
    await addParticipant(db, g, outsider, "approved");
    await expectSt(asUser(db, a, `select public.confirm_result($1, 'confirm')`, [g], { now: at(2 * HOUR) }), "not_found");
    await asUser(db, host, `select public.submit_result($1, '{2,2}')`, [g], { now: at(2 * HOUR) });
    await expectSt(asUser(db, outsider, `select public.confirm_result($1, 'confirm')`, [g], { now: at(2 * HOUR) }), "forbidden");
    const [s1] = await asUser<{ s: Record<string, unknown> }>(db, a, `select public.confirm_result($1, 'dispute') s`, [g], { now: at(2 * HOUR) });
    // Host not verified → only the 3 verified vote: 1 dispute → pending.
    expect(s1!.s).toMatchObject({ status: "pending", disputes: 1, confirms: 0, verifiedCount: 3, myVerdict: "dispute" });
    const [s2] = await asUser<{ s: Record<string, unknown> }>(db, b, `select public.confirm_result($1, 'dispute') s`, [g], { now: at(3 * HOUR) });
    expect(s2!.s).toMatchObject({ status: "disputed", disputes: 2 });
    // The latest verdict wins.
    const [s3] = await asUser<{ s: Record<string, unknown> }>(db, b, `select public.confirm_result($1, 'confirm') s`, [g], { now: at(4 * HOUR) });
    expect(s3!.s).toMatchObject({ status: "pending", confirms: 1, disputes: 1 });
    await expectSt(asUser(db, c, `select public.confirm_result($1, 'confirm')`, [g], { now: at(50 * HOUR) }), "outside_window");
    const [r] = await asUser<{ s: Record<string, unknown> | null }>(db, outsider, `select public.result_confirmation($1) s`, [g], { now: at(5 * HOUR) });
    expect(r!.s).toMatchObject({ status: "pending", myVerdict: null });
  });
});

describe("Glicko-2 rating period (GLK-001..004)", () => {
  it("AC-GLK-003: 6 of 10 verified → no rating updates, labelled too_few_verified", async () => {
    const { g, users } = await ratedGame(6);
    expect(first(await asService<{ n: number }>(db, `select public.run_rating_period() n`, [], { now: AFTER_PERIOD })).n).toBe(0);
    const [s] = await asUser<{ s: Record<string, unknown> }>(db, users[1]!, `select public.game_rating_status($1) s`, [g], { now: AFTER_PERIOD });
    expect(s!.s).toEqual({ eligible: false, reason: "too_few_verified" });
    expect(await db.query(`select 1 from skill_ratings`)).toHaveLength(0);
    expect(first(await db.query<{ period: string }>(`select period from game_rating_status where game_id = $1`, [g])).period).toBe(PERIOD);
  });

  it("eligible game updates every verified player exactly like processRatingPeriod; idempotent; AC-GLK-004 frozen player", async () => {
    // Player 3 (team 1) has reliability 0.65 and an existing rating 1600: frozen, but counts for opponents.
    const { g, users } = await ratedGame(7, { reliability: (i) => (i === 3 ? 0.65 : i === 5 ? null : 0.9) });
    const frozen = users[3]!;
    await db.query(`insert into skill_ratings (user_id, sport, format_family, r, rd, sigma, games, last_period)
                    values ($1, 'football', 'small_sided', 1600, 80, 0.06, 12, '2026-W40')`, [frozen]);
    const n = first(await asService<{ n: number }>(db, `select public.run_rating_period() n`, [], { now: AFTER_PERIOD })).n;
    expect(n).toBe(7);
    const [st] = await db.query<{ eligible: boolean; reason: string | null }>(`select eligible, reason from game_rating_status where game_id = $1`, [g]);
    expect(st).toEqual({ eligible: true, reason: null });
    // TS reference on the same input.
    const teams = [users.slice(0, 7).filter((_, i) => i % 2 === 0).sort(), users.slice(0, 7).filter((_, i) => i % 2 === 1).sort()];
    const prior: SkillRating = { userId: frozen, sport: "football", formatFamily: "small_sided", r: 1600, rd: 80, sigma: 0.06, games: 12,
      provisional: true, level: 3.5, lastPeriod: "2026-W40", updatedAt: iso(T0) };
    const reliability = Object.fromEntries(users.map((u, i) => [u, i === 3 ? 0.65 : i === 5 ? null : 0.9]));
    const ts = processRatingPeriod({ period: PERIOD, games: [{ gameId: g, sport: "football", formatFamily: "small_sided", endsAt: iso(END),
      teams, teamScores: [3, 1] }], ratings: [prior], reliability }, resolveDomainConfig(), AFTER_PERIOD.getTime());
    const rows = await db.query<{ user_id: string; r: number; rd: number; sigma: number; games: number; last_period: string }>(
      `select user_id, r, rd, sigma, games, last_period from skill_ratings`);
    for (const t of ts.ratings) {
      const row = rows.find((x) => x.user_id === t.userId)!;
      expect(Math.abs(row.r - t.r)).toBeLessThan(1e-6);
      expect(Math.abs(row.rd - t.rd)).toBeLessThan(1e-6);
      expect(Math.abs(row.sigma - t.sigma)).toBeLessThan(1e-6);
      expect([row.games, row.last_period]).toEqual([t.games, PERIOD]);
    }
    expect(rows).toHaveLength(7); // 6 updated + the frozen player's untouched row
    const fz = rows.find((x) => x.user_id === frozen)!;
    expect([fz.r, fz.rd, fz.games, fz.last_period]).toEqual([1600, 80, 12, "2026-W40"]);
    const [u] = await db.query<{ frozen: boolean; r_before: number; r_after: number }>(
      `select frozen, r_before, r_after from rating_updates where user_id = $1`, [frozen]);
    expect(u).toEqual({ frozen: true, r_before: 1600, r_after: 1600 });
    // Winners gained, losers lost.
    expect(rows.find((x) => x.user_id === users[0])!.r).toBeGreaterThan(1500);
    expect(rows.find((x) => x.user_id === users[1])!.r).toBeLessThan(1500);
    // Idempotent: the period is recorded; a rerun applies nothing.
    expect(first(await asService<{ n: number }>(db, `select public.run_rating_period() n`, [], { now: AFTER_PERIOD })).n).toBe(0);
    const [mine] = await asUser<{ v: Record<string, unknown>[] }>(db, frozen, `select public.my_skill_ratings() v`, [], { now: AFTER_PERIOD });
    expect(mine!.v[0]).toMatchObject({ frozen: true, provisional: true, games: 12 });
  });

  it("not rated without published teams, with a disputed or unconfirmed result, or for running", async () => {
    const a = await ratedGame(10, { publishTeams: false });
    const b = await ratedGame(10, { confirm: false });
    await asService(db, `select public.run_rating_period()`, [], { now: AFTER_PERIOD });
    const st = await db.query<{ game_id: string; reason: string }>(`select game_id, reason from game_rating_status`);
    expect(Object.fromEntries(st.map((s) => [s.game_id, s.reason]))).toEqual({
      [a.g]: "teams_not_published", [b.g]: "result_not_confirmed" });
  });
});

describe("peer ratings (RATE-001..005)", () => {
  /** A finished game with rater + 6 co-players verified; rater has `games` verified football games in total. */
  async function scenario(games: number, reliability = 0.9) {
    const host = await makeUser(db);
    const g = await makeGame(db, host, { capacity: 12 });
    const rater = await makeUser(db);
    const co = [] as string[];
    for (let i = 0; i < 6; i++) co.push(await makeUser(db));
    for (const u of [rater, ...co]) await addParticipant(db, g, u, "approved", { attendance: "verified" });
    for (let i = 1; i < games; i++) {
      const past = await makeGame(db, host, { startsAt: at(-(i + 1) * 7 * DAY) });
      await addParticipant(db, past, rater, "approved", { attendance: "verified" });
    }
    await db.query(`update profiles set reliability_score = $2 where id = $1`, [rater, reliability]);
    return { g, host, rater, co };
  }
  const scores = (o: Record<string, number> = { overall: 4, speed: 3 }) => o;

  it("AC-RATE-002: 3 verified games → disabled with too_few_games; submitting is forbidden", async () => {
    const { g, rater, co } = await scenario(3);
    const [e] = await asUser<{ e: Record<string, unknown> }>(db, rater, `select public.rating_eligibility($1) e`, [g], { now: at(3 * HOUR) });
    expect(e!.e).toMatchObject({ canRate: false, reasons: ["too_few_games"], verifiedGamesInSport: 3, requiredGames: 5, rateableUserIds: [] });
    await expectSt(asUser(db, rater, `select public.submit_peer_ratings($1, $2::jsonb)`,
      [g, JSON.stringify([{ rateeId: co[0], scores: scores() }])], { now: at(3 * HOUR) }), "forbidden");
  });

  it("gates: reliability < 80 %, active sanction, not checked in; window endsAt … endsAt + 48 h", async () => {
    const { g, rater, co } = await scenario(5, 0.7);
    const elig = async (u: string, now: Date) =>
      first(await asUser<{ e: { reasons: string[] } }>(db, u, `select public.rating_eligibility($1) e`, [g], { now })).e.reasons;
    expect(await elig(rater, at(3 * HOUR))).toEqual(["low_reliability"]);
    await db.query(`update profiles set reliability_score = 0.9 where id = $1`, [rater]);
    await db.query(`insert into sanctions (user_id, kind, reason_code, statement_key, starts_at, expires_at, dispute_until, dedupe_key)
                    values ($1, 'yellow_card', 'no_show', 'sanctions.reason.no_show', $2, $3, $3, 'card-r')`, [rater, iso(at(-DAY)), iso(at(30 * DAY))]);
    expect(await elig(rater, at(3 * HOUR))).toEqual(["active_sanction"]);
    await db.query(`delete from sanctions where user_id = $1`, [rater]);
    expect(await elig(rater, at(30 * MIN))).toEqual(["window_not_open"]);
    expect(await elig(rater, new Date(END.getTime() + 48 * HOUR + 1))).toEqual(["window_closed"]);
    await expectSt(asUser(db, rater, `select public.submit_peer_ratings($1, $2::jsonb)`,
      [g, JSON.stringify([{ rateeId: co[0], scores: scores() }])], { now: new Date(END.getTime() + 49 * HOUR) }), "outside_window");
    const unverified = await makeUser(db);
    await addParticipant(db, g, unverified, "approved");
    expect(await elig(unverified, at(3 * HOUR))).toContain("not_verified");
  });

  it("validates ratees and scores; blocked pairs cannot rate each other; max 5 co-players", async () => {
    const { g, rater, co } = await scenario(5);
    const submit = (r: unknown) => asUser(db, rater, `select * from public.submit_peer_ratings($1, $2::jsonb)`, [g, JSON.stringify(r)], { now: at(3 * HOUR) });
    await db.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [co[0], rater]);
    await expectSt(submit([{ rateeId: co[0], scores: scores() }]), "forbidden");
    await expectSt(submit([{ rateeId: rater, scores: scores() }]), "forbidden");
    await expectSt(submit([{ rateeId: co[1], scores: { shooting: 3 } }]), "validation"); // basketball attribute
    await expectSt(submit([{ rateeId: co[1], scores: { overall: 6 } }]), "validation");
    await expectSt(submit([{ rateeId: co[1], scores: {} }]), "validation");
    await expectSt(submit([{ rateeId: co[1], scores: scores() }, { rateeId: co[1], scores: scores() }]), "validation");
    await expectSt(submit(co.slice(1).concat(co.slice(1, 2)).map((u) => ({ rateeId: u, scores: scores() }))), "validation");
    const rows = await submit(co.slice(1, 4).map((u) => ({ rateeId: u, scores: scores() })));
    expect(rows).toHaveLength(3);
    await expectSt(submit([{ rateeId: co[1], scores: scores() }]), "forbidden"); // already rated
    await expectSt(submit(co.slice(4).concat([co[1]!]).map((u) => ({ rateeId: u, scores: scores() }))), "validation"); // > 2 remaining
    await expectSt(submit(co.slice(5).concat([co[1]!]).map((u) => ({ rateeId: u, scores: scores() }))), "forbidden");
    expect(await submit([{ rateeId: co[4], scores: scores() }, { rateeId: co[5], scores: scores() }])).toHaveLength(5);
  });

  it("privacy: the ratee sees an aggregate only, the host a 1–5 band only, nobody else anything (RATE-004)", async () => {
    const { g, host, rater, co } = await scenario(5);
    const ratee = co[0]!;
    await db.query(`insert into user_sports (user_id, sport, self_skill, attributes) values ($1, 'football', 2, '{"speed":2,"control":2,"overall":2}')`, [ratee]);
    await asUser(db, rater, `select public.submit_peer_ratings($1, $2::jsonb)`,
      [g, JSON.stringify([{ rateeId: ratee, scores: { overall: 5, speed: 5 } }])], { now: at(3 * HOUR) });
    expect(await asUser(db, ratee, `select * from peer_ratings`, [], { now: at(4 * HOUR) })).toHaveLength(0);
    expect(await asUser(db, rater, `select * from peer_ratings`, [], { now: at(4 * HOUR) })).toHaveLength(1);
    const [s] = await asUser<{ s: { band: number; raterCount: number; attributes: { overall: { mean: number } } } }>(db, ratee,
      `select public.my_peer_summary('football') s`, [], { now: at(4 * HOUR) });
    expect(s!.s.attributes.overall.mean).toBe(2.75); // (3·2 + 5) / 4
    expect([s!.s.band, s!.s.raterCount]).toEqual([3, 1]);
    expect(JSON.stringify(s!.s)).not.toContain(rater);
    const [b] = await asUser<{ b: Record<string, number> }>(db, host, `select public.game_skill_bands($1) b`, [g], { now: at(4 * HOUR) });
    expect(b!.b[ratee]).toBe(3);
    await expectSt(asUser(db, rater, `select public.game_skill_bands($1)`, [g], { now: at(4 * HOUR) }), "forbidden");
    await expect(db.asAnon((tx) => tx.query(`select * from skill_ratings`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, rater, `update peer_ratings set scores = '{"overall":1}'`)).rejects.toThrow(/permission denied/);
  });

  it("RATE-005: no trust/sanction function reads any rating table", async () => {
    const readers = await db.query<{ f: string }>(
      `select distinct p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosrc ~ '(peer_ratings|skill_ratings|rating_updates|result_confirmations|game_rating_status)'
       order by 1`);
    const allowed = new Set(["confirm_result", "delete_my_account", "game_rating_status", "game_skill_bands", "my_peer_summary",
      "my_skill_ratings", "run_rating_period", "st_peer_eligibility", "st_peer_summary", "st_phase15_delete_account", "st_result_summary",
      "submit_peer_ratings"]);
    expect(readers.map((r) => r.f).filter((f) => !allowed.has(f))).toEqual([]);
    for (const f of readers.map((r) => r.f)) expect(f).not.toMatch(/sanction|escalat|report|reliab|evaluate|no_show|effects/);
  });
});

describe("Glicko-2 TS ≡ SQL fuzz (≤ 1e-6)", () => {
  it("random players and result sets", async () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const cases = Array.from({ length: 150 }, () => ({
      player: { r: 900 + rnd() * 1400, rd: 30 + rnd() * 320, sigma: 0.03 + rnd() * 0.07 },
      results: Array.from({ length: Math.floor(rnd() * 6) }, () => ({
        opponent: { r: 900 + rnd() * 1400, rd: 30 + rnd() * 320 }, score: ([0, 0.5, 1] as const)[Math.floor(rnd() * 3)]! })),
      tau: 0.3 + rnd() * 0.9,
    }));
    const rows = await db.query<{ o: { r: number; rd: number; sigma: number } }>(
      `select public.dm_glicko2_update(c->'player', c->'results', (c->>'tau')::float8, 350) o
       from jsonb_array_elements($1::jsonb) with ordinality x(c, i) order by i`, [JSON.stringify(cases)]);
    rows.forEach((row, i) => {
      const c = cases[i]!;
      const t = glicko2Update(c.player, c.results, c.tau, 350);
      for (const k of ["r", "rd", "sigma"] as const) expect(Math.abs(row.o[k] - t[k]), `${i}.${k}`).toBeLessThan(1e-6);
    });
  });
});
