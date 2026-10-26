/**
 * Security regressions (adversarial review, DB round). Each test reproduces the reported attack
 * and asserts it now fails.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import {
  addParticipant, asService, asUser, at, DAY, expectSt, first, HOUR, iso, makeGame, makeModerator, makeUser, makeVenue, MIN,
  profileOf, sanctionsOf, T0,
} from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

const before = { now: at(-DAY) };
const createGame = (host: string, extra: string, now = before) =>
  asUser<Record<string, unknown>>(db, host,
    `select * from public.create_game('football', 'x', 'public', null, 32.08, 34.78, null, 10, $1, $2${extra})`,
    [iso(T0), iso(at(90 * MIN))], now);

describe("H1 late-cancel erasure (cancel → request_join → cancel)", () => {
  it("a pending late cancel cannot be re-opened, so the card at finalisation stands", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const [v1, v2] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    for (const u of [v1, v2]) await addParticipant(db, g, u, "approved", { attendance: "verified", method: "gps" });
    await asUser(db, p, `select public.cancel_participation($1)`, [g], { now: at(-HOUR) });
    await expectSt(asUser(db, p, `select public.request_join($1)`, [g], { now: at(-50 * MIN) }), "conflict");
    await asService(db, `select public.process_no_shows()`, [], { now: at(4 * HOUR) });
    expect((await sanctionsOf(db, p)).map((s) => s.reason_code)).toEqual(["late_cancel"]);
  });

  it("an early (free) cancel can still re-join", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    await asUser(db, p, `select public.cancel_participation($1)`, [g], { now: at(-5 * HOUR) });
    const [r] = await asUser<{ status: string }>(db, p, `select * from public.request_join($1)`, [g], { now: at(-4 * HOUR) });
    expect(r!.status).toBe("requested");
  });
});

describe("H2 host self-attest, QR relay, QR anchors", () => {
  const STEP = 20;
  const token = (secret: string, g: string, step: number) =>
    `${step}.${createHmac("sha256", secret).update(`${g}|${step}`).digest("hex").slice(0, 32)}`;

  it("the host cannot QR-verify themself; future steps are invalid; the window is current + previous step", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    const { s: secret } = first(await db.query<{ s: string }>(`select qr_secret s from games where id = $1`, [g]));
    const now = at(5 * MIN);
    const step = Math.floor(now.getTime() / 1000 / STEP);
    const scan = (u: string, tok: string) =>
      asUser<{ v: { outcome: string; reason?: string; fallbacks?: string[] } }>(db, u,
        `select public.submit_checkin($1, 'qr', $2) as v`, [g, tok], { now }).then((r) => first(r).v);
    expect(await scan(host, token(secret, g, step))).toMatchObject({ outcome: "rejected", reason: "not_host", fallbacks: ["gps", "peer"] });
    expect(await scan(p, token(secret, g, step + 1))).toMatchObject({ reason: "invalid_qr" });
    expect(await scan(p, token(secret, g, step - 2))).toMatchObject({ reason: "expired_qr" }); // relayed > 40 s ago
    expect(await scan(p, token(secret, g, step - 1))).toMatchObject({ outcome: "verified" });
  });

  it("QR-verified attendees cannot anchor a peer check-in", async () => {
    const host = await makeUser(db);
    const [t, q1, q2] = [await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, t);
    for (const u of [q1, q2]) await addParticipant(db, g, u, "approved", { attendance: "verified", method: "qr" });
    await expectSt(asUser(db, q1, `select public.peer_confirm($1, $2)`, [g, t], { now: at(5 * MIN) }), "forbidden");
    // Even if such confirmations existed, the mirror does not count them.
    await db.query(`insert into peer_confirmations (game_id, confirmer_id, target_id) values ($1, $2, $4), ($1, $3, $4)`, [g, q1, q2, t]);
    const { r } = first(await db.query<{ r: { confirmations: number; verdict: { reason: string } } }>(
      `select public.dm_verify_peer(jsonb_build_object('targetUserId', $1::text,
         'participants', (select jsonb_agg(jsonb_build_object('userId', user_id, 'status', status, 'attendance', attendance,
                                                              'checkInMethod', check_in_method)) from game_participants where game_id = $2),
         'confirmations', (select jsonb_agg(jsonb_build_object('confirmerId', confirmer_id, 'targetId', target_id))
                           from peer_confirmations where game_id = $2), 'blocks', '[]'::jsonb),
         now(), public.st_config()) r`, [t, g]));
    expect(r).toMatchObject({ confirmations: 0, verdict: { reason: "insufficient_peers" } });
  });
});

describe("H3 sock-puppet restriction", () => {
  async function scenario(opts: { games: number; method: string; hostReports?: boolean }) {
    const host = await makeUser(db, { createdAt: at(-300 * DAY) });
    const subject = await makeUser(db);
    const games: string[] = [];
    for (let i = 0; i < opts.games; i++) {
      const g = await makeGame(db, host, { startsAt: at(-3 * DAY - i * DAY), endsAt: at(-3 * DAY - i * DAY + HOUR) });
      await addParticipant(db, g, subject, "approved", { attendance: "verified", method: "gps" });
      games.push(g);
    }
    const reporters: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await makeUser(db, { createdAt: at(-(100 + 30 * i) * DAY) });
      await addParticipant(db, games[i % games.length]!, r, "approved", { attendance: "verified", method: opts.method });
      reporters.push(r);
    }
    for (const [i, r] of reporters.entries()) {
      await asUser(db, r, `select public.report_user($1, 'harassment', $2)`, [subject, games[i % games.length]], { now: at(0) });
    }
    return { subject };
  }
  const reasons = async () =>
    (await db.query<{ evidence: { reviewReasons: string } }>(`select evidence from review_queue`)).map((r) => r.evidence.reviewReasons);

  it("three GPS-verified reporters of one single game → review only (single_game), no restriction", async () => {
    const { subject } = await scenario({ games: 1, method: "gps" });
    expect(await sanctionsOf(db, subject)).toHaveLength(0);
    expect(await reasons()).toEqual(["single_game"]);
  });

  it("reporters without any GPS anchor (QR only) → review only (no_gps_anchor)", async () => {
    const { subject } = await scenario({ games: 2, method: "qr" });
    expect(await sanctionsOf(db, subject)).toHaveLength(0);
    expect(await reasons()).toEqual(["no_gps_anchor"]);
  });

  it("control: GPS-verified reporters across two games still restrict", async () => {
    const { subject } = await scenario({ games: 2, method: "gps" });
    expect((await sanctionsOf(db, subject)).map((s) => s.kind)).toEqual(["visibility_restriction"]);
  });
});

describe("H4 women-only bypass", () => {
  it("gender can change only once per 90 days (clock starts at onboarding)", async () => {
    const u = await db.createUser({ phone: "+972501234567" });
    await asUser(db, u, `select public.create_profile('M', 'en', 1990, 1, 'male')`, [], { now: at(0) });
    await expectSt(asUser(db, u, `update profile_private set gender = 'female' where user_id = $1`, [u], { now: at(DAY) }), "validation");
    await asUser(db, u, `update profile_private set gender = 'female' where user_id = $1`, [u], { now: at(91 * DAY) });
    await expectSt(asUser(db, u, `update profile_private set gender = 'male' where user_id = $1`, [u], { now: at(100 * DAY) }), "validation");
  });

  it("women-only games need a female host and hide the exact location by default", async () => {
    const man = await makeUser(db, { gender: "male" });
    const woman = await makeUser(db, { gender: "female" });
    await expectSt(createGame(man, `, p_women_only => true`), "women_only");
    const g = first(await createGame(woman, `, p_women_only => true`));
    expect(g.hide_exact_location).toBe(true);
    const priv = first(await asUser<Record<string, unknown>>(db, man,
      `select * from public.create_game('football', 'x', 'private', null, 32.08, 34.78, null, 10, $1, $2)`,
      [iso(T0), iso(at(90 * MIN))], before));
    expect(priv.hide_exact_location).toBe(true);
    expect(first(await createGame(man, "")).hide_exact_location).toBe(false);
  });
});

describe("H5 ban evasion via delete and re-register", () => {
  it("restrictions in force follow the phone (HMAC) into the new account; deletion itself is allowed", async () => {
    await db.exec(`set st.phone_hmac_key = 'test-pepper'`);
    try {
      const phone = "+972509998877";
      const old = await db.createUser({ phone });
      await asUser(db, old, `select public.create_profile('Old', 'en', 1990, 1)`, [], { now: at(-DAY) });
      await asService(db, `select public.apply_effects($1::jsonb)`, [JSON.stringify([{ type: "IssueSanction", sanction: {
        userId: old, kind: "join_ban", reasonCode: "escalation_three_cards", statementKey: "sanctions.reason.escalation_three_cards",
        statementParams: {}, startsAt: iso(at(-DAY)), expiresAt: iso(at(29 * DAY)), disputeUntil: null, decidedBy: "system",
        gameId: null, causedBy: [], dedupeKey: "ban-old" } }])], { now: at(-DAY) });
      await asUser(db, old, `select public.delete_my_account()`, [], { now: at(0) });
      const rows = await db.query<{ hmac: string; until: Date }>(`select hmac, until from sanction_phone_hmac`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.hmac).toBe(createHmac("sha256", "test-pepper").update(phone).digest("hex"));
      expect(rows[0]!.until).toEqual(at(29 * DAY));
      // Clients cannot read it.
      await expect(asUser(db, old, `select * from sanction_phone_hmac`)).rejects.toThrow(/permission denied/);
      // The Edge Function deletes the auth user; the person registers again with the same phone.
      await db.query(`delete from auth.users where id = $1`, [old]);
      const fresh = await db.createUser({ phone });
      await asUser(db, fresh, `select public.create_profile('New', 'en', 1990, 1)`, [], { now: at(DAY) });
      expect((await profileOf(db, fresh)).join_banned_until).toEqual(at(29 * DAY));
      const notes = await db.query(`select 1 from notifications where user_id = $1 and kind = 'sanction_issued'`, [fresh]);
      expect(notes).toHaveLength(1);
      const host = await makeUser(db);
      const g = await makeGame(db, host, { startsAt: at(5 * DAY), endsAt: at(5 * DAY + HOUR) });
      await expectSt(asUser(db, fresh, `select public.request_join($1)`, [g], { now: at(DAY) }), "join_banned");
      // After expiry the purge removes the HMAC.
      await asService(db, `select public.purge_retention()`, [], { now: at(30 * DAY) });
      expect(await db.query(`select 1 from sanction_phone_hmac`)).toHaveLength(0);
    } finally {
      await db.exec(`reset st.phone_hmac_key`);
    }
  });
});

describe("H6 Realtime authorization (realtime.messages)", () => {
  it("only approved participants receive game:<uuid> broadcasts before chat expiry; nobody but service_role can send", async () => {
    const h = await createHarness();
    try {
      await h.exec(`
        create schema if not exists realtime;
        create table realtime.messages (id bigint generated always as identity primary key, topic text not null,
          extension text not null, event text, payload jsonb, private boolean default true, inserted_at timestamptz default now());
        create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
        grant usage on schema realtime to authenticated, anon, service_role;
        grant select, insert on realtime.messages to authenticated, anon;
        grant all on realtime.messages to service_role;
        grant execute on function realtime.topic() to authenticated, anon;
      `);
      const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0091_realtime.sql"), "utf8");
      await h.exec(sql.slice(sql.indexOf("do $$")));
      const host = await makeUser(h);
      const [p, stranger] = [await makeUser(h), await makeUser(h)];
      const g = await makeGame(h, host);
      await addParticipant(h, g, p);
      await h.query(`insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'message')`, [`game:${g}`]);
      const read = (u: string, now: Date, topic = `game:${g}`) =>
        h.asUser(u, async (tx) => {
          await tx.query(`select set_config('realtime.topic', $1, true)`, [topic]);
          return (await tx.query(`select * from realtime.messages`)).rows.length;
        }, { now });
      expect(await read(p, at(HOUR))).toBe(1);
      expect(await read(stranger, at(HOUR))).toBe(0);
      expect(await read(p, at(90 * MIN + 3 * HOUR))).toBe(0); // chat expired
      expect(await read(p, at(HOUR), `game:${g}' or true --`)).toBe(0);
      await expect(h.asUser(p, (tx) => tx.query(`insert into realtime.messages (topic, extension) values ($1, 'broadcast')`, [`game:${g}`])))
        .rejects.toThrow(/row-level security/);
      await h.asService((tx) => tx.query(`insert into realtime.messages (topic, extension) values ($1, 'broadcast')`, [`game:${g}`]));
    } finally {
      await h.close();
    }
  });
});

describe("M1 results", () => {
  it("only the host can submit the result", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, p, "approved", { attendance: "verified", method: "gps" });
    await expectSt(asUser(db, p, `select public.submit_result($1, '{9,0}')`, [g], { now: at(2 * HOUR) }), "forbidden");
    await asUser(db, host, `select public.submit_result($1, '{1,1}')`, [g], { now: at(2 * HOUR) });
  });
});

describe("M2 venue reports by unqualified reporters", () => {
  it("fresh accounts (and red reporters) cannot hide a venue", async () => {
    const v = await makeVenue(db);
    for (let i = 0; i < 2; i++) {
      const u = await makeUser(db, { createdAt: at(-DAY) });
      await asUser(db, u, `select public.report_venue($1, 'no_venue_here')`, [v], { now: at(0) });
    }
    const red = await makeUser(db);
    await db.query(`update profiles set reliability_status = 'red' where id = $1`, [red]);
    await asUser(db, red, `select public.report_venue($1, 'no_venue_here')`, [v], { now: at(0) });
    expect(first(await db.query<{ status: string }>(`select status from venues where id = $1`, [v])).status).toBe("active");
  });
});

describe("M4 deposits", () => {
  it("only tier amounts are accepted and forfeits always go to the pot", async () => {
    const host = await makeUser(db);
    await expectSt(createGame(host, `, p_deposit_minor => 700, p_currency => 'EUR'`), "validation");
    await expectSt(createGame(host, `, p_deposit_minor => 500, p_currency => 'XXX'`), "validation");
    const g = first(await createGame(host, `, p_deposit_minor => 500, p_currency => 'EUR', p_deposit_forfeit_to => 'host'`));
    expect(g.deposit_forfeit_to).toBe("pot");
  });
});

describe("M6 host late game cancellation", () => {
  it("a late cancel carries a disputable card for the host; two in 30 days suspend hosting", async () => {
    const host = await makeUser(db);
    const g1 = await makeGame(db, host);
    const g2 = await makeGame(db, host, { startsAt: at(5 * DAY), endsAt: at(5 * DAY + HOUR) });
    await asUser(db, host, `select public.cancel_game($1)`, [g1], { now: at(-90 * MIN) });
    let s = await sanctionsOf(db, host);
    expect(s.map((x) => [x.kind, x.reason_code, x.dedupe_key])).toEqual([["yellow_card", "late_cancel", `host_late_cancel:${g1}:${host}`]]);
    expect(s[0]!.dispute_until).not.toBeNull();
    await asUser(db, host, `select public.cancel_game($1)`, [g2], { now: at(5 * DAY - HOUR) });
    s = await sanctionsOf(db, host);
    expect(s.filter((x) => x.kind === "host_suspension").map((x) => x.reason_code)).toEqual(["late_cancel"]);
    await expectSt(createGame(host, "", { now: at(6 * DAY) }), "host_suspended");
  });
});

describe("L1 / L2 / L5", () => {
  it("L1: st_is_hidden_user is not executable by clients; the wrapper is caller-relative", async () => {
    const [{ ok }] = (await db.query<{ ok: boolean }>(
      `select has_function_privilege('authenticated', 'public.st_is_hidden_user(uuid)', 'execute') ok`)) as [{ ok: boolean }];
    expect(ok).toBe(false);
    const u = await makeUser(db);
    await db.query(`update profiles set visibility_restricted_until = $2 where id = $1`, [u, iso(at(DAY))]);
    const { me } = first(await asUser<{ me: boolean }>(db, u, `select public.st_hidden_from_me($1) me`, [u], { now: at(0) }));
    expect(me).toBe(false);
  });

  it("L2: st.now is ignored unless st.test_mode = on", async () => {
    const u = await makeUser(db);
    const year = await db.asUser(u, async (tx) => {
      await tx.query(`select set_config('st.test_mode', 'off', true)`);
      return first((await tx.query<{ y: number }>(`select extract(year from public.st_now())::int y`)).rows).y;
    }, { now: "2001-01-01T00:00:00.000Z" });
    expect(year).toBeGreaterThan(2001);
  });

  it("L5: no removals after the start; no QR rotation after the end", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    await expectSt(asUser(db, host, `select public.remove_participant($1, $2)`, [g, p], { now: at(MIN) }), "game_not_open");
    await asUser(db, host, `select public.rotate_qr($1)`, [g], { now: at(80 * MIN) });
    await expectSt(asUser(db, host, `select public.rotate_qr($1)`, [g], { now: at(91 * MIN) }), "game_not_open");
    const mod = await makeModerator(db);
    expect(mod).toBeTruthy();
  });
});
