/**
 * Media Vault (deferred-phases §7): upload intents (AC-VAULT-001, limits, cap), the service-only
 * pipeline finalisation (CSAM legal hold), consent tagging and venue_public (AC-VAULT-004/005),
 * galleries, reports, retention, account deletion and the CSAM review hold.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { addParticipant, asService, asUser, at, DAY, first, HOUR, iso, makeGame, makeModerator, makeUser, makeVenue, MIN, T0 } from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

// Game 18:00–20:00Z (T0 = 2026-11-02T18:00Z): uploads accepted 18:00 … 22:00 inclusive.
const END = at(2 * HOUR);
const during = { now: at(HOUR) };
const MB = 1024 * 1024;

async function scenario(o: { women?: boolean; visibility?: "public" | "private" } = {}) {
  const host = await makeUser(db, { gender: "female" });
  const venue = await makeVenue(db);
  const g = await makeGame(db, host, { venueId: venue, endsAt: END, womenOnly: o.women, visibility: o.visibility });
  const [up, a, b, c] = [await makeUser(db, { gender: "female" }), await makeUser(db, { gender: "female" }),
    await makeUser(db, { gender: "female" }), await makeUser(db, { gender: "female" })];
  for (const u of [up, a, b, c]) await addParticipant(db, g, u, "approved", { attendance: "verified" });
  return { host, venue, g, up, a, b, c };
}
const intent = (u: string, g: string, kind = "photo", mime = "image/jpeg", size = 5 * MB, dur: number | null = null, now = at(HOUR)) =>
  asUser<{ i: { mediaId: string; storagePath: string; maxBytes: number; expiresAt: string } }>(db, u,
    `select public.create_upload_intent($1, $2::public.media_kind, $3, $4, $5) i`, [g, kind, mime, size, dur], { now });
const reject = (p: Promise<unknown>, code: string, reason: string) => expect(p).rejects.toThrow(new RegExp(`^ST:${code}: ${reason}$`));

async function published(u: string, g: string) {
  const { mediaId } = first(await intent(u, g)).i;
  await asService(db, `select public.finalize_media($1, 'published', $2::jsonb, $3)`,
    [mediaId, JSON.stringify({ decision: "publish", categories: [], exifStripped: true, csamHashMatch: false, source: "vision", reasonKey: null }),
     `media/${g}/${mediaId}/display.jpg`], during);
  return mediaId;
}
const item = async (id: string) =>
  first(await db.query<{ status: string; visibility: string; public_opt_in: boolean; legal_hold: boolean; hidden_pending_review: boolean }>(
    `select status, visibility, public_opt_in, legal_hold, hidden_pending_review from media_items where id = $1`, [id]));

describe("create_upload_intent (VAULT-001/002)", () => {
  it("verified attendees get an originals/ key and the size cap", async () => {
    const { g, up } = await scenario();
    const { i } = first(await intent(up, g));
    expect(i.storagePath).toBe(`originals/${g}/${up}/${i.mediaId}.jpg`);
    expect(i.maxBytes).toBe(20 * MB);
    expect(i.expiresAt).toBe(iso(at(3 * HOUR)));
    expect((await item(i.mediaId)).status).toBe("processing");
  });

  it("AC-VAULT-001: ended 20:00, upload at 22:05 → gallery locked; 22:00 still open; before start not open", async () => {
    const { g, up } = await scenario();
    await reject(intent(up, g, "photo", "image/jpeg", MB, null, at(4 * HOUR + 5 * MIN)), "outside_window", "window_closed");
    expect(await intent(up, g, "photo", "image/jpeg", MB, null, at(4 * HOUR))).toHaveLength(1);
    await reject(intent(up, g, "photo", "image/jpeg", MB, null, at(-MIN)), "outside_window", "window_not_open");
  });

  it("limits: not verified, type (gif, HEIC: pipeline cannot sanitise), size, video length, 30 per user per game", async () => {
    const { g, up } = await scenario();
    const outsider = await makeUser(db);
    await addParticipant(db, g, outsider, "approved");
    await reject(intent(outsider, g), "forbidden", "not_verified_attendee");
    await reject(intent(up, g, "photo", "image/gif"), "validation", "unsupported_type");
    await reject(intent(up, g, "photo", "image/heic"), "validation", "unsupported_type");
    await reject(intent(up, g, "photo", "image/jpeg", 20 * MB + 1), "validation", "too_large");
    await reject(intent(up, g, "video", "video/mp4", 50 * MB, null), "validation", "unsupported_type");
    await reject(intent(up, g, "video", "video/mp4", 50 * MB, 61), "validation", "too_long");
    await reject(intent(up, g, "video", "video/mp4", 200 * MB + 1, 30), "validation", "too_large");
    expect(first(await intent(up, g, "video", "video/mp4", 200 * MB, 60)).i.maxBytes).toBe(200 * MB);
    for (let i = 1; i < 30; i++) await intent(up, g);
    await reject(intent(up, g), "rate_limited", "user_cap_reached");
  });
});

describe("finalize_media (service role, VAULT-003)", () => {
  it("clients cannot finalise; publish is idempotent; paths are confined to the item; block notifies; CSAM is held with the same generic notice", async () => {
    const { g, up } = await scenario();
    const { mediaId } = first(await intent(up, g)).i;
    const v = (decision: string, extra = {}) => JSON.stringify({ decision, categories: [], exifStripped: true, csamHashMatch: false, source: "vision", reasonKey: null, ...extra });
    await expect(asUser(db, up, `select public.finalize_media($1, 'published', $2::jsonb, 'media/x')`, [mediaId, v("publish")]))
      .rejects.toThrow(/permission denied/);
    await expect(asService(db, `select public.finalize_media($1, 'published', $2::jsonb, $3)`, [mediaId, v("publish"), `media/${g}/other/display.jpg`]))
      .rejects.toThrow(/^ST:validation$/);
    await expect(asService(db, `select public.finalize_media($1, 'published', $2::jsonb, $3)`, [mediaId, v("block"), `media/${g}/${mediaId}/d.jpg`]))
      .rejects.toThrow(/^ST:validation$/);
    const ok = () => asService<{ s: string }>(db, `select public.finalize_media($1, 'published', $2::jsonb, $3) s`, [mediaId, v("publish"), `media/${g}/${mediaId}/display.jpg`], during);
    expect(first(await ok()).s).toBe("published");
    expect(first(await asService<{ s: string }>(db, `select public.finalize_media($1, 'blocked', $2::jsonb) s`, [mediaId, v("block")], during)).s)
      .toBe("published"); // idempotent: only a processing item changes
    const blocked = first(await intent(up, g)).i.mediaId;
    await asService(db, `select public.finalize_media($1, 'blocked', $2::jsonb)`, [blocked, v("block", { reasonKey: "media.blocked.policy" })], during);
    expect(await db.query(`select 1 from notifications where user_id = $1 and kind = 'media_blocked'`, [up])).toHaveLength(1);
    const csam = first(await intent(up, g)).i.mediaId;
    await asService(db, `select public.finalize_media($1, 'blocked', $2::jsonb)`, [csam, v("csam", { csamHashMatch: true, source: "hash" })], during);
    expect(await item(csam)).toMatchObject({ status: "blocked", legal_hold: true });
    // Same generic policy notice as any block (security review #2 L5).
    const notes = await db.query<{ p: { reasonKey: string } }>(`select params p from notifications where user_id = $1 and kind = 'media_blocked'`, [up]);
    expect(notes.map((n) => n.p.reasonKey)).toEqual(["media.blocked.policy", "media.blocked.policy"]);
  });

  it("CSAM review hold (RestrictAccountPendingReview via apply_effects): no uploads/joins/chat/hosting until a moderator dismisses", async () => {
    const { g, up } = await scenario();
    const mod = await makeModerator(db);
    await asService(db, `select public.apply_effects($1::jsonb)`, [JSON.stringify([
      { type: "RestrictAccountPendingReview", userId: up, reason: "csam_match", dedupeKey: "restrict:media_csam:x" },
      { type: "EnqueueReview", item: { kind: "media_csam", priority: "high", subjectUserId: up, venueId: null, gameId: g, sanctionId: null,
        appealId: null, reportIds: [], evidence: {}, dueBy: iso(at(2 * HOUR)), dedupeKey: "media_csam:x" } },
    ])], during);
    const p = first(await db.query<{ j: Date | null; v: Date | null; c: Date | null; h: Date | null }>(
      `select join_banned_until j, visibility_restricted_until v, chat_muted_until c, host_suspended_until h from profiles where id = $1`, [up]));
    for (const d of [p.j, p.v, p.c, p.h]) expect(d!.getTime()).toBe(at(HOUR + 30 * DAY).getTime());
    await expect(intent(up, g)).rejects.toThrow(/^ST:forbidden$/);
    // Projections survive an unrelated recompute (the hold is durable, not just a projection).
    await db.query(`select public.st_recompute_projections($1)`, [up]);
    expect(first(await db.query<{ j: Date | null }>(`select join_banned_until j from profiles where id = $1`, [up])).j).not.toBeNull();
    const [rq] = await db.query<{ id: string }>(`select id from review_queue where dedupe_key = 'media_csam:x'`);
    await asUser(db, mod, `select public.moderator_decide($1, 'dismiss', 'false positive')`, [rq!.id], during);
    expect(first(await db.query<{ j: Date | null }>(`select join_banned_until j from profiles where id = $1`, [up])).j).toBeNull();
    expect(await intent(up, g)).toHaveLength(1);
  });
});

describe("consent tagging and venue_public (VAULT-004/005)", () => {
  it("AC-VAULT-004: 2 of 3 accepted → stays participants until the third accepts; a new tag demotes again", async () => {
    const { g, up, a, b, c, host } = await scenario();
    const id = await published(up, g);
    await asUser(db, up, `select public.tag_user($1, $2::uuid[])`, [id, [a, b, c]], during);
    expect(await db.query(`select 1 from notifications where kind = 'media_tag_request'`)).toHaveLength(3);
    for (const u of [a, b]) await asUser(db, u, `select public.respond_tag($1, true)`, [id], during);
    const [r] = await asUser<{ v: { visibility: string; publicOptIn: boolean; pendingUserIds: string[] } }>(db, up,
      `select public.set_visibility($1, 'venue_public') v`, [id], during);
    expect(r!.v).toMatchObject({ visibility: "participants", publicOptIn: true, pendingUserIds: [c] });
    await asUser(db, c, `select public.respond_tag($1, true)`, [id], during);
    expect((await item(id)).visibility).toBe("venue_public");
    await asUser(db, up, `select public.tag_user($1, $2::uuid[])`, [id, [host]], during);
    expect((await item(id)).visibility).toBe("participants");
    await asUser(db, up, `select public.untag($1, false, $2)`, [id, host], during); // uploader removes the pending tag
    expect((await item(id)).visibility).toBe("venue_public");
  });

  it("AC-VAULT-005: a non-accepted tag blocks venue_public; non-uploaders are refused; a decline/remove-from-public vetoes for good", async () => {
    const { g, up, a, b } = await scenario();
    const id = await published(up, g);
    await asUser(db, up, `select public.tag_user($1, $2::uuid[])`, [id, [a, b]], during);
    await expect(asUser(db, a, `select public.set_visibility($1, 'venue_public')`, [id], during)).rejects.toThrow(/^ST:forbidden: not_uploader$/);
    await asUser(db, up, `select public.set_visibility($1, 'venue_public')`, [id], during);
    expect((await item(id)).visibility).toBe("participants");
    await asUser(db, a, `select public.respond_tag($1, false)`, [id], during); // decline = veto
    await asUser(db, b, `select public.respond_tag($1, true)`, [id], during);
    // The uploader can neither remove nor re-request a declined tag (security review #2 M3); the veto stands.
    await expect(asUser(db, up, `select public.untag($1, false, $2)`, [id, a], during)).rejects.toThrow(/^ST:conflict$/);
    await expect(asUser(db, up, `select public.tag_user($1, $2::uuid[])`, [id, [a]], during)).rejects.toThrow(/^ST:forbidden$/);
    expect((await item(id)).visibility).toBe("participants");
    const id2 = await published(up, g);
    await asUser(db, up, `select public.tag_user($1, $2::uuid[])`, [id2, [b]], during);
    await asUser(db, b, `select public.respond_tag($1, true)`, [id2], during);
    await asUser(db, up, `select public.set_visibility($1, 'venue_public')`, [id2], during);
    expect((await item(id2)).visibility).toBe("venue_public");
    await asUser(db, b, `select public.untag($1, true)`, [id2], during); // untag + remove from public
    expect((await item(id2)).visibility).toBe("participants");
    await asUser(db, up, `select public.set_visibility($1, 'venue_public')`, [id2], during);
    expect((await item(id2)).visibility).toBe("participants");
  });

  it("tag rules: uploader only, participants only, no self/duplicates, blocked pairs, tags invisible until accepted", async () => {
    const { g, up, a, b } = await scenario();
    const stranger = await makeUser(db);
    const id = await published(up, g);
    const tag = (by: string, users: string[]) => asUser(db, by, `select public.tag_user($1, $2::uuid[])`, [id, users], during);
    await expect(tag(a, [b])).rejects.toThrow(/^ST:forbidden$/);
    await expect(tag(up, [stranger])).rejects.toThrow(/^ST:forbidden$/);
    await expect(tag(up, [up])).rejects.toThrow(/^ST:validation$/);
    await expect(tag(up, [a, a])).rejects.toThrow(/^ST:validation$/);
    await db.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [b, up]);
    await expect(tag(up, [b])).rejects.toThrow(/^ST:blocked$/);
    await tag(up, [a]);
    await expect(tag(up, [a])).rejects.toThrow(/^ST:conflict$/);
    const host = first(await db.query<{ host_id: string }>(`select host_id from games where id = $1`, [g])).host_id;
    expect(await asUser(db, host, `select * from media_tags`, [], during)).toHaveLength(0); // requested: invisible to others
    expect(await asUser(db, a, `select * from public.my_tag_requests()`, [], during)).toHaveLength(1);
    await asUser(db, a, `select public.respond_tag($1, true)`, [id], during);
    expect(await asUser(db, host, `select * from media_tags`, [], during)).toHaveLength(1);
    await expect(asUser(db, a, `select public.respond_tag($1, true)`, [id], during)).rejects.toThrow(/^ST:not_found$/);
  });

  it("private and women-only games never reach the venue vault (no location trail)", async () => {
    for (const o of [{ visibility: "private" as const }, { women: true }]) {
      const { g, up } = await scenario(o);
      const id = await published(up, g);
      await expect(asUser(db, up, `select public.set_visibility($1, 'venue_public')`, [id], during)).rejects.toThrow(/^ST:forbidden$/);
    }
  });
});

describe("galleries, reports, retention, deletion", () => {
  it("game_gallery is for participants; venue_vault shows only venue_public + published items", async () => {
    const { g, venue, up, a } = await scenario();
    const pub = await published(up, g);
    const priv = await published(up, g);
    await asUser(db, up, `select public.set_visibility($1, 'venue_public')`, [pub], during);
    const stranger = await makeUser(db);
    await expect(asUser(db, stranger, `select * from public.game_gallery($1)`, [g], during)).rejects.toThrow(/^ST:forbidden$/);
    const gal = await asUser<{ game_gallery: { id: string } }>(db, a, `select * from public.game_gallery($1)`, [g], during);
    expect(gal.map((r) => r.game_gallery.id).sort()).toEqual([pub, priv].sort());
    const vault = await asUser<{ venue_vault: { id: string; storagePath: string } }>(db, stranger,
      `select * from public.venue_vault($1, $2, $3)`, [venue, iso(at(-DAY)), iso(at(DAY))], during);
    expect(vault.map((r) => r.venue_vault.id)).toEqual([pub]);
    expect(vault[0]!.venue_vault.storagePath).toMatch(/^media\//);
    expect(await asUser(db, stranger, `select * from public.venue_vault($1, $2, $3)`, [venue, iso(at(DAY)), iso(at(2 * DAY))], during)).toHaveLength(0);
    expect(await asUser(db, stranger, `select id from media_items`, [], during)).toHaveLength(1);
    await expect(asUser(db, up, `select storage_path from media_items`)).rejects.toThrow(/permission denied/);
    // Storage object policy helpers: published display objects only, never originals.
    const can = async (u: string, name: string) =>
      first(await asUser<{ ok: boolean }>(db, u, `select public.st_media_object_readable($1) ok`, [name], during)).ok;
    expect(await can(stranger, `media/${g}/${pub}/display.jpg`)).toBe(true);
    expect(await can(stranger, `media/${g}/${priv}/display.jpg`)).toBe(false);
    expect(await can(a, `media/${g}/${priv}/display.jpg`)).toBe(true);
    expect(await can(a, `originals/${g}/${up}/${priv}.jpg`)).toBe(false);
  });

  it("report_media: once per reporter; 3 distinct reporters hide it pending review; a moderator restores or removes", async () => {
    const { g, up, a, b, c } = await scenario();
    const mod = await makeModerator(db);
    const id = await published(up, g);
    await expect(asUser(db, up, `select public.report_media($1, 'privacy')`, [id], during)).rejects.toThrow(/^ST:validation$/);
    for (const u of [a, b]) await asUser(db, u, `select public.report_media($1, 'privacy')`, [id], during);
    await expect(asUser(db, a, `select public.report_media($1, 'privacy')`, [id], during)).rejects.toThrow(/^ST:already_reported$/);
    expect((await item(id)).hidden_pending_review).toBe(false);
    await asUser(db, c, `select public.report_media($1, 'nudity')`, [id], during);
    expect((await item(id)).hidden_pending_review).toBe(true);
    expect(await asUser(db, a, `select * from public.game_gallery($1)`, [g], during)).toHaveLength(0);
    expect(await db.query(`select 1 from review_queue where kind = 'media_report' and dedupe_key = $1`, [`media_report:${id}`])).toHaveLength(1);
    await expect(asUser(db, a, `select public.moderate_media($1, 'restore')`, [id], during)).rejects.toThrow(/^ST:forbidden$/);
    await asUser(db, mod, `select public.moderate_media($1, 'restore')`, [id], during);
    expect(await asUser(db, a, `select * from public.game_gallery($1)`, [g], during)).toHaveLength(1);
  });

  it("retention: removed after 12 months (legal hold kept); stale never-completed uploads after 24 h", async () => {
    const { g, up } = await scenario();
    const id = await published(up, g);
    const stale = first(await intent(up, g)).i.mediaId;
    const held = first(await intent(up, g)).i.mediaId;
    await db.query(`update media_items set legal_hold = true where id = $1`, [held]);
    await asService(db, `select public.purge_media()`, [], { now: at(2 * DAY) });
    expect([(await item(id)).status, (await item(stale)).status, (await item(held)).status]).toEqual(["published", "removed", "processing"]);
    await asService(db, `select public.purge_media()`, [], { now: new Date("2027-11-02T20:00:00Z") });
    expect((await item(id)).status).toBe("removed");
    await asService(db, `select public.purge_media()`, [], { now: new Date("2027-12-15T00:00:00Z") });
    expect(await db.query(`select id from media_items order by id`)).toEqual([{ id: held }]);
  });

  it("account deletion: own items deleted; tags on others' items removed with a veto (item leaves venue_public)", async () => {
    const { g, up, a } = await scenario();
    const own = await published(a, g);
    const other = await published(up, g);
    await asUser(db, up, `select public.tag_user($1, $2::uuid[])`, [other, [a]], during);
    await asUser(db, a, `select public.respond_tag($1, true)`, [other], during);
    await asUser(db, up, `select public.set_visibility($1, 'venue_public')`, [other], during);
    expect((await item(other)).visibility).toBe("venue_public");
    await asUser(db, a, `select public.delete_my_account()`, [], during);
    expect(await db.query(`select 1 from media_items where id = $1`, [own])).toHaveLength(0);
    expect(first(await db.query<{ status: string; veto_public: boolean }>(`select status, veto_public from media_tags where media_id = $1`, [other])))
      .toEqual({ status: "removed", veto_public: true });
    expect((await item(other)).visibility).toBe("participants");
    expect(T0).toBeTruthy();
  });
});
