import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import {
  addParticipant, asService, asUser, at, DAY, expectSt, HOUR, iso, makeGame, makeUser, makeVenue, MIN, profileOf, sanctionsOf,
} from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

async function send(gameId: string, sender: string, body: string, now = at(0)): Promise<string> {
  const [r] = await asService<{ id: string }>(db,
    `insert into chat_messages (game_id, sender_id, body, client_msg_id, created_at) values ($1, $2, $3, gen_random_uuid()::text, $4) returning id`,
    [gameId, sender, body, iso(now)]);
  return r!.id;
}

describe("chat", () => {
  it("readable by approved participants only, before expiry (ends_at + 3h), blocked senders hidden; no client writes", async () => {
    const host = await makeUser(db);
    const [a, b, req, stranger] = [await makeUser(db), await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, a);
    await addParticipant(db, g, b);
    await addParticipant(db, g, req, "requested");
    await send(g, a, "hi from a");
    await send(g, b, "hi from b");
    const [{ expires_at }] = await db.query<{ expires_at: Date }>(`select expires_at from chat_messages limit 1`);
    expect(expires_at).toEqual(at(90 * MIN + 3 * HOUR));
    const read = (u: string, now = at(HOUR)) => asUser<{ body: string }>(db, u, `select body from chat_messages order by body`, [], { now });
    expect((await read(host)).map((m) => m.body)).toEqual(["hi from a", "hi from b"]);
    expect(await read(req)).toHaveLength(0);
    expect(await read(stranger)).toHaveLength(0);
    expect(await read(a, at(5 * HOUR))).toHaveLength(0);
    await db.query(`insert into blocks values ($1, $2)`, [b, a]);
    expect((await read(a)).map((m) => m.body)).toEqual(["hi from a"]);
    await expect(asUser(db, a, `insert into chat_messages (game_id, sender_id, body, client_msg_id) values ($1, $2, 'x', 'c')`, [g, a]))
      .rejects.toThrow(/permission denied/);
  });

  it("purge deletes expired chat but keeps reported messages in 90-day retention (legal hold respected)", async () => {
    const host = await makeUser(db);
    const [a, b] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, a);
    await addParticipant(db, g, b);
    const bad = await send(g, b, "abusive");
    await send(g, b, "fine");
    // Reporter cannot report a message that is not the target's.
    await expectSt(asUser(db, a, `select public.report_user($1, 'harassment', null, $2)`, [host, bad], { now: at(HOUR) }), "validation");
    await asUser(db, a, `select public.report_user($1, 'harassment', null, $2)`, [b, bad], { now: at(HOUR) });
    const [ret] = await db.query<{ body: string; expires_at: Date }>(`select body, expires_at from moderation_retained`);
    expect(ret).toEqual({ body: "abusive", expires_at: at(HOUR + 90 * DAY) });
    expect(await asUser(db, a, `select * from moderation_retained`).catch((e: Error) => e.message)).toMatch(/permission denied/);

    expect((await asService<{ n: number }>(db, `select public.purge_expired_messages() n`, [], { now: at(4 * HOUR) }))[0]!.n).toBe(0);
    expect((await asService<{ n: number }>(db, `select public.purge_expired_messages() n`, [], { now: at(90 * MIN + 3 * HOUR) }))[0]!.n).toBe(2);
    expect(await db.query(`select 1 from chat_messages`)).toHaveLength(0);
    expect(await db.query(`select 1 from moderation_retained`)).toHaveLength(1);

    await db.query(`insert into moderation_retained (body, reason, expires_at, legal_hold) values ('held', 'blocked', $1, true)`, [iso(at(DAY))]);
    expect((await asService<{ n: number }>(db, `select public.purge_retained() n`, [], { now: at(89 * DAY) }))[0]!.n).toBe(0);
    expect((await asService<{ n: number }>(db, `select public.purge_retained() n`, [], { now: at(91 * DAY) }))[0]!.n).toBe(1);
    const left = await db.query<{ body: string }>(`select body from moderation_retained`);
    expect(left).toEqual([{ body: "held" }]);
  });

  it("recheck_pending_messages counts pending messages (dispatch is a no-op without pg_net)", async () => {
    const host = await makeUser(db);
    const g = await makeGame(db, host);
    await asService(db, `insert into chat_messages (game_id, sender_id, body, client_msg_id, moderation, created_at)
                         values ($1, $2, 'x', 'c1', 'pending', $3)`, [g, host, iso(at(0))]);
    expect((await asService<{ n: number }>(db, `select public.recheck_pending_messages() n`, [], { now: at(MIN) }))[0]!.n).toBe(1);
  });
});

