import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import {
  addParticipant, asService, asUser, at, DAY, expectSt, HOUR, iso, makeGame, makeUser, makeVenue, MIN, profileOf,
  sanctionsOf, T0, TLV, first } from "./fixtures";

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
    expect(g).toMatchObject({ min_players: 2 }); // Game.minPlayers default (contract v2)
    const [g6] = await asUser<{ min_players: number }>(db, host,
      `select * from public.create_game('football', 'Six', 'public', $1, null, null, false, 10, $2, $3, p_min_players => 6)`,
      [venue, iso(T0), iso(at(90 * MIN))], before);
    expect(g6!.min_players).toBe(6);
    for (const bad of [1, 11]) {
      await expectSt(asUser(db, host,
        `select public.create_game('football', 'x', 'public', $1, null, null, false, 10, $2, $3, p_min_players => ${bad})`,
        [venue, iso(T0), iso(at(90 * MIN))], before), "validation");
    }

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
    const { invite_token } = first(await db.query<{ invite_token: string }>(`select invite_token from games where id = $1`, [priv]));
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

describe("deposits: charge-and-refund methods (TRUST-062)", () => {
  it("a charged deposit (step charge, held) makes the request visible to the host and notifies once", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host, { depositMinor: 500 });
    await asUser(db, p, `select public.request_join($1)`, [g], before);
    await asService(db, `update payments set step = 'charge', provider_ref = 'pi_123', status = 'processing' where game_id = $1 and user_id = $2`, [g, p]);
    expect(await asUser(db, host, `select 1 from participant_views where game_id = $1 and user_id = $2`, [g, p])).toHaveLength(0);
    // The webhook moves status and deposit_state together.
    await asService(db, `update payments set status = 'succeeded', deposit_state = 'held' where game_id = $1 and user_id = $2`, [g, p]);
    const { payment_ready } = first(await db.query<{ payment_ready: boolean }>(
      `select payment_ready from game_participants where game_id = $1 and user_id = $2`, [g, p]));
    expect(payment_ready).toBe(true);
    await asService(db, `update payments set updated_at = now() where game_id = $1 and user_id = $2`, [g, p]);
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'join_requested'`, [host]);
    expect(n!.n).toBe(1);
    const [d] = await asUser<{ status: string }>(db, host, `select * from public.decide_join($1, $2, 'approve')`, [g, p], before);
    expect(d!.status).toBe("approved");
  });
});

describe("decide_join and the waitlist (GAME-045)", () => {
  it("is host only, waitlists when full and offers freed spots FIFO (standard 2h offer, then the next player)", async () => {
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

    // a cancels > 6h before start: b (first in line) gets a 120-minute offer, c does not.
    const now = { now: at(-10 * HOUR) };
    await asUser(db, a, `select public.cancel_participation($1)`, [g], now);
    const offers = await db.query<{ user_id: string; accept_by: Date; mode: string }>(
      `select user_id, accept_by, mode from waitlist_offers where game_id = $1`, [g]);
    expect(offers).toEqual([{ user_id: b, accept_by: at(-8 * HOUR), mode: "standard" }]);
    const [mine] = await asUser<{ offer_expires_at: Date; offer_mode: string }>(db, b,
      `select offer_expires_at, offer_mode from participant_views where game_id = $1 and user_id = $2`, [g, b], now);
    expect(mine).toEqual({ offer_expires_at: at(-8 * HOUR), offer_mode: "standard" });
    await expectSt(asUser(db, c, `select public.accept_waitlist_offer($1)`, [g], now), "not_found");

    // b lets the offer expire → the next pass offers c (still > 6h: 120 minutes); b cannot accept late.
    const later = { now: at(-7 * HOUR) };
    expect((await asService<{ n: number }>(db, `select public.expire_waitlist_offers() as n`, [], later))[0]!.n).toBe(1);
    await expectSt(asUser(db, b, `select public.accept_waitlist_offer($1)`, [g], later), "outside_window");
    const [acc] = await asUser<{ status: string }>(db, c, `select * from public.accept_waitlist_offer($1)`, [g], later);
    expect(acc!.status).toBe("approved");
    const [bRow] = await asUser<{ status: string; waitlist_rank: number }>(db, b, `select * from participant_views where game_id = $1 and user_id = $2`, [g, b]);
    expect(bRow).toMatchObject({ status: "waitlisted", waitlist_rank: 1 });
  });

  it("between 6h and 1h before start the offer window is 20 minutes", async () => {
    const host = await makeUser(db);
    const [a, b] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { capacity: 2 });
    await addParticipant(db, g, a);
    await addParticipant(db, g, b, "waitlisted");
    await asUser(db, a, `select public.cancel_participation($1)`, [g], { now: at(-3 * HOUR) });
    const [o] = await db.query<{ accept_by: Date; mode: string }>(`select accept_by, mode from waitlist_offers where game_id = $1`, [g]);
    expect(o).toEqual({ accept_by: at(-3 * HOUR + 20 * MIN), mode: "short" });
  });

  it("flash fill under 1h: everyone on the waitlist is offered, first to accept wins, others get game_full", async () => {
    const host = await makeUser(db);
    const a = await makeUser(db);
    const g = await makeGame(db, host, { capacity: 2 });
    await addParticipant(db, g, a);
    const w = [await makeUser(db), await makeUser(db), await makeUser(db)];
    for (const [i, u] of w.entries()) await addParticipant(db, g, u, "waitlisted", { waitlistedAt: at(-5 * DAY + i * MIN) });
    const now = { now: at(-40 * MIN) };
    await asUser(db, a, `select public.cancel_participation($1)`, [g], now);
    const flash = await db.query<{ n: number }>(`select count(*)::int n from waitlist_offers where game_id = $1 and mode = 'flash' and accept_by = $2`,
      [g, iso(T0)]);
    expect(flash[0]!.n).toBe(3);
    const notified = await db.query<{ n: number }>(`select count(*)::int n from notifications where kind = 'waitlist_offer' and game_id = $1`, [g]);
    expect(notified[0]!.n).toBe(3);
    const [win] = await asUser<{ status: string }>(db, w[2]!, `select * from public.accept_waitlist_offer($1)`, [g], now);
    expect(win!.status).toBe("approved");
    await expectSt(asUser(db, w[0]!, `select public.accept_waitlist_offer($1)`, [g], now), "game_full");
    const taken = await db.query<{ n: number }>(`select count(*)::int n from notifications where kind = 'join_waitlisted' and game_id = $1`, [g]);
    expect(taken[0]!.n).toBe(2);
    // After the start nothing is offered or accepted.
    await expectSt(asUser(db, w[0]!, `select public.accept_waitlist_offer($1)`, [g], { now: at(MIN) }), "game_not_open");
  });

  it("game_full when the spot was taken between offer and acceptance", async () => {
    const host = await makeUser(db);
    const [a, b] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { capacity: 2 });
    await addParticipant(db, g, b, "waitlisted");
    await db.query(`insert into waitlist_offers (game_id, user_id, offered_at, accept_by, mode) values ($1, $2, $3, $4, 'flash')`,
      [g, b, iso(at(-HOUR)), iso(T0)]);
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
    const [o] = await db.query<{ mode: string }>(`select mode from waitlist_offers where game_id = $1 and user_id = $2`, [g, b]);
    expect(o!.mode).toBe("standard");
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'participant_removed'`, [a]);
    expect(n!.n).toBe(1);
  });
});

