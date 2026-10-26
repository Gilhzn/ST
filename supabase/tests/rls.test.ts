/**
 * RLS / privilege matrix (qa-strategy §5.1, §5.2). One scenario with rows in every table, then for
 * every table × role the visible row count (or "deny" = permission denied) is asserted, every
 * client write path is attempted, and catalog-level invariants are checked. A new table without a
 * matrix row fails the build.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type Tx } from "./harness";
import { addParticipant, at, iso, makeGame, makeModerator, makeUser, makeVenue } from "./fixtures";

let db: Harness;
const ids: Record<string, string> = {};

type Role = "anon" | "stranger" | "owner" | "host" | "moderator" | "service";
const ROLES: Role[] = ["anon", "stranger", "owner", "host", "moderator", "service"];
type Exp = number | "deny";
/** Visible rows: [anon, stranger, owner(player), host, moderator, service]. */
const MATRIX: Record<string, [Exp, Exp, Exp, Exp, Exp, Exp]> = {
  sports: [6, 6, 6, 6, 6, 6],
  trust_config: ["deny", 1, 1, 1, 1, 1],
  profiles: ["deny", 1, 1, 1, 6, 6],
  profile_private: ["deny", 1, 1, 1, 1, 6],
  user_sports: ["deny", 1, 1, 2, 2, 2],
  push_tokens: ["deny", 0, 1, 0, 0, 1],
  blocks: ["deny", 0, 1, 0, 0, 1],
  app_roles: ["deny", 0, 0, 0, 1, 1],
  venues: ["deny", 1, 2, 1, 2, 2],
  venue_ratings: ["deny", 0, 1, 1, 1, 1],
  venue_reports: ["deny", 0, 1, 0, 1, 1],
  games: ["deny", 1, 1, 2, 2, 2],
  game_participants: ["deny", 0, 2, 4, 4, 4],
  game_invite_access: ["deny", 0, 0, 0, 0, 1],
  checkins: ["deny", 0, 1, 1, 1, 1],
  peer_confirmations: ["deny", 0, 1, 1, 0, 1],
  game_results: ["deny", 1, 1, 1, 1, 1],
  host_ratings: ["deny", 0, 1, 0, 1, 1],
  sanctions: ["deny", 0, 1, 0, 1, 1],
  appeals: ["deny", 0, 1, 0, 1, 1],
  user_reports: ["deny", 0, 1, 0, 1, 1],
  review_queue: ["deny", 0, 0, 0, 1, 1],
  audit_log: ["deny", 0, 0, 0, 1, 1],
  chat_messages: ["deny", 0, 1, 1, 0, 1],
  moderation_retained: ["deny", "deny", "deny", "deny", "deny", 1],
  message_translations: ["deny", 0, 1, 1, 0, 1],
  notifications: ["deny", 0, 1, 1, 0, 2],
  payments: ["deny", 0, 1, 0, 0, 1],
  payment_customers: ["deny", "deny", "deny", "deny", "deny", 1],
  payment_events: ["deny", "deny", "deny", "deny", "deny", 1],
};
/** Views: [anon, stranger, owner, host, moderator, service]. */
const VIEWS: Record<string, [Exp, Exp, Exp, Exp, Exp, Exp]> = {
  public_profiles: ["deny", 4, 4, 5, 5, 0],
  game_views: ["deny", 1, 1, 2, 2, 0],
  participant_views: ["deny", 0, 2, 4, 4, 0],
  venue_views: ["deny", 1, 2, 1, 2, 2],
};
/** Tables where some client writes are granted (tested explicitly below). */
const CLIENT_WRITABLE: Record<string, ("insert" | "update" | "delete")[]> = {
  profiles: ["update"],
  profile_private: ["update"],
  user_sports: ["insert", "update", "delete"],
  push_tokens: ["delete"],
  blocks: ["insert", "delete"],
  notifications: ["update"],
};

function run<T>(role: Role, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const opts = { rollback: true };
  switch (role) {
    case "anon": return db.asAnon(fn, opts);
    case "service": return db.asService(fn, opts);
    case "stranger": return db.asUser(ids.S!, fn, opts);
    case "owner": return db.asUser(ids.P!, fn, opts);
    case "host": return db.asUser(ids.H!, fn, opts);
    case "moderator": return db.asUser(ids.M!, fn, opts);
  }
}

