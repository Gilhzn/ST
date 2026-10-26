import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_TRUST_CONFIG } from "@st/domain";
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
