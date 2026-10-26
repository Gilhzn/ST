import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import {
  addParticipant, asService, asUser, at, DAY, expectSt, HOUR, iso, makeGame, makeUser, makeVenue, MIN, profileOf,
  sanctionsOf, T0, TLV,
} from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

const before = { now: at(-1 * DAY) };

describe("create_profile", () => {
  it("enforces the 16+ age gate by birth year/month and copies the phone", async () => {
    const u = await db.createUser({ phone: "+972501111111" });
    const now = { now: new Date("2026-06-15T12:00:00Z") };
    // Turns 16 in July 2026: still 15 in June → restricted.
    await expectSt(
      asUser(db, u, `select public.create_profile('Dana', 'he', 2010, 7)`, [], now), "age_restricted");
    // Born June 2010: conservatively counted as 16 only from July.
    await expectSt(asUser(db, u, `select public.create_profile('Dana', 'he', 2010, 6)`, [], now), "age_restricted");
    await asUser(db, u, `select public.create_profile('Dana', 'he', 2010, 5, 'female')`, [], now);
    const [pp] = await db.query<{ phone: string; gender: string }>(`select phone, gender from profile_private where user_id = $1`, [u]);
    expect(pp).toEqual({ phone: "+972501111111", gender: "female" });
    await expectSt(asUser(db, u, `select public.create_profile('Dana', 'he', 2000, 5)`, [], now), "conflict");
  });

  it("anon cannot call RPCs", async () => {
    await expect(db.asAnon((tx) => tx.query(`select public.create_profile('x', 'en', 1990, 1)`))).rejects.toThrow(/permission denied/);
  });
});

describe("create_game", () => {
  it("creates a game with the host approved; rejects suspended hosts and inactive venues", async () => {
    const host = await makeUser(db);
    const venue = await makeVenue(db, { sports: ["football", "tennis"] });
    const [g] = await asUser<{ id: string; approved_count: number; is_host: boolean; lat: number; invite_token: string }>(
      db, host,
      `select * from public.create_game('football', 'Friday 5s', 'public', $1, null, null, false, 10, $2, $3)`,
      [venue, iso(T0), iso(at(90 * MIN))], before);
    expect(g).toMatchObject({ approved_count: 1, is_host: true });
    expect(g!.lat).toBeCloseTo(TLV.lat, 5);
    expect(g!.invite_token).toMatch(/^[0-9a-f]{36}$/);

    await expectSt(asUser(db, host, `select public.create_game('padel', 'x', 'public', $1, null, null, false, 4, $2, $3)`,
      [venue, iso(T0), iso(at(HOUR))], before), "validation");
    const hidden = await makeVenue(db, { status: "hidden_pending_review" });
    await expectSt(asUser(db, host, `select public.create_game('football', 'x', 'public', $1, null, null, false, 4, $2, $3)`,
      [hidden, iso(T0), iso(at(HOUR))], before), "validation");
    await expectSt(asUser(db, host, `select public.create_game('football', 'x', 'public', null, 32, 34, false, 4, $1, $2)`,
      [iso(at(-2 * DAY)), iso(at(HOUR))], before), "validation");

    await db.query(`update profiles set host_suspended_until = $2 where id = $1`, [host, iso(at(5 * DAY))]);
    await expectSt(asUser(db, host, `select public.create_game('football', 'x', 'public', null, 32, 34, false, 4, $1, $2)`,
      [iso(T0), iso(at(HOUR))], before), "host_suspended");
  });

  it("join-banned and visibility-restricted users cannot create public games (private allowed)", async () => {
    const host = await makeUser(db);
    await db.query(`update profiles set join_banned_until = $2 where id = $1`, [host, iso(at(5 * DAY))]);
    await expectSt(asUser(db, host, `select public.create_game('football', 'x', 'public', null, 32, 34, false, 4, $1, $2)`,
      [iso(T0), iso(at(HOUR))], before), "join_banned");
    await asUser(db, host, `select public.create_game('football', 'x', 'private', null, 32, 34, false, 4, $1, $2)`,
      [iso(T0), iso(at(HOUR))], before);
    await db.query(`update profiles set join_banned_until = null, visibility_restricted_until = $2 where id = $1`, [host, iso(at(DAY))]);
    await expectSt(asUser(db, host, `select public.create_game('football', 'x', 'public', null, 32, 34, false, 4, $1, $2)`,
      [iso(T0), iso(at(HOUR))], before), "forbidden");
  });

  it("permanently banned accounts get account_banned", async () => {
    const host = await makeUser(db);
    await db.query(`update profiles set permanently_banned = true where id = $1`, [host]);
    await expectSt(asUser(db, host, `select public.create_game('football', 'x', 'public', null, 32, 34, false, 4, $1, $2)`,
      [iso(T0), iso(at(HOUR))], before), "account_banned");
  });
});

