/**
 * Phase 1.5 ratings (RATE-*): the profile level card, peer rating after a game (up to 5
 * co-players, 1–5 stars per attribute), the friendly gate for ineligible raters, result
 * confirmation (GAME-071) with the "not rated" notice, and the host's 1–5 level bands.
 */
import { expect, test } from "@playwright/test";

import { DANA, openGameFromMap, signIn, signOut, trackErrors, YOSSI } from "./support/session";

test("the profile shows the level card with history and the provisional sport", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.profile").click();
  await expect(page.getByTestId("profile.levels")).toBeVisible();
  await expect(page.getByTestId("profile.level.football.value")).toContainText("3.4");
  await expect(page.getByTestId("profile.level.football.history")).toBeVisible();
  await expect(page.getByTestId("profile.level.basketball")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a verified player rates co-players after the game", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, YOSSI);
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.segment.past").click();
  await page.getByTestId("games.card.g-tlv-wk-1").click();
  await expect(page.getByTestId("game.series.chip")).toBeVisible();
  await page.getByTestId("game.after.rate").click();
  await expect(page.getByTestId("screen.game.rate")).toBeVisible();
  await expect(page.getByTestId("rate.submit")).toBeDisabled();
  const picks = page.locator('[data-testid^="rate.pick."]');
  await picks.nth(0).click();
  const id = ((await picks.nth(0).getAttribute("data-testid")) ?? "").replace("rate.pick.", "");
  await page.getByTestId(`rate.${id}.speed.4`).click();
  await page.getByTestId(`rate.${id}.overall.5`).click();
  await page.getByTestId("rate.submit").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(page.getByTestId("screen.game.rate")).toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a player with an active card gets a friendly explanation instead of the form", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.segment.past").click();
  await page.getByTestId("games.card.g-tlv-9").click();
  await page.getByTestId("game.after.rate").click();
  await expect(page.getByTestId("rate.gate")).toBeVisible();
  await expect(page.getByTestId("rate.gate.active_sanction")).toBeVisible();
  await expect(page.getByTestId("rate.submit")).toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("players confirm the score; too few verified players means the game is not rated", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, YOSSI);
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.segment.past").click();
  await page.getByTestId("games.card.g-tlv-wk-1").click();
  await page.getByTestId("game.after.result").click();
  await expect(page.getByTestId("result.confirm")).toBeVisible();
  await page.getByTestId("result.confirm.yes").click();
  await expect(page.getByTestId("result.confirm.mine")).toBeVisible();

  // Dana's futsal had only 5 of 8 verified players: the score saves, but no levels move.
  await signOut(page);
  await signIn(page, DANA, true);
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.segment.past").click();
  await page.getByTestId("games.card.g-tlv-9").click();
  await page.getByTestId("game.after.result").click();
  await page.getByTestId("result.inc.0").click();
  await page.getByTestId("result.submit").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await page.getByTestId("game.after.result").click();
  await expect(page.getByTestId("result.notRated")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the host sees a 1–5 level band next to each player", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, YOSSI);
  await openGameFromMap(page, "g-tlv-1");
  const toggle = page.getByTestId("game.players.toggle");
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(page.getByTestId("game.band.u-dana")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});
