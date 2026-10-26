import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { addParticipant, asService, asUser, at, expectSt, HOUR, makeGame, makeUser, MIN, T0, first } from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

/** Independent implementation of the wire format: `${step}.${hex(HMAC-SHA256(utf8(secret), `${gameId}|${step}`))[0..32]}`. */
function qrToken(secret: string, gameId: string, step: number): string {
  return `${step}.${createHmac("sha256", secret).update(`${gameId}|${step}`).digest("hex").slice(0, 32)}`;
}
const STEP_S = 20; // DEFAULT_TRUST_CONFIG.qrStepSeconds (security H2)
const stepOf = (d: Date) => Math.floor(d.getTime() / 1000 / STEP_S);

async function secretOf(gameId: string): Promise<string> {
  const [r] = await db.query<{ s: string }>(`select qr_secret as s from games where id = $1`, [gameId]);
  return r!.s;
}

type Verdict = { outcome: string; method: string; reason?: string; fallbacks?: string[]; distanceM?: number | null };

describe("QR check-in", () => {
  it("get_qr_token is host-only and matches the TS HMAC; qr_secret is never readable by clients", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    const now = at(5 * MIN + 7000);
    const { t } = first(await asUser<{ t: { token: string; step: number; expiresAt: string } }>(db, host,
      `select public.get_qr_token($1) as t`, [g], { now }));
    expect(t.step).toBe(stepOf(now));
    expect(t.token).toBe(qrToken(await secretOf(g), g, stepOf(now)));
    // Accepted until the end of the next step (past-only drift of 1): ≤ 40 s of validity.
    expect(new Date(t.expiresAt).getTime()).toBe((stepOf(now) + 2) * STEP_S * 1000);
    await expectSt(asUser(db, p, `select public.get_qr_token($1)`, [g], { now }), "forbidden");
    for (const u of [host, p]) {
      await expect(asUser(db, u, `select qr_secret from games where id = $1`, [g])).rejects.toThrow(/permission denied/);
      await expect(asUser(db, u, `select * from games where id = $1`, [g])).rejects.toThrow(/permission denied/);
    }
  });

  it("accepts the current and previous step only; future steps are invalid, older ones expired", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    const other = await makeGame(db, host);
    await addParticipant(db, g, p);
    const secret = await secretOf(g);
    const now = at(10 * MIN);
    const s = stepOf(now);
    const scan = (token: string, n = now) =>
      asUser<{ v: Verdict }>(db, p, `select public.submit_checkin($1, 'qr', $2) as v`, [g, token], { now: n }).then((r) => r[0]!.v);

    expect(await scan(qrToken(secret, g, s + 1))).toMatchObject({ outcome: "rejected", reason: "invalid_qr", fallbacks: ["qr", "peer", "host"] });
    expect(await scan(qrToken(secret, g, s + 2))).toMatchObject({ outcome: "rejected", reason: "invalid_qr" });
    expect(await scan(qrToken(secret, g, s - 2))).toMatchObject({ outcome: "rejected", reason: "expired_qr" });
    expect(await scan(qrToken(secret, other, s))).toMatchObject({ outcome: "rejected", reason: "invalid_qr" });
    expect(await scan("not-a-token")).toMatchObject({ outcome: "rejected", reason: "invalid_qr" });
    expect(await scan(qrToken("not-the-secret", g, s))).toMatchObject({ outcome: "rejected", reason: "invalid_qr" });
    expect(await scan(qrToken(secret, g, s - 1))).toEqual({ outcome: "verified", method: "qr", distanceM: null, signals: [] });
    expect(await scan(qrToken(secret, g, s))).toMatchObject({ outcome: "rejected", reason: "already_checked_in" });
    const [pt] = await db.query<{ attendance: string; check_in_method: string }>(
      `select attendance, check_in_method from game_participants where game_id = $1 and user_id = $2`, [g, p]);
    expect(pt).toEqual({ attendance: "verified", check_in_method: "qr" });
    const log = await db.query<{ outcome: string; reason: string | null }>(`select outcome, reason from checkins where user_id = $1 order by created_at`, [p]);
    expect(log.filter((l) => l.outcome === "verified")).toHaveLength(1);
  });

  it("the current step is accepted; a screenshot from 3 minutes ago is expired (AC-TRUST-007)", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    const secret = await secretOf(g);
    const now = at(0);
    const old = qrToken(secret, g, stepOf(new Date(now.getTime() - 3 * MIN)));
    const { v: v1 } = first(await asUser<{ v: Verdict }>(db, p, `select public.submit_checkin($1, 'qr', $2) as v`, [g, old], { now }));
    expect(v1.reason).toBe("expired_qr");
    const { v: v2 } = first(await asUser<{ v: Verdict }>(db, p, `select public.submit_checkin($1, 'qr', $2) as v`,
      [g, qrToken(secret, g, stepOf(now))], { now }));
    expect(v2.outcome).toBe("verified");
  });

  it("enforces the check-in window (startsAt − 30 min … endsAt) and participant status", async () => {
    const host = await makeUser(db);
    const [p, stranger] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    const secret = await secretOf(g);
    const scan = (u: string, n: Date) =>
      asUser<{ v: Verdict }>(db, u, `select public.submit_checkin($1, 'qr', $2) as v`, [g, qrToken(secret, g, stepOf(n))], { now: n })
        .then((r) => r[0]!.v);
    expect((await scan(p, at(-31 * MIN))).reason).toBe("outside_window");
    expect((await scan(p, at(91 * MIN))).reason).toBe("outside_window");
    expect((await scan(stranger, at(0))).reason).toBe("not_participant");
    expect((await scan(p, at(-30 * MIN))).outcome).toBe("verified");
  });

  it("rotate_qr invalidates old tokens; host-only", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    const now = at(0);
    const oldToken = qrToken(await secretOf(g), g, stepOf(now));
    await expectSt(asUser(db, p, `select public.rotate_qr($1)`, [g], { now }), "forbidden");
    const { t } = first(await asUser<{ t: { token: string } }>(db, host, `select public.rotate_qr($1) as t`, [g], { now }));
    expect(t.token).not.toBe(oldToken);
    const { v } = first(await asUser<{ v: Verdict }>(db, p, `select public.submit_checkin($1, 'qr', $2) as v`, [g, oldToken], { now }));
    expect(v.reason).toBe("invalid_qr");
  });

  it("purged QR secrets (game end + 24h) make get_qr_token fail", async () => {
    const host = await makeUser(db);
    const g = await makeGame(db, host);
    await asService(db, `select public.purge_retention()`, [], { now: at(26 * HOUR) });
    await expectSt(asUser(db, host, `select public.get_qr_token($1)`, [g], { now: at(26 * HOUR) }), "game_not_open");
  });
});