describe("request_join", () => {
  it("applies join ban, block, women-only, game state, duplicates and invite rules", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    const join = (u: string, game = g, token: string | null = null, now = before) =>
      asUser(db, u, `select * from public.request_join($1, null, $2)`, [game, token], now);

    await db.query(`update profiles set join_banned_until = $2 where id = $1`, [p, iso(at(DAY))]);
    await expectSt(join(p), "join_banned");
    await db.query(`update profiles set join_banned_until = null where id = $1`, [p]);

    await db.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [host, p]);
    await expectSt(join(p), "blocked");
    await db.query(`delete from blocks`);

    const [row] = await join(p);
    expect(row).toMatchObject({ status: "requested", user_id: p });
    await expectSt(join(p), "conflict");
    await expectSt(join(host), "conflict");
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'join_requested'`, [host]);
    expect(n!.n).toBe(1);

    const late = await makeUser(db);
    await expectSt(join(late, g, null, { now: at(MIN) }), "game_not_open");

    const women = await makeGame(db, host, { womenOnly: true });
    await expectSt(join(p, women), "women_only");
    const f = await makeUser(db, { gender: "female" });
    await join(f, women);

    const priv = await makeGame(db, host, { visibility: "private" });
    await expectSt(join(p, priv), "not_found");
    await expectSt(join(p, priv, "wrong"), "not_found");
    const [{ invite_token }] = await db.query<{ invite_token: string }>(`select invite_token from games where id = $1`, [priv]);
    const [r2] = await join(p, priv, invite_token);
    expect(r2!.status).toBe("requested");
  });

  it("an approved participant blocking the joiner also blocks the join; rejected users cannot re-request", async () => {
    const host = await makeUser(db);
    const a = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, a);
    await db.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [a, p]);
    await expectSt(asUser(db, p, `select public.request_join($1)`, [g], before), "blocked");
    await db.query(`delete from blocks`);
    await asUser(db, p, `select public.request_join($1)`, [g], before);
    await asUser(db, host, `select public.decide_join($1, $2, 'reject')`, [g, p], before);
    await expectSt(asUser(db, p, `select public.request_join($1)`, [g], before), "forbidden");
  });

  it("a deposit game hides the request from the host until the payment method is saved", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host, { depositMinor: 500 });
    const [row] = await asUser<{ payment_ready: boolean }>(db, p, `select * from public.request_join($1)`, [g], before);
    expect(row!.payment_ready).toBe(false);
    const hostSees = await asUser(db, host, `select * from participant_views where game_id = $1 and user_id = $2`, [g, p]);
    expect(hostSees).toHaveLength(0);
    await expectSt(asUser(db, host, `select public.decide_join($1, $2, 'approve')`, [g, p], before), "payment_required");
    // payments-webhook (service role) marks the SetupIntent succeeded.
    await asService(db, `update payments set status = 'succeeded' where game_id = $1 and user_id = $2`, [g, p]);
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'join_requested'`, [host]);
    expect(n!.n).toBe(1);
    const [d] = await asUser<{ status: string }>(db, host, `select * from public.decide_join($1, $2, 'approve')`, [g, p], before);
    expect(d!.status).toBe("approved");
  });
});

