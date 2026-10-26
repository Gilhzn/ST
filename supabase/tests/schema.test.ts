import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PHASE15_CONFIG, DEFAULT_TRUST_CONFIG, PLAYER_RATING_ATTRIBUTES, type Phase15NotificationKind } from "@st/domain";
import { createHarness, type Harness } from "./harness";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterAll(async () => {
  await db?.close();
});

describe("schema", () => {
  it("boots all migrations", async () => {
    const [r] = await db.query<{ n: number }>(`select count(*)::int as n from public.sports`);
    expect(r?.n).toBe(6);
  });
});

describe("trust_config ≡ DEFAULT_TRUST_CONFIG (contract v2)", () => {
  it("column defaults equal the TS defaults, key for key", async () => {
    const [r] = await db.query<{ cfg: Record<string, string | number> }>(`select public.trust_config_json() cfg`);
    const sql = Object.fromEntries(Object.entries(r!.cfg).map(([k, v]) => [k, Number(v)]));
    expect(sql).toEqual({ ...DEFAULT_TRUST_CONFIG });
  });

  it("every camelCase key round-trips through st_config_merge (golden overrides)", async () => {
    const overrides = Object.fromEntries(Object.keys(DEFAULT_TRUST_CONFIG).map((k, i) => [k, 1000 + i]));
    // Keep the CHECK constraints satisfiable.
    Object.assign(overrides, { joinBanShortAtCards: 2, joinBanLongAtCards: 3, reviewAtCards: 4, qrAllowedDriftSteps: 1 });
    const [r] = await db.query<{ cfg: Record<string, string | number> }>(
      `select to_jsonb(public.st_config_merge($1::jsonb)) - 'id' - 'updated_at' cfg`, [JSON.stringify(overrides)]);
    const snake = (k: string) => k.replace(/([A-Z]|[0-9]+)/g, "_$1").toLowerCase();
    for (const [k, v] of Object.entries(overrides)) expect(Number(r!.cfg[snake(k)]), k).toBe(v);
  });
});

describe("phase15_config ≡ DEFAULT_PHASE15_CONFIG (contract v3)", () => {
  it("column defaults equal the TS defaults, key for key", async () => {
    const [r] = await db.query<{ cfg: Record<string, string | number> }>(`select public.phase15_config_json() cfg`);
    const sql = Object.fromEntries(Object.entries(r!.cfg).map(([k, v]) => [k, Number(v)]));
    expect(sql).toEqual({ ...DEFAULT_PHASE15_CONFIG });
  });

  it("st_p15_merge applies camelCase overrides", async () => {
    const [r] = await db.query<{ h: number; t: number }>(
      `select (public.st_p15_merge('{"seriesHorizonWeeks": 6, "glickoTau": 0.3, "lateCancelWindowHours": 9}')).series_horizon_weeks h,
              (public.st_p15_merge('{"glickoTau": 0.3}')).glicko_tau t`);
    expect([r!.h, Number(r!.t)]).toEqual([6, 0.3]);
  });
});

describe("contract v3 enums ≡ types.ts unions", () => {
  const enumValues = async (t: string) =>
    (await db.query<{ v: string }>(`select unnest(enum_range(null::public.${t}))::text v`)).map((r) => r.v);
  it("series, roster, media, rating and network enums", async () => {
    expect(await enumValues("series_recurrence")).toEqual(["weekly", "biweekly"]);
    expect(await enumValues("series_status")).toEqual(["active", "paused", "ended"]);
    expect(await enumValues("roster_status")).toEqual(["regular", "invited", "left"]);
    expect(await enumValues("roster_join_source")).toEqual(["invite_link", "host", "played_with"]);
    expect(await enumValues("occurrence_status")).toEqual(["scheduled", "skipped", "cancelled"]);
    expect(await enumValues("media_kind")).toEqual(["photo", "video"]);
    expect(await enumValues("media_status")).toEqual(["processing", "published", "blocked", "removed"]);
    expect(await enumValues("media_visibility")).toEqual(["participants", "venue_public"]);
    expect(await enumValues("media_tag_status")).toEqual(["requested", "accepted", "declined", "removed"]);
    expect(await enumValues("format_family")).toEqual(
      ["small_sided", "full_sided", "half_court", "full_court", "singles", "doubles", "pairs", "teams"]);
    expect(await enumValues("result_verdict")).toEqual(["confirm", "dispute"]);
    expect(await enumValues("friend_status")).toEqual(["requested", "accepted"]);
    expect(await enumValues("upcoming_games_audience")).toEqual(["friends", "nobody"]);
    expect(await enumValues("review_kind")).toContain("media_csam");
  });

  it("every Phase15NotificationKind is a notification_kind value", async () => {
    const kinds: Phase15NotificationKind[] = [
      "roster_added", "series_reconfirm", "series_auto_released", "roster_leave_offer", "occurrence_skipped", "occurrence_updated",
      "occurrence_rescheduled", "peer_rating_open", "friend_request", "friend_accepted", "media_tag_request", "media_blocked",
      "rating_level_changed",
    ];
    const values = await enumValues("notification_kind");
    for (const k of kinds) expect(values, k).toContain(k);
  });

  it("sports.player_rating_attributes ≡ PLAYER_RATING_ATTRIBUTES", async () => {
    const rows = await db.query<{ id: string; a: string[] }>(`select id, player_rating_attributes a from public.sports order by id`);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.a]))).toEqual(
      Object.fromEntries(Object.entries(PLAYER_RATING_ATTRIBUTES).map(([k, v]) => [k, [...v]])));
  });
});
