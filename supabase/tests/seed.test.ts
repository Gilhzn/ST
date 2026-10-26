import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

const SEED = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "seed.sql"), "utf8");
let db: Harness;
beforeAll(async () => {
  db = await createHarness({ extraSql: SEED });
});
afterAll(() => db?.close());

describe("seed.sql", () => {
  it("loads demo venues and games in 8 cities, visible on the map to a signed-in user", async () => {
    const [{ n }] = (await db.query<{ n: number }>(`select count(distinct country_code)::int n from venues`)) as [{ n: number }];
    expect(n).toBe(8);
    const viewer = await db.createUser();
    await db.query(`insert into profiles (id, display_name) values ($1, 'viewer')`, [viewer]);
    const rows = await db.asUser(viewer, (tx) =>
      tx.query<{ title: string; lat: number | null }>(`select * from public.nearby_games(51.5541, -0.0262, 10, '{}')`));
    expect(rows.rows.map((r) => r.title)).toContain("Sunday league kickabout");
    const tlv = await db.asUser(viewer, (tx) =>
      tx.query<{ title: string; lat: number | null; women_only: boolean }>(`select * from public.nearby_games(32.09, 34.79, 5, '{}')`));
    const hidden = tlv.rows.find((r) => r.women_only);
    expect(hidden?.lat).toBeNull(); // hidden exact location until approval
  });

  it("has recurring series in Tel Aviv and London with a 4-week horizon at local wall-clock time", async () => {
    const rows = await db.query<{ tz: string; n: number; local: string[]; auto: number }>(
      `select s.time_zone tz, count(o.*)::int n,
              array_agg(distinct to_char(o.starts_at at time zone s.time_zone, 'HH24:MI')) local,
              (select count(*)::int from series_auto_joins aj where aj.series_id = s.id) auto
       from game_series s join series_occurrences o on o.series_id = s.id
       group by s.id, s.time_zone order by s.time_zone`);
    expect(rows.map((r) => r.tz)).toEqual(["Asia/Jerusalem", "Europe/London"]);
    for (const r of rows) {
      expect(r.n).toBeGreaterThanOrEqual(4);
      expect(r.n).toBeLessThanOrEqual(5);
      expect(r.auto).toBeGreaterThanOrEqual(3); // the "always in" regular in every occurrence before T−48h
    }
    expect(rows.map((r) => r.local)).toEqual([["20:00"], ["19:30"]]);
  });
});
