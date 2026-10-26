/**
 * Sport Talent SQL test harness (QA Lead spike, M1d).
 *
 * Boots an in-memory PGlite (Postgres 18 compiled to WASM) with PostGIS + pgcrypto, installs
 * Supabase shims (roles, `auth` schema, `auth.uid()`/`auth.jwt()`/`auth.role()`, default grants),
 * applies `supabase/migrations/*.sql` in lexical order and exposes role-scoped helpers.
 *
 * Usage (one harness per test file; tests within a file share it and call `reset()`):
 *
 *   let db: Harness;
 *   beforeAll(async () => { db = await createHarness(); });
 *   afterEach(() => db.reset());
 *   afterAll(() => db.close());
 *
 *   const alice = await db.createUser({ phone: "+972500000001" });
 *   const rows = await db.asUser(alice, (tx) => tx.query("select * from profiles"));
 *   await expect(db.asAnon((tx) => tx.query("insert into ..."))).rejects.toThrow(/row-level security/);
 *
 * Verified empirically (see harness.spike.test.ts): `SET LOCAL ROLE authenticated` from the PGlite
 * superuser enforces RLS; `service_role` has BYPASSRLS; SECURITY DEFINER functions owned by
 * `postgres` bypass RLS; PostGIS 3.6 geography/ST_DWithin works.
 *
 * Env:
 *   ST_PGLITE_CACHE=0   disable the on-disk snapshot cache (default on; key = hash of pglite
 *                       versions + shims + migrations, stored in <repo>/node_modules/.cache/st-pglite)
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite, type Results, type Transaction } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { postgis } from "@electric-sql/pglite-postgis";

const SUPABASE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations");
const CACHE_DIR = resolve(SUPABASE_DIR, "..", "node_modules", ".cache", "st-pglite");
const HARNESS_VERSION = "2";

/** Query surface handed to role-scoped callbacks (a PGlite transaction). */
export type Tx = Pick<Transaction, "query" | "exec" | "sql">;

export interface RoleOptions {
  /** Extra JWT claims merged over the defaults (e.g. `{ app_metadata: { role: "moderator" } }`). */
  claims?: Record<string, unknown>;
  /** Always roll back at the end (assert-only blocks that must not leave data behind). */
  rollback?: boolean;
  /**
   * Fake "now" exposed as the transaction-local GUC `st.now` (ISO string). Postgres `now()` cannot
   * be faked; time-dependent SQL should read
   * `coalesce(nullif(current_setting('st.now', true), '')::timestamptz, now())`.
   */
  now?: Date | string;
}

export interface CreateUserOptions {
  id?: string;
  phone?: string | null;
  email?: string | null;
  createdAt?: Date | string;
  userMetadata?: Record<string, unknown>;
  appMetadata?: Record<string, unknown>;
}

export interface HarnessOptions {
  /** Override the migrations directory (default `supabase/migrations`). */
  migrationsDir?: string;
  /** Extra SQL run after migrations (e.g. a fixture), included in the snapshot. */
  extraSql?: string;
  /** Use the on-disk snapshot cache (default: true unless ST_PGLITE_CACHE=0). */
  cache?: boolean;
}

export interface Harness {
  /** Raw PGlite instance (superuser `postgres`). Do not call it from inside a role callback. */
  readonly pg: PGlite;
  /** Superuser query returning rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Superuser multi-statement exec. */
  exec(sql: string): Promise<void>;
  /** Run `fn` as `authenticated` with `sub = userId`. Transaction commits unless `fn` throws or `rollback`. */
  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, opts?: RoleOptions): Promise<T>;
  /** Run `fn` as `anon` (no `sub`). */
  asAnon<T>(fn: (tx: Tx) => Promise<T>, opts?: RoleOptions): Promise<T>;
  /** Run `fn` as `service_role` (BYPASSRLS), like an Edge Function using the service key. */
  asService<T>(fn: (tx: Tx) => Promise<T>, opts?: RoleOptions): Promise<T>;
  /** Generic role runner (`anon` | `authenticated` | `service_role` | any role created by migrations). */
  asRole<T>(role: string, claims: Record<string, unknown>, fn: (tx: Tx) => Promise<T>, opts?: RoleOptions): Promise<T>;
  /** Insert into `auth.users`; returns the new user id. Fires any trigger migrations attach to auth.users. */
  createUser(opts?: CreateUserOptions | string): Promise<string>;
  /** Truncate every app table and restore rows that migrations seeded (triggers/FKs suspended during restore). */
  reset(): Promise<void>;
  close(): Promise<void>;
  /** Milliseconds spent booting (diagnostics). */
  readonly bootMs: number;
  /** Whether the instance was restored from the snapshot cache. */
  readonly fromCache: boolean;
}