describe("cancel_participation", () => {
  it("≥ 2h before start is free; < 2h is a late cancel whose card is decided at finalisation", async () => {
    const host = await makeUser(db);
    const [early, late, v1, v2] = [await makeUser(db), await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    for (const u of [early, late]) await addParticipant(db, g, u);
    for (const u of [v1, v2]) await addParticipant(db, g, u, "approved", { attendance: "verified" });
    const [r1] = await asUser<{ r: { sanction: unknown; participant: { late_cancel: boolean } } }>(
      db, early, `select public.cancel_participation($1) as r`, [g], { now: at(-2 * HOUR) });
    expect(r1!.r.sanction).toBeNull();
    expect(r1!.r.participant.late_cancel).toBe(false); // exactly 2h before: not late

    const cancelAt = at(-90 * MIN);
    const [r2] = await asUser<{ r: { sanction: unknown; participant: { late_cancel: boolean } } }>(
      db, late, `select public.cancel_participation($1) as r`, [g], { now: cancelAt });
    expect(r2!.r.participant.late_cancel).toBe(true);
    expect(r2!.r.sanction).toBeNull();
    expect(await sanctionsOf(db, late)).toHaveLength(0);
    expect((await profileOf(db, late)).reliability_late_cancel_count).toBe(1);

    const close = at(90 * MIN + 2 * HOUR);
    await asService(db, `select public.process_no_shows()`, [], { now: close });
    const [card] = await sanctionsOf(db, late);
    expect(card).toMatchObject({ kind: "yellow_card", reason_code: "late_cancel", status: "active", dedupe_key: `late_cancel:${g}:${late}` });
    expect(card!.dispute_until).toEqual(new Date(close.getTime() + 48 * HOUR));
    expect(card!.expires_at).toEqual(new Date(close.getTime() + 30 * DAY));
    const { statement_params } = first(await db.query<{ statement_params: Record<string, unknown> }>(
      `select statement_params from sanctions where id = $1`, [card!.id]));
    expect(statement_params).toEqual({ windowHours: 2, minutesBeforeStart: 90, disputeHours: 48, appealPath: "dispute" });
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'sanction_issued'`, [late]);
    expect(n!.n).toBe(1);
    expect(await sanctionsOf(db, early)).toHaveLength(0);
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

  it("TRUST-021: no card when the spot was refilled before the start and the replacement checked in", async () => {
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
    expect(await sanctionsOf(db, leaver)).toHaveLength(0);
    const p = await profileOf(db, leaver);
    expect(p.reliability_late_cancel_count).toBe(0);
    expect(await db.query(`select 1 from audit_log where action = 'late_cancel.refilled' and subject_user_id = $1`, [leaver])).toHaveLength(1);
  });

  it("TRUST-021: the card is issued when the replacement did not check in (game happened)", async () => {
    const host = await makeUser(db);
    const [leaver, sub, v1, v2] = [await makeUser(db), await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { capacity: 4 });
    await addParticipant(db, g, leaver);
    for (const u of [v1, v2]) await addParticipant(db, g, u, "approved", { attendance: "verified" });
    await addParticipant(db, g, sub, "waitlisted");
    await asUser(db, leaver, `select public.cancel_participation($1)`, [g], { now: at(-90 * MIN) });
    await asUser(db, sub, `select public.accept_waitlist_offer($1)`, [g], { now: at(-80 * MIN) });
    await asService(db, `select public.process_no_shows()`, [], { now: at(4 * HOUR) });
    const cards = await sanctionsOf(db, leaver);
    expect(cards.map((c) => [c.reason_code, c.status])).toEqual([["late_cancel", "active"]]);
    // The sub became a no-show instead.
    expect((await sanctionsOf(db, sub)).map((c) => c.reason_code)).toEqual(["no_show"]);
  });

  it("TRUST-011: the finalisation job uses games.min_players (3 verified of min 8 → not happened)", async () => {
    const host = await makeUser(db);
    const [a, v1, v2, v3] = [await makeUser(db), await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { capacity: 10 });
    await db.query(`update games set min_players = 8 where id = $1`, [g]);
    await addParticipant(db, g, a);
    for (const u of [v1, v2, v3]) await addParticipant(db, g, u, "approved", { attendance: "verified" });
    await asService(db, `select public.process_no_shows()`, [], { now: at(4 * HOUR) });
    expect(await sanctionsOf(db, a)).toHaveLength(0); // threshold max(2, ⌈8/2⌉) = 4 > 3 verified
    const { happened } = first(await db.query<{ happened: boolean }>(`select happened from games where id = $1`, [g]));
    expect(happened).toBe(false);
  });

  it("TRUST-011: a game that did not happen (< 2 verified) gives no cards and excuses everyone", async () => {
    const host = await makeUser(db);
    const [a, b] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, a);
    await addParticipant(db, g, b, "approved", { attendance: "verified" });
    await asService(db, `select public.process_no_shows()`, [], { now: at(4 * HOUR) });
    expect(await sanctionsOf(db, a)).toHaveLength(0);
    const { attendance } = first(await db.query<{ attendance: string }>(`select attendance from game_participants where game_id = $1 and user_id = $2`, [g, a]));
    expect(attendance).toBe("excused");
    const [q] = await db.query<{ kind: string; dedupe_key: string }>(`select kind, dedupe_key from review_queue`);
    expect(q).toEqual({ kind: "host_reliability", dedupe_key: `game_not_happened:${g}` });
    const { happened } = first(await db.query<{ happened: boolean }>(`select happened from games where id = $1`, [g]));
    expect(happened).toBe(false);
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

  it("submit_result only between ends_at and ends_at + 2h, by the host only, one score per team", async () => {
    const host = await makeUser(db);
    const [a, out] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host, { teamCount: 2 });
    await addParticipant(db, g, a);
    const end = at(90 * MIN);
    const submit = (u: string, now: Date, scores = "{3,2}") =>
      asUser(db, u, `select * from public.submit_result($1, $2::int[])`, [g, scores], { now });
    await expectSt(submit(host, new Date(end.getTime() - MIN)), "outside_window");
    await expectSt(submit(host, new Date(end.getTime() + 2 * HOUR + 1000)), "outside_window");
    await expectSt(submit(host, end, "{3}"), "validation");
    await expectSt(submit(host, end, "{3,-1}"), "validation");
    await expectSt(submit(out, end), "forbidden");
    await expectSt(submit(a, end), "forbidden"); // security M1: approved players cannot
    const [r] = await submit(host, new Date(end.getTime() + 2 * HOUR));
    expect(r).toMatchObject({ team_scores: [3, 2], submitted_by: host });
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
    expect((await profileOf(db, host)).host_suspended_until).toEqual(new Date(at(3 * HOUR).getTime() + 14 * DAY)); // PRD TRUST-051: 14 days
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
