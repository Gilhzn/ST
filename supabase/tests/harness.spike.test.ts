/**
 * M1d spike: proves the PGlite harness supports what the SQL test suite needs.
 *  (a) PostGIS geography + ST_DWithin
 *  (b) RLS enforced under SET LOCAL ROLE from the PGlite superuser
 *  (c) SECURITY DEFINER functions bypass RLS as expected (and SECURITY INVOKER does not)
 * plus harness plumbing (auth.* shims, service_role BYPASSRLS, reset, rollback, st.now).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

let db: Harness;

beforeAll(async () => {
  db = await createHarness();
});

afterAll(async () => {
  await db?.close();
});

describe("harness boot", () => {
  it("runs as superuser postgres with PostGIS and pgcrypto in the extensions schema", async () => {
    const [row] = await db.query<{ u: string; postgis: string; pgcrypto: string }>(
      `select current_user as u,
              (select extnamespace::regnamespace::text from pg_extension where extname = 'postgis') as postgis,
              (select extnamespace::regnamespace::text from pg_extension where extname = 'pgcrypto') as pgcrypto`,
    );
    expect(row).toEqual({ u: "postgres", postgis: "extensions", pgcrypto: "extensions" });
  });

  it("exposes pgcrypto (needed for QR HMAC) on the search_path", async () => {
    const [row] = await db.query<{ h: string }>(`select encode(hmac('game1|0', 'secret', 'sha256'), 'hex') as h`);
    expect(row?.h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("(a) PostGIS", () => {
  // Dizengoff Square, Tel Aviv
  const lon = 34.7745;
  const lat = 32.0779;

  it("ST_DWithin on geography: 40m apart is within 50m, 2km apart is not", async () => {
    const [row] = await db.query<{ d40: number; near: boolean; far: boolean; d2k: number }>(
      `with p as (select st_setsrid(st_makepoint($1, $2), 4326)::geography as g)
       select st_distance(p.g, st_project(p.g, 40, radians(90))) as d40,
              st_dwithin(p.g, st_project(p.g, 40, radians(90)), 50) as near,
              st_distance(p.g, st_project(p.g, 2000, radians(0))) as d2k,
              st_dwithin(p.g, st_project(p.g, 2000, radians(0)), 50) as far
       from p`,
      [lon, lat],
    );
    expect(row?.d40).toBeCloseTo(40, 0);
    expect(row?.near).toBe(true);
    expect(row?.d2k).toBeCloseTo(2000, -1);
    expect(row?.far).toBe(false);
  });

  it("supports geography columns with a GiST index and radius queries", async () => {
    await db.exec(`
      create table public.spike_venues (id int primary key, g extensions.geography(Point, 4326) not null);
      create index on public.spike_venues using gist (g);
      insert into public.spike_venues values
        (1, st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography),
        (2, st_project(st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography, 900, 0)::geography),
        (3, st_project(st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography, 4500, 0)::geography);
    `);
    const rows = await db.query<{ id: number }>(
      `select id from public.spike_venues
       where st_dwithin(g, st_setsrid(st_makepoint($1, $2), 4326)::geography, 1000) order by id`,
      [lon, lat],
    );
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
    await db.exec(`drop table public.spike_venues`);
  });
});

describe("(b) RLS under SET LOCAL ROLE", () => {
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    alice = await db.createUser({ phone: "+972500000001" });
    bob = await db.createUser("+972500000002");
    await db.exec(`
      create table public.spike_notes (
        id bigint generated always as identity primary key,
        owner uuid not null references auth.users(id) default auth.uid(),
        body text not null
      );
      alter table public.spike_notes enable row level security;
      -- DB migrations revoke Supabase's broad default grants (0090_rls_grants.sql), so grant explicitly.
      grant select, insert, update, delete on public.spike_notes to anon, authenticated;
      create policy spike_notes_select on public.spike_notes for select to authenticated using (owner = auth.uid());
      create policy spike_notes_insert on public.spike_notes for insert to authenticated with check (owner = auth.uid());
    `);
    await db.query(`insert into public.spike_notes (owner, body) values ($1, 'a1'), ($1, 'a2'), ($2, 'b1')`, [alice, bob]);
  });

  afterAll(async () => {
    await db.exec(`drop table if exists public.spike_notes`);
  });

  it("auth.uid()/auth.role()/auth.jwt() read the transaction-local claims", async () => {
    const row = await db.asUser(alice, async (tx) => {
      const r = await tx.query<{ uid: string; role: string; aud: string; cu: string }>(
        `select auth.uid() as uid, auth.role() as role, auth.jwt()->>'aud' as aud, current_user as cu`,
      );
      return r.rows[0];
    });
    expect(row).toEqual({ uid: alice, role: "authenticated", aud: "authenticated", cu: "authenticated" });
    // Role and claims are transaction-local: back to superuser, no claims.
    const [after] = await db.query<{ cu: string; uid: string | null }>(`select current_user as cu, auth.uid() as uid`);
    expect(after).toEqual({ cu: "postgres", uid: null });
  });

  it("each user sees only their own rows", async () => {
    const aliceRows = await db.asUser(alice, (tx) => tx.query<{ body: string }>(`select body from spike_notes order by body`));
    const bobRows = await db.asUser(bob, (tx) => tx.query<{ body: string }>(`select body from spike_notes order by body`));
    expect(aliceRows.rows.map((r) => r.body)).toEqual(["a1", "a2"]);
    expect(bobRows.rows.map((r) => r.body)).toEqual(["b1"]);
  });

  it("anon sees nothing (no policy for anon)", async () => {
    const rows = await db.asAnon((tx) => tx.query(`select * from spike_notes`));
    expect(rows.rows).toHaveLength(0);
  });

  it("WITH CHECK rejects inserting a row owned by someone else", async () => {
    await expect(
      db.asUser(alice, (tx) => tx.query(`insert into spike_notes (owner, body) values ($1, 'forged')`, [bob])),
    ).rejects.toThrow(/row-level security/);
    // Failed transaction rolled back; own insert works and is visible only to alice.
    await db.asUser(alice, (tx) => tx.query(`insert into spike_notes (body) values ('a3')`));
    const [count] = await db.query<{ n: number }>(`select count(*)::int as n from spike_notes where body = 'forged'`);
    expect(count?.n).toBe(0);
  });

  it("UPDATE/DELETE of other users' rows silently affect 0 rows (no policy)", async () => {
    const res = await db.asUser(alice, (tx) => tx.query(`delete from spike_notes where owner = $1`, [bob]));
    expect(res.affectedRows ?? 0).toBe(0);
  });

  it("anon cannot write (RLS denies)", async () => {
    await expect(db.asAnon((tx) => tx.query(`insert into spike_notes (owner, body) values ($1, 'x')`, [alice]))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("service_role bypasses RLS (BYPASSRLS)", async () => {
    const rows = await db.asService((tx) => tx.query(`select * from spike_notes`));
    expect(rows.rows.length).toBeGreaterThanOrEqual(3);
  });

  it("superuser postgres (db.query) bypasses RLS, so fixtures can be seeded directly", async () => {
    const [n] = await db.query<{ n: number }>(`select count(*)::int as n from spike_notes`);
    expect(n?.n).toBeGreaterThanOrEqual(3);
  });

  it("rollback option discards writes", async () => {
    await db.asUser(alice, (tx) => tx.query(`insert into spike_notes (body) values ('temp')`), { rollback: true });
    const [n] = await db.query<{ n: number }>(`select count(*)::int as n from spike_notes where body = 'temp'`);
    expect(n?.n).toBe(0);
  });

  it("st.now fake clock is visible inside the transaction only", async () => {
    const at = "2026-01-01T10:00:00.000Z";
    const v = await db.asUser(
      alice,
      async (tx) =>
        (await tx.query<{ t: Date }>(`select coalesce(nullif(current_setting('st.now', true), '')::timestamptz, now()) as t`))
          .rows[0]?.t,
      { now: at },
    );
    expect(v?.toISOString()).toBe(at);
  });

  it("revoked table privilege is enforced in addition to RLS", async () => {
    await db.exec(`revoke insert on public.spike_notes from authenticated`);
    await expect(db.asUser(alice, (tx) => tx.query(`insert into spike_notes (body) values ('nope')`))).rejects.toThrow(
      /permission denied/,
    );
    await db.exec(`grant insert on public.spike_notes to authenticated`);
  });
});

describe("(c) SECURITY DEFINER vs INVOKER", () => {
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    alice = await db.createUser();
    bob = await db.createUser();
    await db.exec(`
      create table public.spike_trust (user_id uuid primary key references auth.users(id), cards int not null default 0);
      alter table public.spike_trust enable row level security;
      create policy spike_trust_read on public.spike_trust for select to authenticated using (user_id = auth.uid());
      -- no insert/update policy: clients can never write trust columns directly

      create function public.spike_count_all_definer() returns int
        language sql security definer set search_path = '' as $$ select count(*)::int from public.spike_trust $$;
      create function public.spike_count_all_invoker() returns int
        language sql security invoker set search_path = '' as $$ select count(*)::int from public.spike_trust $$;
      create function public.spike_issue_card(target uuid) returns void
        language plpgsql security definer set search_path = '' as $$
        begin
          if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
          insert into public.spike_trust (user_id, cards) values (target, 1)
            on conflict (user_id) do update set cards = public.spike_trust.cards + 1;
        end $$;
      -- Migrations revoke default grants (0090_rls_grants.sql): grant what the spike relies on.
      grant select, update on public.spike_trust to authenticated;
      grant execute on function public.spike_count_all_definer(), public.spike_count_all_invoker(),
        public.spike_issue_card(uuid) to authenticated;
      revoke execute on function public.spike_issue_card(uuid) from public, anon;
    `);
    await db.query(`insert into public.spike_trust values ($1, 0), ($2, 0)`, [alice, bob]);
  });

  afterAll(async () => {
    await db.exec(`
      drop function public.spike_count_all_definer();
      drop function public.spike_count_all_invoker();
      drop function public.spike_issue_card(uuid);
      drop table public.spike_trust;
    `);
  });

  it("definer function sees all rows; invoker function is filtered by RLS", async () => {
    const res = await db.asUser(alice, async (tx) => {
      const d = await tx.query<{ n: number }>(`select public.spike_count_all_definer() as n`);
      const i = await tx.query<{ n: number }>(`select public.spike_count_all_invoker() as n`);
      return { definer: d.rows[0]?.n, invoker: i.rows[0]?.n };
    });
    expect(res).toEqual({ definer: 2, invoker: 1 });
  });

  it("direct UPDATE of trust columns is denied (0 rows) but the definer RPC can write", async () => {
    const upd = await db.asUser(alice, (tx) => tx.query(`update public.spike_trust set cards = 0 where user_id = $1`, [alice]));
    expect(upd.affectedRows ?? 0).toBe(0);
    await db.asUser(alice, (tx) => tx.query(`select public.spike_issue_card($1)`, [bob]));
    const [row] = await db.query<{ cards: number }>(`select cards from public.spike_trust where user_id = $1`, [bob]);
    expect(row?.cards).toBe(1);
  });

  it("auth.uid() inside a definer function still returns the caller's id", async () => {
    await db.exec(`create function public.spike_whoami() returns uuid language sql security definer set search_path = '' as $$ select auth.uid() $$`);
    await db.exec(`grant execute on function public.spike_whoami() to authenticated`);
    const id = await db.asUser(bob, async (tx) => (await tx.query<{ id: string }>(`select public.spike_whoami() as id`)).rows[0]?.id);
    expect(id).toBe(bob);
    await db.exec(`drop function public.spike_whoami()`);
  });

  it("EXECUTE revoked from anon is enforced", async () => {
    await expect(db.asAnon((tx) => tx.query(`select public.spike_issue_card($1)`, [bob]))).rejects.toThrow(/permission denied/);
  });
});

describe("reset()", () => {
  it("truncates app tables including auth.users", async () => {
    await db.createUser();
    await db.reset();
    const [n] = await db.query<{ n: number }>(`select count(*)::int as n from auth.users`);
    expect(n?.n).toBe(0);
  });

  it("restores rows seeded by migrations (simulated via a fresh harness with extraSql)", async () => {
    const h = await createHarness({
      cache: false,
      extraSql: `create table public.spike_cfg (k text primary key, v int);
                 insert into public.spike_cfg values ('ban_days_2', 7), ('ban_days_3', 30);`,
    });
    try {
      await h.exec(`update public.spike_cfg set v = 99; insert into public.spike_cfg values ('x', 1)`);
      await h.reset();
      const rows = await h.query<{ k: string; v: number }>(`select k, v from public.spike_cfg order by k`);
      expect(rows).toEqual([
        { k: "ban_days_2", v: 7 },
        { k: "ban_days_3", v: 30 },
      ]);
    } finally {
      await h.close();
    }
  });
});