describe("host and peer check-in", () => {
  it("host marks present; non-hosts get not_host with fallbacks", async () => {
    const host = await makeUser(db);
    const [p, q] = [await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    await addParticipant(db, g, q);
    const now = { now: at(5 * MIN) };
    const { v: bad } = first(await asUser<{ v: Verdict }>(db, q, `select public.submit_checkin($1, 'host', null, $2) as v`, [g, p], now));
    expect(bad).toMatchObject({ outcome: "rejected", reason: "not_host", fallbacks: [] });
    // The host cannot attest their own presence.
    const { v: self } = first(await asUser<{ v: Verdict }>(db, host, `select public.submit_checkin($1, 'host', null, $2) as v`, [g, host], now));
    expect(self.reason).toBe("not_host");
    const { v } = first(await asUser<{ v: Verdict }>(db, host, `select public.submit_checkin($1, 'host', null, $2) as v`, [g, p], now));
    expect(v).toMatchObject({ outcome: "verified", method: "host" });
    await expectSt(asUser(db, p, `select public.submit_checkin($1, 'gps')`, [g], now), "validation");
    // The host may still mark players until endsAt + 2h, not later.
    const r = await makeUser(db);
    await addParticipant(db, g, r);
    const { v: late } = first(await asUser<{ v: Verdict }>(db, host, `select public.submit_checkin($1, 'host', null, $2) as v`, [g, r],
      { now: at(90 * MIN + 2 * HOUR) }));
    expect(late.outcome).toBe("verified");
    const q2 = await makeUser(db);
    await addParticipant(db, g, q2);
    const { v: tooLate } = first(await asUser<{ v: Verdict }>(db, host, `select public.submit_checkin($1, 'host', null, $2) as v`, [g, q2],
      { now: at(90 * MIN + 2 * HOUR + 1000) }));
    expect(tooLate.reason).toBe("outside_window");
  });

  it("peer: ≥2 verified confirmers, blocked pairs excluded, confirmer must be verified", async () => {
    const host = await makeUser(db);
    const [t, a, b, c, unverified] = [await makeUser(db), await makeUser(db), await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, t);
    for (const u of [a, b, c]) await addParticipant(db, g, u, "approved", { attendance: "verified", method: "gps" });
    await addParticipant(db, g, unverified);
    const qrOnly = await makeUser(db);
    await addParticipant(db, g, qrOnly, "approved", { attendance: "verified", method: "qr" });
    await db.query(`insert into blocks values ($1, $2)`, [t, b]);
    const now = { now: at(10 * MIN) };
    const confirm = (u: string) =>
      asUser<{ r: { confirmations: number; verdict: Verdict } }>(db, u, `select public.peer_confirm($1, $2) as r`, [g, t], now).then((x) => x[0]!.r);
    await expectSt(confirm(unverified), "forbidden");
    await expectSt(confirm(qrOnly), "forbidden"); // security H2: QR-verified attendees are not anchors
    await expectSt(asUser(db, a, `select public.peer_confirm($1, $2)`, [g, a], now), "validation");
    expect(await confirm(a)).toMatchObject({ confirmations: 1, verdict: { outcome: "rejected", reason: "insufficient_peers" } });
    expect(await confirm(b)).toMatchObject({ verdict: { outcome: "rejected", reason: "blocked_pair" } });
    expect(await confirm(c)).toMatchObject({ confirmations: 2, verdict: { outcome: "verified", method: "peer" } });
    const { r: late } = first(await asUser<{ r: { verdict: Verdict } }>(db, a, `select public.peer_confirm($1, $2) as r`, [g, unverified],
      { now: at(2 * HOUR) }));
    expect(late.verdict.reason).toBe("outside_window");
  });

  it("peer: peer-verified confirmers the target confirmed back do not count → reciprocal_only", async () => {
    const host = await makeUser(db);
    const [t, a, b, c] = [await makeUser(db), await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, t);
    for (const u of [a, b]) await addParticipant(db, g, u, "approved", { attendance: "verified", method: "peer" });
    await addParticipant(db, g, c, "approved", { attendance: "verified", method: "gps" });
    // Earlier mutual confirmations between t and the peer-verified a, b.
    await db.query(`insert into peer_confirmations (game_id, confirmer_id, target_id) values ($1, $2, $3), ($1, $2, $4), ($1, $3, $2)`,
      [g, t, a, b]);
    const now = { now: at(10 * MIN) };
    const { r } = first(await asUser<{ r: { confirmations: number; verdict: Verdict } }>(db, c,
      `select public.peer_confirm($1, $2) as r`, [g, t], now));
    expect(r.confirmations).toBe(1);
    expect(r.verdict.reason).toBe("reciprocal_only");
  });

  it("record_checkin_verdict is service-role only and still enforces participant rules", async () => {
    const host = await makeUser(db);
    const p = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, p);
    const verdict = JSON.stringify({ outcome: "verified", method: "gps", distanceM: 12.5, signals: [] });
    await expect(asUser(db, p, `select public.record_checkin_verdict($1, $2, $3::jsonb)`, [g, p, verdict])).rejects.toThrow(/permission denied/);
    const { v } = first(await asService<{ v: Verdict }>(db, `select public.record_checkin_verdict($1, $2, $3::jsonb) as v`, [g, p, verdict], { now: at(0) }));
    expect(v.outcome).toBe("verified");
    const [c] = await db.query<{ distance_m: string; method: string }>(`select distance_m, method from checkins where user_id = $1`, [p]);
    expect(c).toEqual({ distance_m: "12.50", method: "gps" });
    const rej = JSON.stringify({ outcome: "rejected", method: "gps", reason: "too_far", fallbacks: ["qr"], signals: ["mock_location"] });
    const { v: v2 } = first(await asService<{ v: Verdict }>(db, `select public.record_checkin_verdict($1, $2, $3::jsonb) as v`, [g, p, rej], { now: at(0) }));
    expect(v2.reason).toBe("already_checked_in");
    // Spoofing signals never sanction.
    expect(await db.query(`select 1 from sanctions`)).toHaveLength(0);
    // Location-derived data is purged after 30 days (outcome kept).
    await asService(db, `select public.purge_retention()`, [], { now: new Date(T0.getTime() + 31 * 24 * HOUR) });
    const [after] = await db.query<{ distance_m: string | null; outcome: string }>(`select distance_m, outcome from checkins where user_id = $1 and outcome = 'verified'`, [p]);
    expect(after).toEqual({ distance_m: null, outcome: "verified" });
  });
});
