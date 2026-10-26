/**
 * Golden parity (TS ≡ SQL): runs packages/domain/test/golden/*.json against the SQL side.
 *
 * - Pure kinds call the SQL domain mirrors (`dm_*`, migration 0006) that the RPCs themselves use,
 *   and compare the output deep-equal (effects in order).
 * - `trust.applyEvent` seeds the TrustState into tables, runs the real SQL counterpart (job / RPC /
 *   appeal & finalisation handlers) and checks that the database reflects exactly the expected
 *   effects (rows created with derived ids, statuses, projections, notifications, settlements).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

interface GoldenCase {
  name: string;
  kind: string;
  input: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  config?: Record<string, unknown>;
  now: string;
  expected: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  targets?: ("ts" | "sql")[];
}

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "domain", "test", "golden");
const cases: GoldenCase[] = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()
      .flatMap((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as GoldenCase[])
      .filter((c) => (c.targets ?? ["ts", "sql"]).includes("sql"))
  : [];

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

const CFG = `public.st_config_merge($2::jsonb)`;
const NOW = `$3::timestamptz`;

/** SQL expression per pure kind; `$1` = input, `$2` = config overrides, `$3` = now. Returns jsonb. */
const PURE: Record<string, { sql: string; pick?: string[] }> = {
  "checkin.qrToken": { sql: `public.dm_qr_token($1->>'qrSecret', ($1->>'gameId')::uuid, ${NOW}, ${CFG})` },
  "checkin.verifyQr": {
    sql: `public.dm_verify_qr($1->>'token', $1->>'qrSecret', ($1->>'gameId')::uuid, ${NOW}, ${CFG}, $1->'window', $1->'scanner')`,
  },
  "checkin.verifyPeer": { sql: `public.dm_verify_peer($1, ${NOW}, ${CFG})` },
  "games.windows": {
    sql: `public.dm_game_windows(($1#>>'{game,startsAt}')::timestamptz, ($1#>>'{game,endsAt}')::timestamptz, ${NOW}, ${CFG})`,
  },
  "games.waitlist": { sql: `public.dm_waitlist($1, ${NOW}, ${CFG})` },
  "trust.reliability": { sql: `public.dm_reliability($1->'participations', $1->'sanctions', ${NOW}, ${CFG})` },
  "trust.venueReports": {
    sql: `public.dm_venue_reports($1->'venue', coalesce($1->'reporterProfiles', '[]'), ${NOW}, ${CFG})`,
    pick: ["hide", "effects"],
  },
  "trust.hostReliability": { sql: `public.dm_host_reliability($1, ${NOW}, ${CFG})`, pick: ["outcome", "reasonCode", "effects"] },
  "trust.evaluateReports": {
    sql: `public.dm_evaluate_reports($1->'reports', $1->'reporterProfiles', ${NOW}, ${CFG}, coalesce($1->'context', '{}'))`,
    pick: ["outcome", "qualifyingReporterIds", "effects"],
  },
  "trust.processNoShows": {
    sql: `public.dm_process_no_shows($1, ${NOW}, ${CFG})`,
    pick: ["finalized", "gameHappened", "effects", "events"],
  },
};

function pick(o: Record<string, unknown>, keys?: string[]): unknown {
  if (!keys) return o;
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

describe("golden files are present", () => {
  it("found golden cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
  });
});

for (const [kind, spec] of Object.entries(PURE)) {
  const list = cases.filter((c) => c.kind === kind);
  describe(`golden: ${kind}`, () => {
    it.each(list.map((c) => [c.name, c] as const))("%s", async (_n, c) => {
      const [row] = await db.query<{ r: Record<string, unknown> }>(`select ${spec.sql.replaceAll("$1", "($1::jsonb)")} as r`, [
        JSON.stringify(c.input),
        JSON.stringify(c.config ?? {}),
        c.now,
      ]);
      expect(pick(row!.r, spec.pick)).toEqual(c.expected);
    });
  });
}

