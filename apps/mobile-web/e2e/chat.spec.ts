/** E2E-08 chat: send, client nudge + send anyway, server block keeps the text, translate. */
import { expect, test } from "@playwright/test";

import { DANA, openGameFromMap, signIn, trackErrors } from "./support/session";

test("chat send, nudge, block and translate", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await openGameFromMap(page, "g-tlv-1");
  await page.getByTestId("game.chat").click();
  await expect(page.getByTestId("chat.list")).toBeVisible();
  await expect(page.getByTestId("chat.infoChip")).toBeVisible();

  const input = page.getByTestId("chat.input");
  await input.fill("Bringing the cones");
  await page.getByTestId("chat.send").click();
  await expect(page.locator('[data-testid$=".body"]', { hasText: "Bringing the cones" })).toBeVisible();
  await expect(input).toHaveValue("");

  // Client blocklist hit: nudge card before sending, then send anyway.
  await input.fill("ref was an idiot today");
  await page.getByTestId("chat.send").click();
  await expect(page.getByTestId("chat.nudge")).toBeVisible();
  await page.getByTestId("chat.nudge.sendAnyway").click();
  await expect(page.locator('[data-testid$=".body"]', { hasText: "ref was an idiot today" })).toBeVisible();
  await expect(page.getByTestId("chat.nudge.server")).toBeVisible();

  // Server block: nothing is sent, the text stays for editing.
  await input.fill("I will kill you");
  await page.getByTestId("chat.send").click();
  await expect(page.getByTestId("chat.block")).toBeVisible();
  await expect(input).toHaveValue("I will kill you");
  await expect(page.locator('[data-testid$=".body"]', { hasText: "I will kill you" })).toHaveCount(0);

  // Translate a seeded Arabic message (differs from the en and he UIs).
  await page.getByTestId("chat.message.m-seed-3.translate").click();
  await expect(page.getByTestId("chat.message.m-seed-3.translated")).toBeVisible();

  // Report flow is reachable from the message options.
  await page.getByTestId("chat.message.m-seed-3.options").click();
  await page.getByTestId("chat.message.m-seed-3.report").click();
  await page.getByTestId("chat.report.category.harassment").click();
  await page.getByTestId("chat.report.confirm").click();
  await expect(page.getByTestId("chat.blockDialog")).toBeVisible();
  await page.getByTestId("chat.blockDialog.cancel").click();

  expect(errors, errors.join("\n")).toEqual([]);
});
