/**
 * E2E-06 QR check-in (manual code path, works on web without a camera):
 * the host shows the rotating code, a player enters it and is verified;
 * a wrong code is rejected with gentle copy and fallbacks.
 */
import { expect, test } from "@playwright/test";

import { DANA, openGameFromMap, signIn, signOut, textOf, trackErrors, YOSSI } from "./support/session";

test("host QR code checks a player in; a wrong code is rejected", async ({ page }) => {
  const errors = trackErrors(page);

  // Host: show the rotating QR for the game starting soon.
  await signIn(page, YOSSI);
  await openGameFromMap(page, "g-tlv-1");
  await page.getByTestId("game.host.qr").click();
  await expect(page.getByTestId("checkin.qr.show")).toBeVisible();
  await expect(page.getByTestId("checkin.qr.counter")).toBeVisible();
  await expect.poll(() => textOf(page, "checkin.qr.code")).toMatch(/^\d+\.[0-9a-f]{32}$/);
  const token = await textOf(page, "checkin.qr.code");

  // Player: same in-memory backend, different account.
  await signOut(page);
  await signIn(page, DANA, true);
  await openGameFromMap(page, "g-tlv-1");
  await page.getByTestId("game.checkin").click();
  await expect(page.getByTestId("checkin.gps")).toBeVisible();
  await page.getByTestId("checkin.qr.enter").click();

  await page.getByTestId("checkin.qr.input").fill("123.deadbeef");
  await page.getByTestId("checkin.qr.submit").click();
  await expect(page.getByTestId("checkin.reject.invalid_qr")).toBeVisible();

  await page.getByTestId("checkin.qr.input").fill(token);
  await page.getByTestId("checkin.qr.submit").click();
  await expect(page.getByTestId("checkin.status")).toBeVisible();
  await expect(page.getByTestId("checkin.confirmTeammates")).toBeVisible();

  expect(errors, errors.join("\n")).toEqual([]);
});
