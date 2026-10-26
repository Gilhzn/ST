/**
 * Phase 1.5 network (NET-*): the Players section reached from Profile (the app keeps 4 tabs),
 * people you played with, friend requests (only to people you played with), the "who sees my
 * upcoming games" setting, and the "Friends are playing" cards on the Games tab.
 */
import { expect, test } from "@playwright/test";

import { DANA, signIn, trackErrors } from "./support/session";

test("players: add someone you played with, accept a request, cancel a sent one", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.profile").click();
  await page.getByTestId("profile.players").click();
  await expect(page.getByTestId("players.friends")).toBeVisible();
  await expect(page.getByTestId("players.person.u-tlv-0")).toBeVisible();

  await page.getByTestId("players.tab.played").click();
  await expect(page.getByTestId("players.played")).toBeVisible();
  await page.getByTestId("players.add.u-tlv-5").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(page.getByTestId("players.add.u-tlv-5")).toHaveCount(0);

  await page.getByTestId("players.tab.requests").click();
  await page.getByTestId("players.accept.u-tlv-3").click();
  await expect(page.getByTestId("players.accept.u-tlv-3")).toHaveCount(0);
  await page.getByTestId("players.cancel.u-tlv-4").click();
  await expect(page.getByTestId("players.cancel.u-tlv-4")).toHaveCount(0);

  await page.getByTestId("players.tab.friends").click();
  await expect(page.getByTestId("players.person.u-tlv-3")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("players: hide upcoming games from friends", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.profile").click();
  await page.getByTestId("profile.players").click();
  await expect(page.getByTestId("players.privacy")).toBeVisible();
  await page.getByTestId("players.privacy.nobody").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(page.getByTestId("players.privacy.nobody")).toHaveAttribute("aria-checked", "true");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the Games tab shows regular games and what friends are playing", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.games").click();
  await expect(page.getByTestId("games.series")).toBeVisible();
  await expect(page.getByTestId("games.friends")).toBeVisible();
  const cards = page.locator('[data-testid^="games.friends."]');
  expect(await cards.count()).toBeGreaterThan(0);
  await cards.first().click();
  await expect(page).toHaveURL(/\/game\//);
  expect(errors, errors.join("\n")).toEqual([]);
});
