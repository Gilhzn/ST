import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