describe("deposits", () => {
  async function depositGame() {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host, { depositMinor: 500 });
    await addParticipant(db, g, p);
    const [pm] = await db.query<{ id: string }>(
      `insert into payments (user_id, game_id, amount_minor, currency, status, deposit_state, idempotency_key)
       values ($1::uuid, $2::uuid, 500, 'EUR', 'succeeded', 'setup', 'deposit:' || $2::text || ':' || $1::text || ':setup') returning id`, [p, g]);
    return { host, p, g, pm: pm!.id };
  }

  it("holds are due from T−24h for approved players with a saved method", async () => {
    const { pm } = await depositGame();
    expect(await asService(db, `select * from public.due_deposit_holds()`, [], { now: at(-25 * HOUR) })).toHaveLength(0);
    const due = await asService<{ payment_id: string }>(db, `select * from public.due_deposit_holds()`, [], { now: at(-23 * HOUR) });
    expect(due.map((d) => d.payment_id)).toEqual([pm]);
    expect((await asService<{ n: number }>(db, `select public.place_deposit_holds() n`, [], { now: at(-23 * HOUR) }))[0]!.n).toBe(1);
    expect((await asService<{ n: number }>(db, `select public.place_deposit_holds() n`, [], { now: at(-23 * HOUR + MIN) }))[0]!.n).toBe(0);
  });

  it("no-show deposit is forfeited only after the undisputed 48h window; disputed → waits; overturned → release", async () => {
    const { p, g, pm } = await depositGame();
    await db.query(`update payments set deposit_state = 'held', status = 'requires_capture' where id = $1`, [pm]);
    const close = at(90 * MIN + 2 * HOUR);
    await asService(db, `select public.process_no_shows()`, [], { now: close });
    const due = (d: Date) => asService<{ outcome: string }>(db, `select * from public.due_deposit_settlements()`, [], { now: d });
    expect(await due(new Date(close.getTime() + 47 * HOUR))).toHaveLength(0);
    expect((await due(new Date(close.getTime() + 48 * HOUR))).map((x) => x.outcome)).toEqual(["forfeit"]);
    const [card] = await sanctionsOf(db, p);
    await asUser(db, p, `select public.file_appeal($1, 'was there')`, [card!.id], { now: new Date(close.getTime() + HOUR) });
    expect(await due(new Date(close.getTime() + 48 * HOUR))).toHaveLength(0);
    await asService(db, `select public.expire_sanctions()`, [], { now: new Date(close.getTime() + 7 * DAY + 2 * HOUR) });
    expect((await due(new Date(close.getTime() + 7 * DAY + 2 * HOUR))).map((x) => x.outcome)).toEqual(["release"]);
    expect((await asService<{ n: number }>(db, `select public.settle_deposits() n`, [], { now: new Date(close.getTime() + 8 * DAY) }))[0]!.n).toBe(1);
    const [{ settlement_requested }] = await db.query<{ settlement_requested: string }>(`select settlement_requested from payments where id = $1`, [pm]);
    expect(settlement_requested).toBe("release");
    expect(g).toBeTruthy();
  });

  it("verified attendance releases; payments are readable by their owner only", async () => {
    const { p, g, host } = await depositGame();
    await db.query(`update game_participants set attendance = 'verified', check_in_method = 'qr', checked_in_at = now() where game_id = $1 and user_id = $2`, [g, p]);
    expect((await asService<{ outcome: string }>(db, `select * from public.due_deposit_settlements()`, [], { now: at(HOUR) })).map((x) => x.outcome))
      .toEqual(["release"]);
    expect(await asUser(db, p, `select id from payments`)).toHaveLength(1);
    expect(await asUser(db, host, `select id from payments`)).toHaveLength(0);
  });
});