async function visible(role: Role, rel: string): Promise<Exp> {
  try {
    return await run(role, async (tx) => (await tx.query<{ n: number }>(`select count(*)::int as n from public.${rel}`)).rows[0]!.n);
  } catch (e) {
    if (/permission denied/.test((e as Error).message)) return "deny";
    throw e;
  }
}

beforeAll(async () => {
  db = await createHarness();
  const H = (ids.H = await makeUser(db, { name: "host" }));
  const P = (ids.P = await makeUser(db, { name: "player" }));
  const S = (ids.S = await makeUser(db, { name: "stranger" }));
  const R = (ids.R = await makeUser(db, { name: "requester" }));
  const M = (ids.M = await makeModerator(db));
  const V = await makeVenue(db, { createdBy: H });
  await makeVenue(db, { createdBy: P, status: "hidden_pending_review" });
  const G = (ids.G = await makeGame(db, H, { venueId: V, hideExactLocation: true }));
  const G2 = await makeGame(db, H, { visibility: "private" });
  await addParticipant(db, G, P, "approved", { attendance: "verified" });
  await addParticipant(db, G, R, "requested");
  // One extra deleted user (tombstone): visible to moderators/service in profiles only.
  const D = await makeUser(db, { name: "gone" });
  await db.query(`update profiles set deleted_at = now() where id = $1`, [D]);
  await db.query(`delete from profile_private where user_id <> all ($1::uuid[])`, [[H, P, S, R, M, D]]);
  await db.exec(`
    insert into venue_ratings (venue_id, user_id, sport, overall) values ('${V}', '${P}', 'football', 4);
    insert into venue_reports (venue_id, reporter_id, reason) values ('${V}', '${P}', 'closed');
    insert into user_sports (user_id, sport, self_skill, attributes) values
      ('${P}', 'football', 3, '{"speed":3,"control":3,"overall":3}'), ('${S}', 'tennis', 2, '{"speed":2,"control":2,"overall":2}');
    insert into push_tokens (user_id, token, platform) values ('${P}', 'ExponentPushToken[p1]', 'android');
    insert into blocks (blocker_id, blocked_id) values ('${P}', '${S}');
    insert into game_invite_access (game_id, user_id) values ('${G2}', '${R}');
    insert into checkins (game_id, user_id, method, outcome) values ('${G}', '${P}', 'qr', 'verified');
    insert into peer_confirmations (game_id, confirmer_id, target_id) values ('${G}', '${P}', '${H}');
    insert into game_results (game_id, team_scores, submitted_by, submitted_at, game_ends_at)
      select id, '{1,0}', '${H}', ends_at, ends_at from games where id = '${G}';
    insert into host_ratings (game_id, rater_id, host_id, stars) values ('${G}', '${P}', '${H}', 5);
    insert into sanctions (id, user_id, kind, reason_code, statement_key, starts_at, expires_at, dispute_until, dedupe_key)
      values ('00000000-0000-4000-8000-0000000000c1', '${P}', 'yellow_card', 'no_show', 'sanctions.reason.no_show', now(),
              now() + interval '30 days', now() + interval '2 days', 'rls-card');
    insert into appeals (sanction_id, user_id, text, is_dispute) values ('00000000-0000-4000-8000-0000000000c1', '${P}', 'x', true);
    insert into user_reports (reporter_id, target_user_id, category) values ('${P}', '${S}', 'spam');
    insert into review_queue (kind, subject_user_id, due_by, dedupe_key) values ('appeal', '${P}', now(), 'rls-rq');
    insert into audit_log (action) values ('rls.test');
    insert into chat_messages (id, game_id, sender_id, body, client_msg_id)
      values ('00000000-0000-4000-8000-0000000000e1', '${G}', '${P}', 'hello', 'c1');
    insert into moderation_retained (body, reason, expires_at) values ('bad', 'blocked', now() + interval '90 days');
    insert into message_translations (message_id, target, text, provider) values ('00000000-0000-4000-8000-0000000000e1', 'he', 'שלום', 'deepl');
    insert into notifications (user_id, kind) values ('${P}', 'join_approved'), ('${H}', 'join_requested');
    insert into payments (id, user_id, game_id, amount_minor, currency, idempotency_key)
      values ('00000000-0000-4000-8000-0000000000f1', '${P}', '${G}', 500, 'EUR', 'rls-pay');
    insert into payment_customers (user_id, provider, customer_id) values ('${P}', 'stripe', 'cus_1');
    insert into payment_events (id, provider, type, payment_id) values ('evt_1', 'stripe', 'setup_intent.succeeded', '00000000-0000-4000-8000-0000000000f1');
  `);
});
afterAll(() => db?.close());

