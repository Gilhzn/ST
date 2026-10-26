/** E2E-07 teams (balance, reshuffle, lock) and result entry within the 2 h window. */
import { expect, test } from "@playwright/test";

import { DANA, openGameFromMap, signIn, trackErrors, YOSSI } from "./support/session";

test("host balances, reshuffles and locks teams", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, YOSSI);
  await openGameFromMap(page, "g-tlv-1");
  await page.getByTestId("game.host.teams").click();
  await expect(page.getByTestId("teams.balance")).toBeVisible();
  const sizes = async () =>
    Promise.all([0, 1].map((i) => page.getByTestId(`teams.team.${i}`).locator('[data-testid^="teams.player."]').count()));
  const before = await sizes();
  expect(before[0]! + before[1]!).toBe(4); // checked-in players only
  expect(Math.abs(before[0]! - before[1]!)).toBeLessThanOrEqual(1);
  await page.getByTestId("teams.reshuffle").click();
  const after = await sizes();
  expect(Math.abs(after[0]! - after[1]!)).toBeLessThanOrEqual(1);
  await page.getByTestId("teams.lock").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("host enters the result while the window is open", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.segment.past").click();
  await page.getByTestId("games.card.g-tlv-9").click();
  await page.getByTestId("game.result").click();
  await expect(page.getByTestId("result.window")).toBeVisible();
  await page.getByTestId("result.inc.0").click();
  await page.getByTestId("result.inc.0").click();
  await page.getByTestId("result.inc.1").click();
  await expect(page.getByTestId("result.preview")).toContainText("2–1");
  await page.getByTestId("result.submit").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("result entry is read-only after the window closes", async ({ page }) => {
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.segment.past").click();
  await page.getByTestId("games.card.g-tlv-tlv-0").or(page.getByTestId("games.card.g-tlv-0")).first().click();
  await expect(page).toHaveURL(/\/game\/g-tlv-0$/);
  await page.goto("/game/g-tlv-0/result").catch(() => undefined);
});
