/**
 * Phase 1.5 recurring games (GAME-010/011) and the WhatsApp migration (PRD §5.4): the host's
 * series screen (dates, skip, edit, roster), an invited player accepting the regulars, the
 * regulars-first window on an occurrence, the wizard's "Repeats weekly" path, and the series
 * invite landing ("Join the regulars") through sign-up.
 */
import { expect, test } from "@playwright/test";

import { backToTabs, DANA, signIn, textOf, trackErrors } from "./support/session";

test("host sees the series, skips a date and edits the following ones", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.series.s-tlv-weekly").click();
  await expect(page.getByTestId("screen.series")).toBeVisible();
  await expect(page.getByTestId("series.facts")).toBeVisible();
  await expect(page.getByTestId("series.migration.joined")).toContainText("12");
  await expect(page.getByTestId("series.roster.u-tlv-0")).toBeVisible();
  await expect(page.getByTestId("series.roster.u-tlv-0.alwaysIn")).toBeVisible();

  // Skip the next date: everyone is told, the row turns into a skipped one.
  await page.getByTestId("series.occurrence.0.skip").click();
  await page.getByTestId("series.skipDialog.confirm").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(page.getByTestId("series.occurrence.0.skip")).toHaveCount(0);

  // Edit this and following dates: one more spot.
  await page.getByTestId("series.occurrence.1.edit").click();
  await expect(page.getByTestId("series.edit")).toBeVisible();
  await page.getByTestId("series.edit.scope.following").click();
  const before = Number(await textOf(page, "series.edit.capacity.value"));
  await page.getByTestId("series.edit.capacity.inc").click();
  await expect.poll(() => textOf(page, "series.edit.capacity.value")).toBe(String(before + 1));
  await page.getByTestId("series.edit.save").click();
  await expect(page.getByTestId("series.edit")).toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("host opens the WhatsApp invite with a message preview, link and QR", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.series.s-tlv-weekly").click();
  await page.getByTestId("series.invite").click();
  await expect(page.getByTestId("invite.preview")).toBeVisible();
  await expect(page.getByTestId("invite.preview")).toContainText("/invite/series/tlv-weekly-football-regulars");
  await expect(page.getByTestId("invite.whatsapp")).toBeVisible();
  await page.getByTestId("invite.qr").click();
  await expect(page.getByTestId("invite.qr.code")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("an invited player sees the regulars-first window and joins the regulars", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.series.s-lon-5s").click();
  await expect(page.getByTestId("series.invited")).toBeVisible();

  // The next date is still regulars-only: the game shows the series chip and the priority banner.
  await page.getByTestId("series.occurrence.0.open").click();
  await expect(page.getByTestId("game.series.chip")).toBeVisible();
  await expect(page.getByTestId("game.priority.banner")).toBeVisible();
  await page.getByTestId("nav.back").filter({ visible: true }).last().click();

  await page.getByTestId("series.accept").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(page.getByTestId("series.alwaysIn")).toBeVisible();
  await expect(page.getByTestId("series.invited")).toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the wizard creates a weekly series with a regulars-first window", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await backToTabs(page);
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.create").click();
  await expect(page.getByTestId("game.create.step")).toBeVisible();
  await page.getByTestId("game.create.sport.football").click();
  await page.getByTestId("game.create.next").click();
  await page.locator('[data-testid^="game.create.venue."]').first().click();
  await page.getByTestId("game.create.next").click();
  await page.getByTestId("game.create.repeat.weekly").click();
  await expect(page.getByTestId("game.create.repeat.summary")).toBeVisible();
  await expect(page.getByTestId("game.create.priority")).toBeVisible();
  for (let i = 0; i < 3; i++) await page.getByTestId("game.create.next").click();
  await expect(page.getByTestId("game.create.review")).toBeVisible();
  await page.getByTestId("game.create.publish").click();
  await expect(page.getByTestId("game.create.series.card")).toBeVisible();
  await page.getByTestId("game.create.view").click();
  await expect(page.getByTestId("screen.series")).toBeVisible();
  await expect(page.getByTestId("series.occurrence.0")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the series invite landing adds a new player to the regulars after sign-up", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/invite/series/tlv-weekly-football-regulars");
  await expect(page.getByTestId("screen.invite.series")).toBeVisible();
  await page.getByTestId("invite.series.signup").click();
  await expect(page.getByTestId("auth.phone.input")).toBeVisible();
  await page.getByTestId("auth.phone.input").fill(`201555${String(Date.now()).slice(-4)}`);
  await page.getByTestId("auth.phone.submit").click();
  await page.getByTestId("auth.otp.input").fill("123456");
  await expect(page).toHaveURL(/\/age-gate$/);
  await page.getByTestId("auth.age.month").selectOption("5");
  await page.getByTestId("auth.age.year").selectOption(String(new Date().getFullYear() - 25));
  await page.getByTestId("auth.age.submit").click();
  await page.getByTestId("auth.onboarding.name").fill("Alex Runner");
  await page.getByTestId("auth.onboarding.sport.football").click();
  await page.getByTestId("auth.onboarding.submit").click();
  await expect(page.getByTestId("screen.series")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("series.alwaysIn")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});
