/**
 * Security review #2 (Phase 1.5), DB round. Each test reproduces the reported attack and asserts it
 * now fails (fixes in 0100–0108).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import {
  addParticipant, asService, asUser, at, DAY, expectSt, first, HOUR, iso, makeGame, makeUser, makeVenue, MIN, profileOf, T0,
} from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

const during = { now: at(HOUR) };
const restrict = (userId: string, now = at(HOUR)) =>
  asService(db, `select public.apply_effects($1::jsonb)`,
    [JSON.stringify([{ type: "RestrictAccountPendingReview", userId, reason: "csam_match", dedupeKey: `restrict:media_csam:${userId}` }])], { now });
const intent = (u: string, g: string, now = at(HOUR)) =>
  asUser(db, u, `select public.create_upload_intent($1, 'photo', 'image/jpeg', 1000)`, [g], { now });
const verdict = (decision: string, extra = {}) =>
  JSON.stringify({ decision, categories: [], exifStripped: true, csamHashMatch: false, source: "vision", reasonKey: null, ...extra });

async function mediaGame(o: { hide?: boolean } = {}) {
  const host = await makeUser(db);
  const venue = await makeVenue(db);
  const g = await makeGame(db, host, { venueId: venue, endsAt: at(2 * HOUR), hideExactLocation: o.hide ?? false });
  const up = await makeUser(db);
  await addParticipant(db, g, up, "approved", { attendance: "verified" });
  return { host, g, up };
}
async function published(up: string, g: string) {
  const id = (first(await asUser<{ i: { mediaId: string } }>(db, up,
    `select public.create_upload_intent($1, 'photo', 'image/jpeg', 1000) i`, [g], during))).i.mediaId;
  await asService(db, `select public.finalize_media($1, 'published', $2::jsonb, $3)`, [id, verdict("publish"), `media/${g}/${id}/display.jpg`], during);
  return id;
}

describe("H1 CSAM restriction is a durable hold (projections, uploads, hosting, re-registration)", () => {
  it("survives projection recomputes, projects host suspension, refuses uploads and hosting", async () => {
    const { g, up } = await mediaGame();
    await restrict(up);
    expect(await db.query(`select 1 from account_review_holds where user_id = $1`, [up])).toHaveLength(1);
    // Before the fix a sanction overturn/expiry recompute wiped the *_until projections.
    await db.query(`select public.st_recompute_projections($1)`, [up]);
    await asService(db, `select public.expire_sanctions()`, [], { now: at(2 * HOUR) });
    const p = await profileOf(db, up);
    for (const k of ["join_banned_until", "visibility_restricted_until", "chat_muted_until", "host_suspended_until"]) {
      expect(p[k], k).toEqual(at(HOUR + 30 * DAY));
    }
    await expectSt(intent(up, g), "forbidden");
    await expectSt(asUser(db, up, `select public.create_game('football', 'x', 'private', null, 32.08, 34.78, null, 10, $1, $2)`,
      [iso(at(DAY)), iso(at(DAY + HOUR))], during), "host_suspended");
    await expectSt(asUser(db, up, `select public.create_series($1::jsonb)`, [JSON.stringify({ sport: "football", title: "x",
      visibility: "private", venueId: null, location: { lat: 32, lng: 34.7 }, hideExactLocation: true, capacity: 10, depositMinor: 0,
      currency: "ILS", womenOnly: false, teamCount: 2, recurrence: "weekly", weekday: 2, startTime: "20:00", timeZone: "Asia/Jerusalem",
      durationMinutes: 60, startDate: "2026-11-10" })], during), "host_suspended");
  });

  it("follows the phone through delete-and-re-register", async () => {
    await db.exec(`set st.phone_hmac_key = 'test-pepper'`);
    try {
      const phone = "+972509990011";
      const old = await db.createUser({ phone });
      await asUser(db, old, `select public.create_profile('Old', 'en', 1990, 1)`, [], { now: at(-DAY) });
      await restrict(old, at(-DAY));
      await asUser(db, old, `select public.delete_my_account()`, [], { now: at(0) });
      expect(first(await db.query<{ hold_until: Date }>(`select hold_until from sanction_phone_hmac`)).hold_until).toEqual(at(29 * DAY));
      await db.query(`delete from auth.users where id = $1`, [old]);
      const fresh = await db.createUser({ phone });
      await asUser(db, fresh, `select public.create_profile('New', 'en', 1990, 1)`, [], { now: at(DAY) });
      expect(await db.query(`select 1 from account_review_holds where user_id = $1 and until = $2`, [fresh, iso(at(29 * DAY))])).toHaveLength(1);
      expect((await profileOf(db, fresh)).host_suspended_until).toEqual(at(29 * DAY));
      const { g } = await mediaGame();
      await addParticipant(db, g, fresh, "approved", { attendance: "verified" });
      await expectSt(intent(fresh, g), "forbidden");
    } finally {
      await db.exec(`reset st.phone_hmac_key`);
    }
  });
});

describe("H2 result swap after collecting confirmations", () => {
  it("changing the score resets confirmations, asks again, and stale verdicts never count", async () => {
    const host = await makeUser(db);
    const g = await makeGame(db, host);
    const vs = [await makeUser(db), await makeUser(db), await makeUser(db)];
    for (const u of vs) await addParticipant(db, g, u, "approved", { attendance: "verified" });
    await asUser(db, host, `select public.submit_result($1, '{3,1}')`, [g], { now: at(2 * HOUR) });
    for (const u of vs.slice(0, 2)) await asUser(db, u, `select public.confirm_result($1, 'confirm')`, [g], { now: at(2 * HOUR) });
    const [s1] = await asUser<{ s: { status: string } }>(db, vs[2]!, `select public.result_confirmation($1) s`, [g], { now: at(2 * HOUR) });
    expect(s1!.s.status).toBe("confirmed");
    // Attack: swap the result once the majority confirmed.
    await asUser(db, host, `select public.submit_result($1, '{1,3}')`, [g], { now: at(3 * HOUR) });
    const [s2] = await asUser<{ s: { status: string; confirms: number } }>(db, vs[2]!, `select public.result_confirmation($1) s`, [g], { now: at(3 * HOUR) });
    expect(s2!.s).toMatchObject({ status: "pending", confirms: 0 });
    expect(await db.query(`select 1 from result_confirmations where game_id = $1`, [g])).toHaveLength(0);
    expect(await db.query(`select 1 from notifications where kind = 'result_requested' and game_id = $1`, [g])).toHaveLength(2);
    // A verdict stored on another score (e.g. a race) is ignored by the summary.
    await db.query(`insert into result_confirmations (game_id, user_id, verdict, team_scores) values ($1, $2, 'confirm', '{3,1}'),
                    ($1, $3, 'confirm', '{3,1}')`, [g, vs[0], vs[1]]);
    const [s3] = await asUser<{ s: { status: string } }>(db, vs[2]!, `select public.result_confirmation($1) s`, [g], { now: at(3 * HOUR) });
    expect(s3!.s.status).toBe("pending");
  });
});

describe("M1 venue vault leak of hidden-location games", () => {
  it("hidden-location games cannot go venue_public, and hiding later demotes existing items", async () => {
    const hidden = await mediaGame({ hide: true });
    const id = await published(hidden.up, hidden.g);
    await expectSt(asUser(db, hidden.up, `select public.set_visibility($1, 'venue_public')`, [id], during), "forbidden");
    const open = await mediaGame();
    const id2 = await published(open.up, open.g);
    await asUser(db, open.up, `select public.set_visibility($1, 'venue_public')`, [id2], during);
    expect(first(await db.query<{ v: string }>(`select visibility v from media_items where id = $1`, [id2])).v).toBe("venue_public");
    await db.query(`update games set hide_exact_location = true where id = $1`, [open.g]);
    expect(first(await db.query<{ v: string }>(`select visibility v from media_items where id = $1`, [id2])).v).toBe("participants");
  });
});

describe("M2 friend-request and roster notification spam", () => {
  async function playedPair() {
    const a = await makeUser(db);
    const b = await makeUser(db);
    await db.query(`insert into connections (user_a, user_b, games_together) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 1)`, [a, b]);
    return [a, b] as const;
  }
  it("the daily limit counts an append-only log (cancelling does not refill it); a cancelled/declined pair cools down 30 days", async () => {
    const [a, b] = await playedPair();
    await asUser(db, a, `select public.request_friend($1)`, [b], { now: T0 });
    await asUser(db, a, `select public.remove_friend($1)`, [b], { now: at(MIN) }); // withdraw
    await expectSt(asUser(db, a, `select public.request_friend($1)`, [b], { now: at(2 * MIN) }), "rate_limited");
    await expectSt(asUser(db, b, `select public.request_friend($1)`, [a], { now: at(2 * MIN) }), "rate_limited");
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'friend_request'`, [b])).toHaveLength(1);
    const [c, d] = await playedPair();
    for (let i = 0; i < 30; i++) {
      await db.query(`insert into audit_log (at, actor_id, action, subject_user_id, data) values ($1, $2, 'friend.requested', $2, '{}')`,
        [iso(at(-HOUR)), c]);
    }
    await expectSt(asUser(db, c, `select public.request_friend($1)`, [d], { now: T0 }), "rate_limited");
    await asUser(db, a, `select public.request_friend($1)`, [b], { now: at(31 * DAY) });
  });

  it("join_roster notifies the host once per member (leave/rejoin loops are silent)", async () => {
    const host = await makeUser(db);
    const now = new Date("2026-10-14T12:00:00Z");
    const [s] = await asUser<{ id: string; invite_token: string }>(db, host, `select id, invite_token from public.create_series($1::jsonb)`,
      [JSON.stringify({ sport: "football", title: "W", visibility: "public", venueId: null, location: { lat: 32.08, lng: 34.78 },
        hideExactLocation: false, capacity: 10, depositMinor: 0, currency: "ILS", womenOnly: false, teamCount: 2, recurrence: "weekly",
        weekday: 2, startTime: "20:00", timeZone: "Asia/Jerusalem", durationMinutes: 90, startDate: "2026-10-20" })], { now });
    const u = await makeUser(db);
    for (let i = 0; i < 5; i++) {
      await asUser(db, u, `select public.join_roster($1)`, [s!.invite_token], { now: new Date(now.getTime() + i * MIN) });
      await asUser(db, u, `select public.leave_roster($1)`, [s!.id], { now: new Date(now.getTime() + i * MIN) });
    }
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'roster_added'`, [host])).toHaveLength(1);
  });
});

describe("M3 re-tagging after a decline", () => {
  it("the uploader can neither re-request nor quietly remove a declined tag", async () => {
    const { g, up } = await mediaGame();
    const t = await makeUser(db);
    await addParticipant(db, g, t, "approved", { attendance: "verified" });
    const id = await published(up, g);
    await asUser(db, up, `select public.tag_user($1, $2::uuid[])`, [id, [t]], during);
    await asUser(db, t, `select public.respond_tag($1, false)`, [id], during);
    await expectSt(asUser(db, up, `select public.tag_user($1, $2::uuid[])`, [id, [t]], during), "forbidden");
    await expectSt(asUser(db, up, `select public.untag($1, false, $2)`, [id, t], during), "conflict");
    expect(first(await db.query<{ status: string }>(`select status from media_tags where media_id = $1`, [id])).status).toBe("declined");
    // A self-untag with "remove from public" is also final.
    const id2 = await published(up, g);
    await asUser(db, up, `select public.tag_user($1, $2::uuid[])`, [id2, [t]], during);
    await asUser(db, t, `select public.untag($1, true)`, [id2], during);
    await expectSt(asUser(db, up, `select public.tag_user($1, $2::uuid[])`, [id2, [t]], during), "forbidden");
  });
});

describe("M4 series edit spam", () => {
  it("max 10 edits per host per 24 h, one schedule change per series per 24 h; never-joined rescheduled occurrences are deleted", async () => {
    const host = await makeUser(db);
    const now = new Date("2026-10-14T12:00:00Z");
    const [s] = await asUser<{ id: string }>(db, host, `select id from public.create_series($1::jsonb)`, [JSON.stringify({
      sport: "football", title: "W", visibility: "public", venueId: null, location: { lat: 32.08, lng: 34.78 }, hideExactLocation: false,
      capacity: 10, depositMinor: 0, currency: "ILS", womenOnly: false, teamCount: 2, recurrence: "weekly", weekday: 2, startTime: "20:00",
      timeZone: "Asia/Jerusalem", durationMinutes: 90, startDate: "2026-10-20" })], { now });
    const occ = await db.query<{ occurrence_key: string; game_id: string }>(
      `select occurrence_key, game_id from series_occurrences where series_id = $1 order by starts_at`, [s!.id]);
    const games0 = (await db.query(`select 1 from games`)).length;
    await asUser(db, host, `select public.update_series($1, 'following', $2, '{"startTime": "19:00"}'::jsonb)`, [s!.id, occ[0]!.occurrence_key], { now });
    expect((await db.query(`select 1 from games`)).length).toBe(games0); // 4 deleted, 4 regenerated
    expect(await db.query(`select 1 from series_occurrences where series_id = $1 and status = 'cancelled'`, [s!.id])).toHaveLength(0);
    const live = await db.query<{ occurrence_key: string }>(
      `select occurrence_key from series_occurrences where series_id = $1 and status = 'scheduled' order by starts_at`, [s!.id]);
    await expectSt(asUser(db, host, `select public.update_series($1, 'following', $2, '{"startTime": "18:00"}'::jsonb)`,
      [s!.id, live[0]!.occurrence_key], { now: new Date(now.getTime() + HOUR) }), "rate_limited");
    for (let i = 0; i < 9; i++) {
      await asUser(db, host, `select public.update_series($1, 'this', $2, $3::jsonb)`,
        [s!.id, live[1]!.occurrence_key, JSON.stringify({ title: `t${i}` })], { now: new Date(now.getTime() + 2 * HOUR) });
    }
    await expectSt(asUser(db, host, `select public.update_series($1, 'this', $2, '{"title": "x"}'::jsonb)`,
      [s!.id, live[1]!.occurrence_key], { now: new Date(now.getTime() + 3 * HOUR) }), "rate_limited");
  });
});

describe("L1 teams rewritten after kickoff", () => {
  it("save_teams is refused once the game started (GLK-003 'published before kickoff' cannot be faked)", async () => {
    const host = await makeUser(db);
    const g = await makeGame(db, host);
    const a = await makeUser(db);
    await addParticipant(db, g, a);
    await asUser(db, host, `select public.save_teams($1, $2::jsonb)`, [g, JSON.stringify({ [a]: 0 })], { now: at(-HOUR) });
    await expectSt(asUser(db, host, `select public.save_teams($1, $2::jsonb)`, [g, JSON.stringify({ [a]: 1 })], { now: at(MIN) }), "game_not_open");
    expect(first(await db.query<{ t: Date }>(`select teams_published_at t from games where id = $1`, [g])).t).toEqual(at(-HOUR));
  });
});

describe("L2 roster-only occurrences leak through game_views / series_occurrences", () => {
  it("non-regulars cannot read an in-window occurrence by id", async () => {
    const host = await makeUser(db);
    const now = new Date("2026-10-14T12:00:00Z");
    const [s] = await asUser<{ id: string }>(db, host, `select id from public.create_series($1::jsonb)`, [JSON.stringify({
      sport: "football", title: "W", visibility: "public", venueId: null, location: { lat: 32.08, lng: 34.78 }, hideExactLocation: false,
      capacity: 10, depositMinor: 0, currency: "ILS", womenOnly: false, teamCount: 2, recurrence: "weekly", weekday: 2, startTime: "20:00",
      timeZone: "Asia/Jerusalem", durationMinutes: 90, startDate: "2026-10-20" })], { now });
    const last = first(await db.query<{ game_id: string }>(`select game_id from series_occurrences where series_id = $1 order by starts_at desc`, [s!.id]));
    const stranger = await makeUser(db);
    const inWindow = { now: new Date(now.getTime() + HOUR) };
    expect(await asUser(db, stranger, `select 1 from game_views where id = $1`, [last.game_id], inWindow)).toHaveLength(0);
    expect(await asUser(db, stranger, `select 1 from series_occurrences where game_id = $1`, [last.game_id], inWindow)).toHaveLength(0);
    expect(await asUser(db, host, `select 1 from game_views where id = $1`, [last.game_id], inWindow)).toHaveLength(1);
  });
});

describe("L4 throwaway accounts moving Glicko ratings", () => {
  it("players without a reliability record are frozen (no rating row) but still count for opponents", async () => {
    const out = first(await db.query<{ o: { updates: { userId: string; frozen: boolean }[]; ratings: { userId: string }[] } }>(
      `select public.dm_process_rating_period($1::jsonb, public.st_p15(), $2) o`, [JSON.stringify({
        period: "2026-W45", games: [{ gameId: "g", sport: "football", formatFamily: "small_sided", endsAt: iso(T0),
          teams: [["00000000-0000-4000-8000-000000000001"], ["00000000-0000-4000-8000-000000000002"]], teamScores: [0, 1] }],
        ratings: [], reliability: { "00000000-0000-4000-8000-000000000001": null, "00000000-0000-4000-8000-000000000002": 0.9 } }),
      iso(at(7 * DAY))])).o;
    expect(out.updates.map((u) => u.frozen)).toEqual([true, false]);
    expect(out.ratings.map((r) => r.userId)).toEqual(["00000000-0000-4000-8000-000000000002"]);
  });
});

describe("L5 CSAM side channels", () => {
  it("held accounts get a bare ST:forbidden (no 'pending review' detail); CSAM blocks send the generic policy notice", async () => {
    const { g, up } = await mediaGame();
    const id = (first(await asUser<{ i: { mediaId: string } }>(db, up, `select public.create_upload_intent($1, 'photo', 'image/jpeg', 1000) i`, [g], during))).i.mediaId;
    await asService(db, `select public.finalize_media($1, 'blocked', $2::jsonb)`, [id, verdict("csam", { csamHashMatch: true, source: "hash", reasonKey: "media.blocked.csam" })], during);
    const [n] = await db.query<{ p: Record<string, unknown> }>(`select params p from notifications where user_id = $1 and kind = 'media_blocked'`, [up]);
    expect(n!.p).toEqual({ mediaId: id, reasonKey: "media.blocked.policy" });
    await restrict(up);
    const err = await intent(up, g).then(() => null, (e: unknown) => e as { message: string; detail?: string });
    expect(err!.message).toBe("ST:forbidden");
    expect(err!.detail ?? "").toBe("");
  });
});

describe("Retention: blocked items and orphaned originals", () => {
  it("blocked non-CSAM items are removed after the retention period; CSAM evidence is kept", async () => {
    const { g, up } = await mediaGame();
    const mk = async () => (first(await asUser<{ i: { mediaId: string } }>(db, up, `select public.create_upload_intent($1, 'photo', 'image/jpeg', 1000) i`, [g], during))).i.mediaId;
    const policy = await mk();
    const csam = await mk();
    await asService(db, `select public.finalize_media($1, 'blocked', $2::jsonb)`, [policy, verdict("block")], during);
    await asService(db, `select public.finalize_media($1, 'blocked', $2::jsonb)`, [csam, verdict("csam", { csamHashMatch: true })], during);
    await asService(db, `select public.purge_media()`, [], { now: new Date("2027-11-03T00:00:00Z") });
    const rows = await db.query<{ id: string; status: string }>(`select id, status from media_items order by status`);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [policy]: "removed", [csam]: "blocked" });
  });

  it("purge_orphan_originals finds originals without a live item after 24 h (storage schema present)", async () => {
    const { g, up } = await mediaGame();
    expect(first(await asService<{ n: number }>(db, `select public.purge_orphan_originals() n`, [], during)).n).toBe(0); // no storage schema
    const live = (first(await asUser<{ i: { storagePath: string } }>(db, up, `select public.create_upload_intent($1, 'photo', 'image/jpeg', 1000) i`, [g], during))).i.storagePath;
    await db.exec(`create schema storage; create table storage.objects (bucket_id text, name text, created_at timestamptz);`);
    try {
      await db.query(`insert into storage.objects values ('media', $1, $2), ('media', 'originals/x/y/orphan.jpg', $2),
                      ('media', 'media/x/y/display.jpg', $2), ('media', 'originals/x/y/fresh.jpg', $3)`,
        [live, iso(at(-2 * DAY)), iso(at(HOUR))]);
      expect(first(await asService<{ n: number }>(db, `select public.purge_orphan_originals() n`, [], { now: at(2 * HOUR) })).n).toBe(1);
    } finally {
      await db.exec(`drop schema storage cascade`);
    }
  });
});