describe("decide_join and the waitlist (GAME-045)", () => {
  it("is host only, waitlists when full and offers freed spots FIFO", async () => {
    const host = await makeUser(db);
    const [a, b, c] = [await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { capacity: 2 });
    for (const u of [a, b, c]) await asUser(db, u, `select public.request_join($1)`, [g], before);
    await expectSt(asUser(db, a, `select public.decide_join($1, $2, 'approve')`, [g, b], before), "forbidden");

    let tick = 0;
    const decide = (u: string) =>
      asUser<{ status: string; waitlist_rank: number | null }>(db, host, `select * from public.decide_join($1, $2, 'approve')`, [g, u],
        { now: at(-DAY + tick++ * MIN) });
    expect((await decide(a))[0]!.status).toBe("approved");
    expect((await decide(b))[0]).toMatchObject({ status: "waitlisted", waitlist_rank: 1 });
    expect((await decide(c))[0]).toMatchObject({ status: "waitlisted", waitlist_rank: 2 });
    await expectSt(decide(a), "conflict");

    // a cancels > 6h before start: b gets a 2h offer, c does not.
    const now = { now: at(-10 * HOUR) };
    await asUser(db, a, `select public.cancel_participation($1)`, [g], now);
    const offers = await db.query<{ user_id: string; offer_expires_at: Date; offer_is_flash: boolean }>(
      `select user_id, offer_expires_at, offer_is_flash from game_participants where game_id = $1 and offer_expires_at is not null`, [g]);
    expect(offers).toEqual([{ user_id: b, offer_expires_at: at(-8 * HOUR), offer_is_flash: false }]);
    await expectSt(asUser(db, c, `select public.accept_waitlist_offer($1)`, [g], now), "conflict");

    // Offer expires → b goes to the back, c gets an offer (between 6h and 1h: 20 minutes).
    const later = { now: at(-5 * HOUR) };
    expect((await asService<{ n: number }>(db, `select public.expire_waitlist_offers() as n`, [], later))[0]!.n).toBe(1);
    const [cOffer] = await db.query<{ offer_expires_at: Date }>(`select offer_expires_at from game_participants where game_id = $1 and user_id = $2`, [g, c]);
    expect(cOffer!.offer_expires_at).toEqual(at(-5 * HOUR + 20 * MIN));
    const [acc] = await asUser<{ status: string }>(db, c, `select * from public.accept_waitlist_offer($1)`, [g], later);
    expect(acc!.status).toBe("approved");
    const [rank] = await db.query<{ waitlist_rank: number }>(`select waitlist_rank from participant_views where game_id = $1 and user_id = $2`, [g, b]);
    expect(rank).toBeUndefined(); // superuser has no auth.uid(): the view hides everything
    const [bRow] = await asUser<{ status: string; waitlist_rank: number }>(db, b, `select * from participant_views where game_id = $1 and user_id = $2`, [g, b]);
    expect(bRow).toMatchObject({ status: "waitlisted", waitlist_rank: 1 });
  });

  it("flash fill under 1h: everyone on the waitlist is offered, first to accept wins", async () => {
    const host = await makeUser(db);
    const a = await makeUser(db);
    const g = await makeGame(db, host, { capacity: 2 });
    await addParticipant(db, g, a);
    const w = [await makeUser(db), await makeUser(db), await makeUser(db)];
    for (const [i, u] of w.entries()) await addParticipant(db, g, u, "waitlisted", { waitlistedAt: at(-5 * DAY + i * MIN) });
    const now = { now: at(-40 * MIN) };
    await asUser(db, a, `select public.cancel_participation($1)`, [g], now);
    const flash = await db.query<{ n: number }>(`select count(*)::int n from game_participants where game_id = $1 and offer_is_flash`, [g]);
    expect(flash[0]!.n).toBe(3);
    const notified = await db.query<{ n: number }>(`select count(*)::int n from notifications where kind = 'waitlist_promoted' and game_id = $1`, [g]);
    expect(notified[0]!.n).toBe(3);
    const [win] = await asUser<{ status: string }>(db, w[2]!, `select * from public.accept_waitlist_offer($1)`, [g], now);
    expect(win!.status).toBe("approved");
    // Others' offers were withdrawn with a "spot taken" notice; they stay waitlisted.
    await expectSt(asUser(db, w[0]!, `select public.accept_waitlist_offer($1)`, [g], now), "conflict");
    const taken = await db.query<{ n: number }>(`select count(*)::int n from notifications where kind = 'join_waitlisted' and game_id = $1`, [g]);
    expect(taken[0]!.n).toBe(2);
  });

  it("game_full when the spot was taken between offer and acceptance", async () => {
    const host = await makeUser(db);
    const [a, b] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { capacity: 2 });
    await addParticipant(db, g, b, "waitlisted");
    await db.query(`update game_participants set offer_expires_at = $3, offer_is_flash = true where game_id = $1 and user_id = $2`,
      [g, b, iso(at(HOUR))]);
    await addParticipant(db, g, a);
    await expectSt(asUser(db, b, `select public.accept_waitlist_offer($1)`, [g], { now: at(-30 * MIN) }), "game_full");
  });

  it("remove_participant is host only and frees the spot", async () => {
    const host = await makeUser(db);
    const [a, b] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { capacity: 2 });
    await addParticipant(db, g, a);
    await addParticipant(db, g, b, "waitlisted");
    await expectSt(asUser(db, b, `select public.remove_participant($1, $2)`, [g, a], before), "forbidden");
    await expectSt(asUser(db, host, `select public.remove_participant($1, $2)`, [g, host], before), "validation");
    const [r] = await asUser<{ status: string }>(db, host, `select * from public.remove_participant($1, $2)`, [g, a], before);
    expect(r!.status).toBe("removed");
    const [o] = await db.query<{ offer_expires_at: Date | null }>(`select offer_expires_at from game_participants where game_id = $1 and user_id = $2`, [g, b]);
    expect(o!.offer_expires_at).not.toBeNull();
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'participant_removed'`, [a]);
    expect(n!.n).toBe(1);
  });
});

describe("cancel_participation", () => {
  it("> 2h before start: no card; < 2h: provisional yellow card with statement key and 48h dispute window", async () => {
    const host = await makeUser(db);
    const [early, late] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, early);
    await addParticipant(db, g, late);
    const [r1] = await asUser<{ r: { sanction: unknown; participant: { late_cancel: boolean } } }>(
      db, early, `select public.cancel_participation($1) as r`, [g], { now: at(-3 * HOUR) });
    expect(r1!.r.sanction).toBeNull();
    expect(r1!.r.participant.late_cancel).toBe(false);

    const now = at(-90 * MIN);
    const [r2] = await asUser<{ r: { sanction: Record<string, unknown>; participant: { late_cancel: boolean } } }>(
      db, late, `select public.cancel_participation($1) as r`, [g], { now });
    expect(r2!.r.participant.late_cancel).toBe(true);
    expect(r2!.r.sanction).toMatchObject({
      kind: "yellow_card",
      reason_code: "late_cancel",
      statement_key: "sanctions.reason.late_cancel",
      status: "active",
      decided_by: "system",
      dedupe_key: `late_cancel:${g}:${late}`,
    });
    expect(new Date(r2!.r.sanction.dispute_until as string)).toEqual(new Date(now.getTime() + 48 * HOUR));
    expect(new Date(r2!.r.sanction.expires_at as string)).toEqual(new Date(now.getTime() + 30 * DAY));
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'sanction_issued'`, [late]);
    expect(n!.n).toBe(1);
    expect((await profileOf(db, late)).reliability_late_cancel_count).toBe(1);
  });

  it("host cannot cancel participation; cancelling twice conflicts", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    await expectSt(asUser(db, host, `select public.cancel_participation($1)`, [g], before), "conflict");
    await asUser(db, p, `select public.cancel_participation($1)`, [g], before);
    await expectSt(asUser(db, p, `select public.cancel_participation($1)`, [g], before), "conflict");
  });

  it("TRUST-021: the card is voided at closure when the replacement checked in", async () => {
    const host = await makeUser(db);
    const [leaver, sub, other] = [await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { capacity: 3 });
    await addParticipant(db, g, leaver);
    await addParticipant(db, g, other, "approved", { attendance: "verified" });
    await addParticipant(db, g, sub, "waitlisted");
    await asUser(db, leaver, `select public.cancel_participation($1)`, [g], { now: at(-90 * MIN) });
    await asUser(db, sub, `select public.accept_waitlist_offer($1)`, [g], { now: at(-80 * MIN) });
    const [link] = await db.query<{ replaces_user_id: string }>(`select replaces_user_id from game_participants where game_id = $1 and user_id = $2`, [g, sub]);
    expect(link!.replaces_user_id).toBe(leaver);
    await db.query(`update game_participants set attendance = 'verified', check_in_method = 'qr', checked_in_at = $3 where game_id = $1 and user_id = $2`,
      [g, sub, iso(T0)]);
    await asService(db, `select public.process_no_shows()`, [], { now: at(4 * HOUR) });
    const [card] = await sanctionsOf(db, leaver);
    expect(card).toMatchObject({ status: "overturned", void_reason: "refilled" });
    const p = await profileOf(db, leaver);
    expect(p.reliability_late_cancel_count).toBe(0);
    const [note] = await db.query<{ params: { decision: string } }>(`select params from notifications where user_id = $1 and kind = 'sanction_decided'`, [leaver]);
    expect(note!.params.decision).toBe("voided_refilled");
  });

  it("TRUST-021: the card stays when the replacement did not check in", async () => {
    const host = await makeUser(db);
    const [leaver, sub] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { capacity: 2 });
    await addParticipant(db, g, leaver);
    await addParticipant(db, g, sub, "waitlisted");
    await asUser(db, leaver, `select public.cancel_participation($1)`, [g], { now: at(-90 * MIN) });
    await asUser(db, sub, `select public.accept_waitlist_offer($1)`, [g], { now: at(-80 * MIN) });
    await asService(db, `select public.process_no_shows()`, [], { now: at(4 * HOUR) });
    const cards = await sanctionsOf(db, leaver);
    expect(cards.map((c) => [c.reason_code, c.status])).toEqual([["late_cancel", "active"]]);
    // The sub became a no-show instead.
    expect((await sanctionsOf(db, sub)).map((c) => c.reason_code)).toEqual(["no_show"]);
  });
});

