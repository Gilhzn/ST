/**
 * Shared fixtures for the SQL tests (DB Engineer). Builds users, venues and games directly as the
 * superuser so tests control timestamps, then exercises RPCs as real roles through the harness.
 */
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { Harness, RoleOptions, Tx } from "./harness";

/** Fixed reference time for scenarios: games start at T0. */
export const T0 = new Date("2026-11-02T18:00:00.000Z");
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);
export const iso = (d: Date): string => d.toISOString();

/** Tel Aviv, Dizengoff Square. */
export const TLV = { lat: 32.0779, lng: 34.7745 };

let phoneSeq = 1000;

export interface UserOpts {
  name?: string;
  gender?: "female" | "male" | "non_binary" | "undisclosed";
  createdAt?: Date;
  birthYear?: number;
}

/** auth user + profile + profile_private. Account created 60 days before T0 unless given. */
export async function makeUser(db: Harness, opts: UserOpts = {}): Promise<string> {
  const createdAt = opts.createdAt ?? at(-60 * DAY);
  const id = await db.createUser({ phone: `+97250${String(phoneSeq++).padStart(7, "0")}`, createdAt });
  await db.query(
    `insert into public.profiles (id, display_name, created_at) values ($1, $2, $3);
     `,
    [id, opts.name ?? `user-${id.slice(0, 6)}`, iso(createdAt)],
  );
  await db.query(
    `insert into public.profile_private (user_id, phone, birth_year, birth_month, gender)
     select $1, u.phone, $2, 1, $3::public.gender from auth.users u where u.id = $1`,
    [id, opts.birthYear ?? 1995, opts.gender ?? "male"],
  );
  return id;
}

export async function makeModerator(db: Harness): Promise<string> {
  const id = await makeUser(db, { name: "mod" });
  await db.query(`insert into public.app_roles (user_id, role) values ($1, 'moderator')`, [id]);
  return id;
}

export async function makeVenue(
  db: Harness,
  opts: { lat?: number; lng?: number; sports?: string[]; createdBy?: string | null; name?: string; status?: string } = {},
): Promise<string> {
  const [r] = await db.query<{ id: string }>(
    `insert into public.venues (name, geog, sports, created_by, status)
     values ($1, public.st_point($2, $3), $4, $5, $6::public.venue_status) returning id`,
    [
      opts.name ?? "Venue",
      opts.lat ?? TLV.lat,
      opts.lng ?? TLV.lng,
      opts.sports ?? ["football"],
      opts.createdBy ?? null,
      opts.status ?? "active",
    ],
  );
  return r!.id;
}

export interface GameOpts {
  sport?: string;
  title?: string;
  visibility?: "public" | "private";
  venueId?: string | null;
  lat?: number;
  lng?: number;
  hideExactLocation?: boolean;
  capacity?: number;
  startsAt?: Date;
  endsAt?: Date;
  depositMinor?: number;
  womenOnly?: boolean;
  teamCount?: number;
}

/** Inserts a game directly (host approved). Defaults: public football, T0..T0+90m, capacity 10. */
export async function makeGame(db: Harness, hostId: string, o: GameOpts = {}): Promise<string> {
  const startsAt = o.startsAt ?? T0;
  const endsAt = o.endsAt ?? new Date(startsAt.getTime() + 90 * MIN);
  const [r] = await db.query<{ id: string }>(
    `insert into public.games (host_id, sport, title, visibility, venue_id, geog, approx_geog, hide_exact_location, capacity,
                               starts_at, ends_at, deposit_minor, currency, women_only, team_count, created_at)
     values ($1, $2, $3, $4::public.game_visibility, $5, public.st_point($6, $7), public.st_point($6, $7), $8, $9,
             $10, $11, $12, 'EUR', $13, $14, $15)
     returning id`,
    [
      hostId,
      o.sport ?? "football",
      o.title ?? "Pickup",
      o.visibility ?? "public",
      o.venueId ?? null,
      o.lat ?? TLV.lat,
      o.lng ?? TLV.lng,
      o.hideExactLocation ?? false,
      o.capacity ?? 10,
      iso(startsAt),
      iso(endsAt),
      o.depositMinor ?? 0,
      o.womenOnly ?? false,
      o.teamCount ?? 2,
      iso(at(-7 * DAY)),
    ],
  );
  await db.query(
    `insert into public.game_participants (game_id, user_id, status, requested_at, decided_at)
     values ($1, $2, 'approved', $3, $3)`,
    [r!.id, hostId, iso(at(-7 * DAY))],
  );
  return r!.id;
}

/** Adds a participant row directly. */
export async function addParticipant(
  db: Harness,
  gameId: string,
  userId: string,
  status = "approved",
  extra: { attendance?: string; team?: number | null; waitlistedAt?: Date } = {},
): Promise<void> {
  const verified = extra.attendance === "verified";
  await db.query(
    `insert into public.game_participants (game_id, user_id, status, attendance, team, requested_at, decided_at, waitlisted_at,
                                           check_in_method, checked_in_at)
     values ($1, $2, $3::public.participant_status, $4::public.attendance_status, $5, $6, $6, $7, $8::public.checkin_method, $9)`,
    [
      gameId,
      userId,
      status,
      extra.attendance ?? "unknown",
      extra.team ?? null,
      iso(at(-6 * DAY)),
      status === "waitlisted" ? iso(extra.waitlistedAt ?? at(-5 * DAY)) : null,
      verified ? "qr" : null,
      verified ? iso(at(0)) : null,
    ],
  );
}

/** Runs one SQL statement as a user and returns the rows. */
export async function asUser<T = Record<string, unknown>>(
  db: Harness,
  userId: string,
  sql: string,
  params: unknown[] = [],
  opts: RoleOptions = {},
): Promise<T[]> {
  return db.asUser(userId, async (tx: Tx) => (await tx.query<T>(sql, params)).rows, opts);
}

export async function asService<T = Record<string, unknown>>(
  db: Harness,
  sql: string,
  params: unknown[] = [],
  opts: RoleOptions = {},
): Promise<T[]> {
  return db.asService(async (tx: Tx) => (await tx.query<T>(sql, params)).rows, opts);
}

export async function asAnon<T = Record<string, unknown>>(db: Harness, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.asAnon(async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
}

/** Asserts the promise rejects with `ST:<code>` (exact code). */
export async function expectSt(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toThrow(new RegExp(`^ST:${code}$`));
}

export const uuid = (): string => randomUUID();

export async function sanctionsOf(db: Harness, userId: string) {
  return db.query<{
    id: string;
    kind: string;
    reason_code: string;
    status: string;
    dedupe_key: string;
    expires_at: Date | null;
    dispute_until: Date | null;
    caused_by: string[];
    void_reason: string | null;
  }>(`select * from public.sanctions where user_id = $1 order by created_at, id`, [userId]);
}

export async function profileOf(db: Harness, userId: string) {
  const [p] = await db.query<Record<string, unknown>>(`select * from public.profiles where id = $1`, [userId]);
  return p!;
}