// ---------------------------------------------------------------------------
// trust.applyEvent — DB-backed semantic parity
// ---------------------------------------------------------------------------
const HOST = "00000000-0000-4000-8000-00000000f00d";
const UNSUPPORTED: Record<string, string> = {
  ChatMessageBlocked:
    "chat moderation (3 blocks/7d → card + mute) runs only in the send-message Edge Function via @st/domain; SQL applies its effects through apply_effects (covered by trust.test.ts)",
};

async function ensureUser(id: string, createdAt = "2025-01-01T00:00:00.000Z") {
  const [exists] = await db.query(`select 1 from auth.users where id = $1`, [id]);
  if (exists) return;
  await db.createUser({ id, createdAt });
  await db.query(`insert into profiles (id, display_name, created_at) values ($1, 'golden', $2)`, [id, createdAt]);
  await db.query(`insert into profile_private (user_id, birth_year, birth_month) values ($1, 1990, 1)`, [id]);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function seedState(c: GoldenCase): Promise<void> {
  const st = c.input.state;
  const ev = c.input.event;
  const user: string = st.userId;
  await ensureUser(HOST);
  await ensureUser(user);
  const sanctions: any[] = st.sanctions ?? [];
  const settlements: any[] = st.depositSettlements ?? [];
  const games = new Map<string, { startsAt: string; reason: string | null }>();
  for (const s of sanctions) {
    // The card reason (no_show / late_cancel) determines the seeded participation; escalation bans reuse the game id.
    if (s.gameId && (!games.has(s.gameId) || ["no_show", "late_cancel"].includes(s.reasonCode))) {
      games.set(s.gameId, { startsAt: s.startsAt, reason: s.reasonCode });
    }
  }
  for (const r of st.reviewItems ?? []) if (r.gameId && !games.has(r.gameId)) games.set(r.gameId, { startsAt: c.now, reason: null });
  if (ev.gameId && !games.has(ev.gameId)) games.set(ev.gameId, { startsAt: ev.startsAt ?? c.now, reason: null });
  for (const s of settlements) if (!games.has(s.gameId)) games.set(s.gameId, { startsAt: c.now, reason: null });

  for (const [gid, g] of games) {
    const cancellation = ev.type === "ParticipationCancelled" && ev.gameId === gid;
    const start = cancellation ? new Date(ev.startsAt) : new Date(Date.parse(g.startsAt) - 4 * 3600_000);
    const end = new Date(start.getTime() + 90 * 60_000);
    await db.query(
      `insert into games (id, host_id, sport, title, geog, approx_geog, capacity, starts_at, ends_at, deposit_minor, status, happened)
       values ($1, $2, 'football', 'golden', public.st_point(32, 34), public.st_point(32, 34), 10, $3, $4, 500, $5::public.game_status, $6)`,
      [gid, HOST, start.toISOString(), end.toISOString(), cancellation ? "scheduled" : "completed", cancellation ? null : true],
    );
    const lateCancel = g.reason === "late_cancel";
    const attendance = g.reason === "no_show" ? "no_show_unverified" : "unknown";
    await db.query(
      `insert into game_participants (game_id, user_id, status, attendance, late_cancel, cancelled_at, requested_at)
       values ($1, $2, $3::public.participant_status, $4::public.attendance_status, $5, $6, $7)`,
      [gid, user, lateCancel ? "cancelled" : "approved", attendance, lateCancel, lateCancel ? start.toISOString() : null,
        new Date(start.getTime() - 86400_000).toISOString()],
    );
    const settled = [...settlements].reverse().find((s) => s.gameId === gid);
    await db.query(
      `insert into payments (user_id, game_id, amount_minor, currency, status, deposit_state, step, idempotency_key,
                             settlement_requested, settlement_dispatched_at)
       values ($1::uuid, $2::uuid, 500, 'EUR', $3::public.payment_intent_status, $4::public.deposit_state, $5, 'golden:' || $2::text, $6, $7)`,
      [user, gid, cancellation ? "succeeded" : "requires_capture", cancellation ? "setup" : "held", cancellation ? "setup" : "hold",
        settled?.outcome ?? null, settled ? c.now : null],
    );
  }
  for (const s of sanctions) {
    const [row] = await db.query<{ id: string }>(
      `insert into sanctions (user_id, kind, reason_code, statement_key, statement_params, starts_at, expires_at, dispute_until,
                              status, decided_by, game_id, caused_by, dedupe_key, created_at)
       values ($1, $2::public.sanction_kind, $3::public.sanction_reason_code, $4, $5::jsonb, $6, $7, $8, $9::public.sanction_status,
               $10::public.sanction_decider, $11, $12::uuid[], $13, $14) returning id`,
      [s.userId, s.kind, s.reasonCode, s.statementKey, JSON.stringify(s.statementParams), s.startsAt, s.expiresAt, s.disputeUntil,
        s.status, s.decidedBy, s.gameId, s.causedBy, s.dedupeKey, s.createdAt],
    );
    expect(row!.id, `derived id of ${s.dedupeKey}`).toBe(s.id);
  }
  // Appeals / review items may reference rows outside the state snapshot: insert them with FK and
  // trigger checks suspended, keeping the fixture ids (asserted equal to the derived ids below).
  await db.exec(`set session_replication_role = replica`);
  for (const a of st.appeals ?? []) {
    await db.query(
      `insert into appeals (id, sanction_id, user_id, text, is_dispute, status, created_at)
       values ($1, $2, $3, $4, $5, $6::public.appeal_status, $7)`,
      [a.id, a.sanctionId, a.userId, a.text, a.isDispute, a.status, a.createdAt],
    );
  }
  for (const r of st.reviewItems ?? []) {
    const [row] = await db.query<{ id: string }>(
      `insert into review_queue (id, kind, status, priority, subject_user_id, venue_id, game_id, sanction_id, appeal_id, report_ids,
                                 evidence, due_by, dedupe_key, created_at)
       values ($14, $1::public.review_kind, $2::public.review_status, $3::public.review_priority, $4, $5, $6, $7, $8, $9::uuid[], $10::jsonb,
               $11, $12, $13) returning id`,
      [r.kind, r.status, r.priority, r.subjectUserId, r.venueId, r.gameId, r.sanctionId, r.appealId, r.reportIds,
        JSON.stringify(r.evidence), r.dueBy, r.dedupeKey, r.createdAt, r.id],
    );
    const [d] = await db.query<{ id: string }>(`select public.dm_review_id($1)::text id`, [r.dedupeKey]);
    expect(d!.id, `derived id of ${r.dedupeKey}`).toBe(row!.id);
  }
  await db.exec(`set session_replication_role = origin`);
}

async function runEvent(c: GoldenCase): Promise<void> {
  const ev = c.input.event;
  const now = { now: c.now };
  switch (ev.type) {
    case "Tick":
      await db.asService((tx) => tx.query(`select public.expire_sanctions()`), now);
      return;
    case "AppealFiled": {
      const a = ev.appeal;
      await db.query(
        `insert into appeals (id, sanction_id, user_id, text, is_dispute, status, created_at)
         values ($1, $2, $3, $4, $5, $6::public.appeal_status, $7)`,
        [a.id, a.sanctionId, a.userId, a.text, a.isDispute, a.status, a.createdAt],
      );
      await db.asService((tx) => tx.query(`select public.st_on_appeal_filed($1)`, [a.id]), now);
      return;
    }
    case "ModeratorDecided":
      await ensureUser(ev.moderatorId);
      await db.query(`insert into app_roles (user_id, role) values ($1, 'moderator') on conflict do nothing`, [ev.moderatorId]);
      await db.asUser(ev.moderatorId, (tx) => tx.query(`select public.moderator_decide($1, $2::public.moderator_decision, $3)`,
        [ev.itemId, ev.decision, ev.note]), { now: ev.at });
      return;
    case "ParticipationCancelled":
      await db.asUser(ev.userId, (tx) => tx.query(`select public.cancel_participation($1)`, [ev.gameId]), { now: ev.cancelledAt });
      return;
    case "LateCancelFinalized":
    case "AttendanceFinalized":
      await db.asService((tx) => tx.query(`select public.st_apply_finalization_event($1::jsonb)`, [JSON.stringify(ev)]), now);
      return;
    default:
      throw new Error(`unsupported event ${ev.type}`);
  }
}

type Snapshot = { sanctions: Set<string>; reviews: Set<string>; notifications: Set<string>; dues: Set<string> };
async function snapshot(now: string): Promise<Snapshot> {
  const ids = async (t: string) => new Set((await db.query<{ id: string }>(`select id::text id from ${t}`)).map((r) => r.id));
  const dues = await db.asService((tx) => tx.query<{ k: string }>(
    `select game_id::text || ':' || outcome as k from public.due_deposit_settlements()`), { now });
  return { sanctions: await ids("sanctions"), reviews: await ids("review_queue"), notifications: await ids("notifications"),
    dues: new Set(dues.rows.map((r) => r.k)) };
}
const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function checkEffects(c: GoldenCase, before: Snapshot): Promise<void> {
  const effects: any[] = c.expected.effects;
  const derived = async (fn: string, key: string) =>
    (await db.query<{ id: string }>(`select public.${fn}($1)::text id`, [key]))[0]!.id;

  const lastStatus = new Map<string, string>();
  for (const e of effects) if (e.type === "SetSanctionStatus") lastStatus.set(e.sanctionId, e.status);

  for (const e of effects) {
    switch (e.type) {
      case "IssueSanction": {
        const s = e.sanction;
        const id = await derived("dm_sanction_id", s.dedupeKey);
        const [row] = await db.query<any>(`select * from sanctions where id = $1`, [id]);
        expect(row, `sanction ${s.dedupeKey}`).toBeTruthy();
        expect({
          kind: row.kind, userId: row.user_id, reasonCode: row.reason_code, statementKey: row.statement_key,
          statementParams: row.statement_params, startsAt: iso(row.starts_at), expiresAt: iso(row.expires_at),
          disputeUntil: iso(row.dispute_until), gameId: row.game_id, causedBy: row.caused_by, dedupeKey: row.dedupe_key,
          decidedBy: row.decided_by,
        }).toEqual(s);
        break;
      }
      case "SetSanctionStatus": {
        const [row] = await db.query<{ status: string }>(`select status from sanctions where id = $1`, [e.sanctionId]);
        expect(row?.status, `status of ${e.sanctionId}`).toBe(lastStatus.get(e.sanctionId));
        break;
      }
      case "EnqueueReview": {
        const it = e.item;
        const id = await derived("dm_review_id", it.dedupeKey);
        const [row] = await db.query<any>(`select * from review_queue where id = $1`, [id]);
        expect(row, `review ${it.dedupeKey}`).toBeTruthy();
        expect({
          kind: row.kind, priority: row.priority, subjectUserId: row.subject_user_id, venueId: row.venue_id, gameId: row.game_id,
          sanctionId: row.sanction_id, appealId: row.appeal_id, reportIds: row.report_ids, evidence: row.evidence,
          dueBy: iso(row.due_by), dedupeKey: row.dedupe_key,
        }).toEqual(it);
        break;
      }
      case "Notify": {
        const sid = e.sanctionDedupeKey ? await derived("dm_sanction_id", e.sanctionDedupeKey) : null;
        const rows = await db.query<any>(
          `select * from notifications where user_id = $1 and kind = $2::public.notification_kind and params = $3::jsonb
             and game_id is not distinct from $4 and sanction_id is not distinct from $5`,
          [e.userId, e.kind, JSON.stringify(e.params), e.gameId, sid]);
        expect(rows.length, `notification ${e.kind} ${JSON.stringify(e.params)}`).toBe(1);
        break;
      }
      case "BanJoins":
      case "MuteChat":
      case "RestrictVisibility":
      case "SuspendHost": {
        const col = { BanJoins: "join_banned_until", MuteChat: "chat_muted_until", RestrictVisibility: "visibility_restricted_until",
          SuspendHost: "host_suspended_until" }[e.type as string]!;
        const [row] = await db.query<any>(`select ${col} v from profiles where id = $1`, [e.userId]);
        expect(iso(row.v), `${e.type}`).toBe(e.until);
        break;
      }
      case "BanAccount": {
        const [row] = await db.query<{ v: boolean }>(`select permanently_banned v from profiles where id = $1`, [e.userId]);
        expect(row?.v, "BanAccount").toBe(true);
        break;
      }
      case "SetAttendance": {
        const [row] = await db.query<{ attendance: string }>(
          `select attendance from game_participants where game_id = $1 and user_id = $2`, [e.gameId, e.userId]);
        expect(row?.attendance).toBe(e.attendance);
        break;
      }
      case "SettleDeposit": {
        const due = await db.asService((tx) => tx.query<{ outcome: string }>(
          `select outcome from public.due_deposit_settlements() where game_id = $1 and user_id = $2`, [e.gameId, e.userId]),
          { now: c.now });
        expect(due.rows.map((r) => r.outcome), `deposit ${e.gameId}`).toEqual([e.outcome]);
        break;
      }
      case "Audit": {
        const rows = await db.query(`select 1 from audit_log where action = $1 and subject_user_id is not distinct from $2`,
          [e.action, e.subjectUserId]);
        expect(rows.length, `audit ${e.action}`).toBeGreaterThanOrEqual(1);
        break;
      }
      case "LiftRestrictions":
        break; // transient: the projections asserted above/below are what matters
      default:
        throw new Error(`unchecked effect ${e.type}`);
    }
  }

  // Nothing beyond the expected effects.
  const after = await snapshot(c.now);
  const fresh = (a: Set<string>, b: Set<string>) => [...b].filter((x) => !a.has(x));
  expect(fresh(before.sanctions, after.sanctions).length, "new sanctions").toBe(effects.filter((e) => e.type === "IssueSanction").length);
  expect(fresh(before.reviews, after.reviews).length, "new review items").toBe(effects.filter((e) => e.type === "EnqueueReview").length);
  expect(fresh(before.notifications, after.notifications).length, "new notifications")
    .toBe(effects.filter((e) => e.type === "Notify").length);
  const settledGames = new Set(effects.filter((e) => e.type === "SettleDeposit").map((e) => e.gameId));
  const due = await db.asService((tx) => tx.query<{ game_id: string; outcome: string }>(
    `select game_id::text, outcome from public.due_deposit_settlements()`), { now: c.now });
  // Settlements newly due because of this event must all be expected SettleDeposit effects.
  const unexpected = due.rows.filter((r) => !settledGames.has(r.game_id) && !before.dues.has(`${r.game_id}:${r.outcome}`));
  expect(unexpected, "unexpected deposit settlements").toEqual([]);
  const [p] = await db.query<any>(`select * from profiles where id = $1`, [c.input.state.userId]);
  if (!effects.some((e) => e.type === "BanJoins") && !(c.input.state.sanctions ?? []).some((s: any) => s.kind === "join_ban"
      && ["active", "upheld", "disputed"].includes(s.status) && Date.parse(s.expiresAt) > Date.parse(c.now))) {
    expect(p.join_banned_until, "no join ban").toBeNull();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("golden: trust.applyEvent (DB-backed)", () => {
  const list = cases.filter((c) => c.kind === "trust.applyEvent");
  for (const c of list) {
    const reason = UNSUPPORTED[c.input.event.type as string];
    if (reason) {
      it.skip(`${c.name} — ${reason}`, () => undefined);
      continue;
    }
    it(c.name, async () => {
      await seedState(c);
      if (c.config) {
        await db.query(`create temporary table golden_cfg as select (public.st_config_merge($1::jsonb)).*`, [JSON.stringify(c.config)]);
        await db.exec(`delete from trust_config; insert into trust_config select * from golden_cfg; drop table golden_cfg;`);
      }
      const before = await snapshot(c.now);
      await runEvent(c);
      await checkEffects(c, before);
    });
  }
});

describe("golden: kinds without a SQL runner", () => {
  const known = new Set([...Object.keys(PURE), "trust.applyEvent"]);
  const unknown = [...new Set(cases.map((c) => c.kind))].filter((k) => !known.has(k));
  for (const k of unknown) it.skip(`${k} — no SQL counterpart registered yet`, () => undefined);
  it("every golden kind is either run or explicitly skipped", () => {
    expect(unknown).toEqual([]);
  });
});