describe("catalog invariants", () => {
  it("every public table has RLS enabled and a matrix row", async () => {
    const tables = await db.query<{ t: string; rls: boolean }>(
      `select c.relname t, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p') order by 1`);
    expect(tables.filter((t) => !t.rls)).toEqual([]);
    expect(tables.map((t) => t.t).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  it("no write policy is unconditional; views are security barriers or security invokers", async () => {
    const loose = await db.query(
      `select tablename, policyname from pg_policies where schemaname = 'public' and cmd <> 'SELECT'
         and (coalesce(qual, '') in ('', 'true') and coalesce(with_check, '') in ('', 'true'))`);
    expect(loose).toEqual([]);
    const views = await db.query<{ v: string; opts: string[] }>(
      `select c.relname v, c.reloptions opts from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v' order by 1`);
    expect(views.map((v) => v.v).sort()).toEqual(Object.keys(VIEWS).sort());
    for (const v of views) expect(v.opts.some((o) => /security_(barrier|invoker)=true/.test(o))).toBe(true);
  });

  it("every SECURITY DEFINER function pins search_path; anon can execute nothing but st_now", async () => {
    const unpinned = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text[] @> array['search_path=""'], false)`);
    expect(unpinned).toEqual([]);
    const anonExec = await db.query<{ f: string }>(
      `select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    expect(anonExec.map((r) => r.f)).toEqual(["st_now"]);
    const serviceOnly = ["apply_effects", "record_checkin_verdict", "process_no_shows", "expire_sanctions", "settle_deposits",
      "place_deposit_holds", "purge_expired_messages", "purge_retained", "purge_retention", "recheck_pending_messages",
      "expire_waitlist_offers", "due_deposit_holds", "due_deposit_settlements", "st_issue_sanction", "st_overturn_sanction",
      "st_is_blocked", "st_is_moderator", "st_can_see_game", "st_config"];
    const leaks = await db.query<{ f: string }>(
      `select distinct p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any ($1) and has_function_privilege('authenticated', p.oid, 'execute')`, [serviceOnly]);
    expect(leaks).toEqual([]);
  });
});

describe("select matrix", () => {
  for (const [table, exp] of Object.entries(MATRIX)) {
    it(`${table}`, async () => {
      const got = [];
      for (const r of ROLES) got.push(await visible(r, table));
      expect(got).toEqual(exp);
    });
  }
  for (const [view, exp] of Object.entries(VIEWS)) {
    it(`view ${view}`, async () => {
      const got = [];
      for (const r of ROLES) got.push(await visible(r, view));
      expect(got).toEqual(exp);
    });
  }
});

describe("write matrix: clients cannot write outside the granted paths", () => {
  for (const table of Object.keys(MATRIX)) {
    for (const role of ["anon", "owner", "host", "moderator"] as Role[]) {
      it(`${role} → ${table}`, async () => {
        const allowed = role === "anon" ? [] : (CLIENT_WRITABLE[table] ?? []);
        const [{ col }] = await db.query<{ col: string }>(
          `select a.attname col from pg_attribute a where a.attrelid = ('public.' || $1)::regclass and a.attnum > 0
           and not a.attisdropped and a.attidentity = '' order by a.attnum limit 1`, [table]);
        if (!allowed.includes("insert")) {
          await expect(run(role, (tx) => tx.query(`insert into public.${table} default values`))).rejects.toThrow(/permission denied|row-level security/);
        }
        if (!allowed.includes("update") || ["profiles", "profile_private", "notifications"].includes(table)) {
          // For column-granted tables, the key column is never updatable.
          await expect(run(role, (tx) => tx.query(`update public.${table} set ${col} = ${col}`))).rejects.toThrow(/permission denied/);
        }
        if (!allowed.includes("delete")) {
          await expect(run(role, (tx) => tx.query(`delete from public.${table}`))).rejects.toThrow(/permission denied/);
        }
      });
    }
  }

  it("trust columns on profiles cannot be written by the owner", async () => {
    for (const col of ["reliability_score", "reliability_status", "chat_muted_until", "join_banned_until", "host_suspended_until",
      "visibility_restricted_until", "permanently_banned", "verified_host", "deleted_at", "created_at"]) {
      await expect(db.asUser(ids.P!, (tx) => tx.query(`update profiles set ${col} = ${col} where id = $1`, [ids.P]), { rollback: true }))
        .rejects.toThrow(/permission denied/);
    }
    const r = await db.asUser(ids.P!, (tx) => tx.query(`update profiles set display_name = 'P2' where id = $1`, [ids.P]), { rollback: true });
    expect(r.affectedRows).toBe(1);
    const other = await db.asUser(ids.P!, (tx) => tx.query(`update profiles set display_name = 'x' where id = $1`, [ids.S]), { rollback: true });
    expect(other.affectedRows ?? 0).toBe(0);
    await expect(db.asUser(ids.P!, (tx) => tx.query(`update profile_private set birth_year = 2015 where user_id = $1`, [ids.P]), { rollback: true }))
      .rejects.toThrow(/permission denied/);
    const g = await db.asUser(ids.P!, (tx) => tx.query(`update profile_private set gender = 'female' where user_id = $1`, [ids.P]), { rollback: true });
    expect(g.affectedRows).toBe(1);
  });

  it("owner-scoped writes: user_sports, blocks, push_tokens, notifications.read_at", async () => {
    const P = ids.P!;
    const S = ids.S!;
    await expect(db.asUser(P, (tx) => tx.query(`insert into user_sports (user_id, sport, self_skill, attributes) values ($1, 'padel', 3, '{"speed":3,"control":3,"overall":3}')`, [S]), { rollback: true }))
      .rejects.toThrow(/row-level security/);
    await db.asUser(P, (tx) => tx.query(`insert into user_sports (sport, self_skill, attributes, positions) values ('padel', 3, '{"speed":3,"control":3,"overall":3}', '{left_side}')`), { rollback: true });
    await expect(db.asUser(P, (tx) => tx.query(`insert into user_sports (sport, self_skill, attributes, positions) values ('padel', 3, '{"speed":3,"control":3,"overall":3}', '{goalkeeper}')`), { rollback: true }))
      .rejects.toThrow(/ST:validation/);
    const del = await db.asUser(P, (tx) => tx.query(`delete from user_sports where user_id = $1`, [S]), { rollback: true });
    expect(del.affectedRows ?? 0).toBe(0);
    await expect(db.asUser(P, (tx) => tx.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [S, ids.H]), { rollback: true }))
      .rejects.toThrow(/row-level security/);
    await db.asUser(P, (tx) => tx.query(`insert into blocks (blocked_id) values ($1)`, [ids.H]), { rollback: true });
    await expect(db.asUser(P, (tx) => tx.query(`insert into push_tokens (token, platform) values ('ExponentPushToken[x]', 'ios')`), { rollback: true }))
      .rejects.toThrow(/permission denied/);
    const nr = await db.asUser(P, (tx) => tx.query(`update notifications set read_at = now()`), { rollback: true });
    expect(nr.affectedRows).toBe(1);
    await expect(db.asUser(P, (tx) => tx.query(`update notifications set kind = 'game_cancelled'`), { rollback: true })).rejects.toThrow(/permission denied/);
  });

  it("service role (Edge Functions) can write trust tables; the reported user never sees reporter identity", async () => {
    const r = await db.asService((tx) => tx.query(`update sanctions set statement_params = '{"a":1}' where dedupe_key = 'rls-card'`), { rollback: true });
    expect(r.affectedRows).toBe(1);
    const reports = await db.asUser(ids.S!, (tx) => tx.query(`select * from user_reports`));
    expect(reports.rows).toHaveLength(0);
  });

  it("the exact location of a hidden game is not visible to a requester; requester sees the game approximately", async () => {
    const rows = await db.asUser(ids.R!, (tx) => tx.query<{ lat: number | null; approx_lat: number }>(`select lat, approx_lat from game_views where id = $1`, [ids.G]));
    expect(rows.rows[0]!.lat).toBeNull();
    expect(rows.rows[0]!.approx_lat).not.toBeNull();
    expect(at(0)).toBeTruthy();
    expect(iso(at(0))).toBeTruthy();
  });
});