/** Supabase compatibility shims. Mirrors the parts of the Supabase platform schema our migrations rely on. */
export const SUPABASE_SHIM_SQL = /* sql */ `
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

grant usage on schema public, extensions to anon, authenticated, service_role;
grant all on all tables in schema extensions to service_role;
grant select on all tables in schema extensions to anon, authenticated;

-- Supabase grants table/sequence/function privileges broadly and relies on RLS as the gate.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text default 'authenticated',
  role text default 'authenticated',
  email text unique,
  phone text unique,
  phone_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select on auth.users to service_role;
grant all on auth.users to service_role;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

alter database postgres set search_path = "$user", public, extensions;
`;

/** Session-level settings re-applied on every boot (session state is not part of a data-dir snapshot). */
const SESSION_SQL = `set search_path = "$user", public, extensions;`;

/** Tables that are never truncated or snapshotted. */
const EXCLUDED_SCHEMAS = ["pg_catalog", "information_schema", "extensions", "_harness", "pg_toast"];

async function listMigrations(dir: string): Promise<{ name: string; sql: string }[]> {
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(join(dir, name), "utf8") })));
}

async function pkgVersion(spec: string): Promise<string> {
  try {
    const p = resolve(SUPABASE_DIR, "..", "node_modules", spec, "package.json");
    return (JSON.parse(await readFile(p, "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

function newPg(loadDataDir?: Blob): PGlite {
  return new PGlite({
    extensions: { postgis, pgcrypto },
    relaxedDurability: true,
    ...(loadDataDir ? { loadDataDir } : {}),
  });
}

/** Build the snapshot of seeded rows used by `reset()`. */
const SNAPSHOT_SQL = /* sql */ `
create schema if not exists _harness;
do $$
declare r record; has_rows boolean;
begin
  for r in
    select n.nspname as s, c.relname as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname not in (${EXCLUDED_SCHEMAS.map((s) => `'${s}'`).join(", ")})
      and n.nspname not like 'pg_temp%'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('create table _harness.%I as select * from %I.%I', r.s || '.' || r.t, r.s, r.t);
    execute format('select exists (select 1 from _harness.%I)', r.s || '.' || r.t) into has_rows;
    if not has_rows then
      execute format('drop table _harness.%I', r.s || '.' || r.t);
    end if;
  end loop;
end $$;
`;

const RESET_SQL = /* sql */ `
do $$
declare r record; tables text; cols text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ') into tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname not in (${EXCLUDED_SCHEMAS.map((s) => `'${s}'`).join(", ")})
    and n.nspname not like 'pg_temp%'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  set local session_replication_role = replica;
  if tables is not null then
    execute 'truncate ' || tables || ' cascade';
  end if;
  for r in select c.relname as snap from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = '_harness' and c.relkind = 'r'
  loop
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
    where a.attrelid = to_regclass(format('%I.%I', split_part(r.snap, '.', 1), split_part(r.snap, '.', 2)))
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    execute format('insert into %I.%I (%s) overriding system value select %s from _harness.%I',
      split_part(r.snap, '.', 1), split_part(r.snap, '.', 2), cols, cols, r.snap);
  end loop;
end $$;
`;

async function boot(opts: HarnessOptions): Promise<{ pg: PGlite; fromCache: boolean }> {
  const migrations = await listMigrations(opts.migrationsDir ?? MIGRATIONS_DIR);
  const useCache = opts.cache ?? process.env.ST_PGLITE_CACHE !== "0";
  const key = createHash("sha256")
    .update(HARNESS_VERSION)
    .update(await pkgVersion("@electric-sql/pglite"))
    .update(await pkgVersion("@electric-sql/pglite-postgis"))
    .update(SUPABASE_SHIM_SQL)
    .update(SNAPSHOT_SQL)
    .update(opts.extraSql ?? "")
    .update(JSON.stringify(migrations))
    .digest("hex")
    .slice(0, 24);
  const cacheFile = join(CACHE_DIR, `${key}.tar`);

  if (useCache && existsSync(cacheFile)) {
    try {
      const pg = newPg(new Blob([await readFile(cacheFile)]));
      await pg.waitReady;
      await pg.exec(SESSION_SQL);
      return { pg, fromCache: true };
    } catch {
      // Corrupt/incompatible snapshot: fall through to a clean build.
    }
  }

  const pg = newPg();
  await pg.waitReady;
  await pg.exec(SUPABASE_SHIM_SQL);
  await pg.exec(SESSION_SQL);
  for (const m of migrations) {
    try {
      await pg.exec(m.sql);
    } catch (err) {
      await pg.close().catch(() => undefined);
      const e = err as Error & { position?: string };
      throw new Error(`Migration ${m.name} failed: ${e.message}${e.position ? ` (at char ${e.position})` : ""}`, {
        cause: err,
      });
    }
  }
  if (opts.extraSql) await pg.exec(opts.extraSql);
  await pg.exec(SNAPSHOT_SQL);

  if (useCache) {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      const dump = await pg.dumpDataDir("none");
      const tmp = `${cacheFile}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tmp, Buffer.from(await dump.arrayBuffer()));
      await rename(tmp, cacheFile); // atomic: parallel workers may race, last one wins.
    } catch {
      // Cache is an optimisation only.
    }
  }
  return { pg, fromCache: false };
}

function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  if (process.env.SQL_TESTS === "pg") {
    throw new Error(
      "SQL_TESTS=pg (native PG16 fallback) is not implemented: the PGlite spike passed, so it is not needed. " +
        "See docs/qa-strategy.md §SQL tests.",
    );
  }
  const t0 = performance.now();
  const { pg, fromCache } = await boot(opts);
  const bootMs = performance.now() - t0;

  async function asRole<T>(
    role: string,
    claims: Record<string, unknown>,
    fn: (tx: Tx) => Promise<T>,
    o: RoleOptions = {},
  ): Promise<T> {
    if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Invalid role name: ${role}`);
    const allClaims = { role, ...claims, ...(o.claims ?? {}) };
    return pg.transaction(async (tx) => {
      // st.now is honoured by public.st_now() only in test mode (security L2).
      await tx.query(
        `select set_config('request.jwt.claims', $1, true), set_config('st.now', $2, true), set_config('st.test_mode', 'on', true)`,
        [JSON.stringify(allClaims), o.now ? toIso(o.now) : ""],
      );
      await tx.exec(`set local role ${role}`);
      const result = await fn(tx);
      if (o.rollback && !tx.closed) await tx.rollback();
      return result;
    });
  }

  const harness: Harness = {
    pg,
    bootMs,
    fromCache,
    async query<T>(sql: string, params?: unknown[]) {
      const r: Results<T> = await pg.query<T>(sql, params as unknown[]);
      return r.rows;
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    asRole,
    asUser: (userId, fn, o) =>
      asRole("authenticated", { sub: userId, aud: "authenticated" }, fn, o),
    asAnon: (fn, o) => asRole("anon", {}, fn, o),
    asService: (fn, o) => asRole("service_role", {}, fn, o),
    async createUser(arg) {
      const o: CreateUserOptions = typeof arg === "string" ? { phone: arg } : (arg ?? {});
      const id = o.id ?? randomUUID();
      await pg.query(
        `insert into auth.users (id, phone, email, created_at, raw_user_meta_data, raw_app_meta_data, phone_confirmed_at)
         values ($1::uuid, $2::text, $3::text, coalesce($4::timestamptz, now()), $5::jsonb, $6::jsonb, case when $2::text is null then null else now() end)`,
        [
          id,
          o.phone ?? null,
          o.email ?? null,
          o.createdAt ? toIso(o.createdAt) : null,
          JSON.stringify(o.userMetadata ?? {}),
          JSON.stringify(o.appMetadata ?? {}),
        ],
      );
      return id;
    },
    async reset() {
      await pg.transaction(async (tx) => {
        await tx.exec(RESET_SQL);
      });
    },
    async close() {
      if (!pg.closed) await pg.close();
    },
  };
  return harness;
}