describe("save_teams, submit_result, rate_host", () => {
  it("save_teams validates indices and participants", async () => {
    const host = await makeUser(db);
    const [a, b, x] = [await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { teamCount: 2 });
    await addParticipant(db, g, a);
    await addParticipant(db, g, b);
    const rows = await asUser<{ user_id: string; team: number | null }>(db, host,
      `select user_id, team from public.save_teams($1, $2::jsonb)`, [g, JSON.stringify({ [a]: 0, [b]: 1 })]);
    expect(rows.find((r) => r.user_id === b)!.team).toBe(1);
    expect(rows.find((r) => r.user_id === host)!.team).toBeNull();
    await expectSt(asUser(db, host, `select public.save_teams($1, $2::jsonb)`, [g, JSON.stringify({ [a]: 2 })]), "validation");
    await expectSt(asUser(db, host, `select public.save_teams($1, $2::jsonb)`, [g, JSON.stringify({ [x]: 0 })]), "validation");
    await expectSt(asUser(db, a, `select public.save_teams($1, $2::jsonb)`, [g, "{}"]), "forbidden");
  });

  it("submit_result only between ends_at and ends_at + 2h, by approved participants, one score per team", async () => {
    const host = await makeUser(db);
    const [a, out] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { teamCount: 2 });
    await addParticipant(db, g, a);
    const end = at(90 * MIN);
    const submit = (u: string, now: Date, scores = "{3,2}") =>
      asUser(db, u, `select * from public.submit_result($1, $2::int[])`, [g, scores], { now });
    await expectSt(submit(a, new Date(end.getTime() - MIN)), "outside_window");
    await expectSt(submit(a, new Date(end.getTime() + 2 * HOUR + 1000)), "outside_window");
    await expectSt(submit(a, end, "{3}"), "validation");
    await expectSt(submit(a, end, "{3,-1}"), "validation");
    await expectSt(submit(out, end), "forbidden");
    const [r] = await submit(a, new Date(end.getTime() + 2 * HOUR));
    expect(r).toMatchObject({ team_scores: [3, 2], submitted_by: a });
    const [r2] = await submit(host, new Date(end.getTime() + HOUR), "{4,4}");
    expect(r2).toMatchObject({ team_scores: [4, 4], submitted_by: host });
  });

  it("rate_host: verified attendees only, once, within 48h; low average → host suspension + review", async () => {
    const host = await makeUser(db);
    const g = await makeGame(db, host);
    const raters: string[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await makeUser(db);
      await addParticipant(db, g, u, "approved", { attendance: "verified" });
      raters.push(u);
    }
    const notVerified = await makeUser(db);
    await addParticipant(db, g, notVerified);
    const now = { now: at(3 * HOUR) };
    await expectSt(asUser(db, notVerified, `select public.rate_host($1, 1)`, [g], now), "forbidden");
    await expectSt(asUser(db, host, `select public.rate_host($1, 1)`, [g], now), "forbidden");
    await expectSt(asUser(db, raters[0]!, `select public.rate_host($1, 1)`, [g], { now: at(90 * MIN + 49 * HOUR) }), "outside_window");
    for (const [i, u] of raters.entries()) {
      await asUser(db, u, `select public.rate_host($1, $2)`, [g, i === 0 ? 3 : 2], now);
    }
    await expectSt(asUser(db, raters[1]!, `select public.rate_host($1, 1)`, [g], now), "conflict");
    // avg = 2.2 > 2 → no suspension yet
    expect(await sanctionsOf(db, host)).toHaveLength(0);
    await db.query(`update host_ratings set stars = 2 where rater_id = $1`, [raters[0]]);
    await db.query(`delete from host_ratings where rater_id = $1`, [raters[4]]);
    await asUser(db, raters[4]!, `select public.rate_host($1, 2)`, [g], now);
    const s = await sanctionsOf(db, host);
    expect(s.map((x) => [x.kind, x.reason_code])).toEqual([["host_suspension", "low_host_rating"]]);
    expect((await profileOf(db, host)).host_suspended_until).toEqual(new Date(at(3 * HOUR).getTime() + 30 * DAY));
    const [q] = await db.query<{ kind: string }>(`select kind from review_queue where subject_user_id = $1`, [host]);
    expect(q!.kind).toBe("host_reliability");
  });
});

describe("cancel_game", () => {
  it("host only; notifies participants and requests deposit release", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host, { depositMinor: 500 });
    await addParticipant(db, g, p);
    await db.query(`insert into payments (user_id, game_id, amount_minor, currency, status, deposit_state, idempotency_key)
                    values ($1, $2, 500, 'EUR', 'requires_capture', 'held', 'k1')`, [p, g]);
    await expectSt(asUser(db, p, `select public.cancel_game($1)`, [g], before), "forbidden");
    const [r] = await asUser<{ status: string }>(db, host, `select * from public.cancel_game($1)`, [g], before);
    expect(r!.status).toBe("cancelled");
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'game_cancelled'`, [p]);
    expect(n!.n).toBe(1);
    const due = await asService<{ outcome: string }>(db, `select * from public.due_deposit_settlements()`, [], before);
    expect(due.map((d) => d.outcome)).toEqual(["release"]);
  });
});