describe("delete_my_account", () => {
  it("anonymises the profile, erases private data, leaves future games without a card and keeps pseudonymised sanctions", async () => {
    const u = await makeUser(db, { name: "Real Name" });
    const host = await makeUser(db);
    const other = await makeUser(db);
    const past = await makeGame(db, host, { startsAt: at(-10 * DAY), endsAt: at(-10 * DAY + HOUR) });
    await addParticipant(db, past, u, "approved", { attendance: "no_show_unverified" });
    const future = await makeGame(db, host, { capacity: 2 });
    await addParticipant(db, future, u);
    await addParticipant(db, future, other, "waitlisted");
    const myGame = await makeGame(db, u, { startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR) });
    await addParticipant(db, myGame, other);
    const venue = await makeVenue(db, { createdBy: u });
    await db.query(`insert into venue_ratings (venue_id, user_id, sport, overall) values ($1, $2, 'football', 4)`, [venue, u]);
    await db.query(`insert into user_sports (user_id, sport, self_skill, attributes) values ($1, 'football', 3, '{"speed":3,"control":3,"overall":3}')`, [u]);
    await db.query(`insert into push_tokens (user_id, token, platform) values ($1, 'ExponentPushToken[abc]', 'ios')`, [u]);
    await db.query(`insert into blocks values ($1, $2)`, [other, u]);
    await db.query(`insert into sanctions (user_id, kind, reason_code, statement_key, starts_at, expires_at, dispute_until, dedupe_key)
                    values ($1, 'yellow_card', 'no_show', 'sanctions.reason.no_show', $2, $3, $4, 'ns-old')`,
      [u, iso(at(-10 * DAY)), iso(at(20 * DAY)), iso(at(-8 * DAY))]);
    await send(future, u, "see you");

    const now = { now: at(-HOUR) }; // inside the late-cancel window: still no card
    await asUser(db, u, `select public.delete_my_account()`, [], now);
    await asUser(db, u, `select public.delete_my_account()`, [], now); // idempotent

    const p = await profileOf(db, u);
    expect(p).toMatchObject({ display_name: "Deleted user", avatar_url: null, bio: null });
    expect(p.deleted_at).not.toBeNull();
    for (const t of ["profile_private where user_id", "push_tokens where user_id", "user_sports where user_id", "venue_ratings where user_id",
      "blocks where blocked_id", "chat_messages where sender_id", "notifications where user_id"]) {
      expect(await db.query(`select 1 from ${t} = $1`, [u])).toHaveLength(0);
    }
    const s = await sanctionsOf(db, u);
    expect(s.map((x) => x.dedupe_key)).toEqual(["ns-old"]);
    const [part] = await db.query<{ status: string; late_cancel: boolean }>(`select status, late_cancel from game_participants where game_id = $1 and user_id = $2`, [future, u]);
    expect(part).toEqual({ status: "cancelled", late_cancel: false });
    const [{ offer }] = await db.query<{ offer: Date | null }>(`select offer_expires_at offer from game_participants where game_id = $1 and user_id = $2`, [future, other]);
    expect(offer).not.toBeNull();
    const [{ status }] = await db.query<{ status: string }>(`select status from games where id = $1`, [myGame]);
    expect(status).toBe("cancelled");
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'game_cancelled'`, [other])).toHaveLength(1);
    expect(await asUser(db, other, `select id from public_profiles where id = $1`, [u])).toHaveLength(0);
    const [{ created_by }] = await db.query<{ created_by: string | null }>(`select created_by from venues where id = $1`, [venue]);
    expect(created_by).toBeNull();
    // A deleted account can no longer act.
    await expectSt(asUser(db, u, `select public.report_user($1, 'spam')`, [other]), "forbidden");
  });
});

describe("retention purge (compliance §4)", () => {
  it("pseudonymises reporters after 12 months, deletes audit after 2 years and trust rows of accounts deleted > 2 years ago", async () => {
    const [r, t] = [await makeUser(db), await makeUser(db)];
    await db.query(`insert into user_reports (reporter_id, target_user_id, category, note, created_at) values ($1, $2, 'spam', 'n', $3)`,
      [r, t, iso(at(-400 * DAY))]);
    await db.query(`insert into audit_log (at, action) values ($1, 'old'), ($2, 'new')`, [iso(at(-800 * DAY)), iso(at(-DAY))]);
    await db.query(`update profiles set deleted_at = $2 where id = $1`, [t, iso(at(-800 * DAY))]);
    await db.query(`insert into sanctions (user_id, kind, reason_code, statement_key, starts_at, expires_at, dedupe_key, status)
                    values ($1, 'join_ban', 'no_show', 'sanctions.reason.no_show', $2, $3, 'old', 'expired')`, [t, iso(at(-900 * DAY)), iso(at(-890 * DAY))]);
    const [{ r: res }] = await asService<{ r: Record<string, number> }>(db, `select public.purge_retention() r`, [], { now: at(0) });
    expect(res).toMatchObject({ reportsPseudonymised: 1, auditDeleted: 1 });
    const [rep] = await db.query<{ reporter_id: string | null; note: string | null }>(`select reporter_id, note from user_reports`);
    expect(rep).toEqual({ reporter_id: null, note: null });
    expect(await db.query(`select 1 from sanctions where user_id = $1`, [t])).toHaveLength(0);
  });
});
