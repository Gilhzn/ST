/**
 * Phase 1.5 Media Vault (VAULT-*): the game gallery with its upload window, uploading a photo
 * (web file picker), the consent rule for the venue vault (public only once every tag is
 * accepted), tag requests in the inbox, reporting, and the venue sheet's Photos tab.
 */
import { expect, test, type Page } from "@playwright/test";

import { DANA, signIn, trackErrors } from "./support/session";

// 1×1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

async function openLunchtimeGallery(page: Page) {
  await page.getByTestId("nav.tab.games").click();
  await page.getByTestId("games.segment.past").click();
  await page.getByTestId("games.card.g-tlv-9").click();
  await page.getByTestId("game.after.gallery").click();
  await expect(page.getByTestId("gallery.grid")).toBeVisible();
}

test("a checked-in player uploads a photo while the gallery is open", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await openLunchtimeGallery(page);
  await expect(page.getByTestId("gallery.countdown")).toBeVisible();
  const items = page.locator('[data-testid^="gallery.item."]');
  await expect(items).toHaveCount(6);
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("gallery.upload").click();
  await (await chooser).setFiles({ name: "goal.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(items).toHaveCount(7);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a photo stays players-only until everyone tagged accepts", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await openLunchtimeGallery(page);
  // The newest photo is Dana's own, with one tag still pending.
  await page.getByTestId("gallery.item.0").click();
  await expect(page.getByTestId("gallery.viewer")).toBeVisible();
  await expect(page.getByTestId("gallery.viewer.pending")).toBeVisible();
  await expect(page.getByTestId("gallery.viewer.public.why")).toBeVisible();
  await page.getByTestId("gallery.viewer.close").click();

  // Someone else's photo can be reported once.
  await page.locator('[data-testid^="gallery.item."]').nth(1).click();
  await page.getByTestId("gallery.viewer.report").click();
  await page.getByTestId("gallery.report.reason.privacy").click();
  await page.getByTestId("gallery.report.submit").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("tag requests are accepted or declined from the inbox", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await page.getByTestId("nav.tab.inbox").click();
  await expect(page.getByTestId("inbox.requests")).toBeVisible();
  await page.getByTestId("inbox.request.m-tlv9-1.accept").click();
  await expect(page.getByTestId("inbox.request.m-tlv9-1")).toHaveCount(0);
  await page.getByTestId("inbox.request.m-wk1-1.decline").click();
  await expect(page.getByTestId("inbox.request.m-wk1-1")).toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the venue sheet shows the public vault with a date filter", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, DANA);
  await expect(page.getByTestId("screen.map")).toBeVisible();
  await expect(page.getByTestId("map.sheet.title")).toBeVisible();
  const toggle = page.getByTestId("map.list.toggle");
  if (await toggle.isVisible()) await toggle.click();
  // The list is virtualised: scroll its scroller until the venue section (venues without games) renders.
  const card = page.getByTestId("map.venueCard.v-tlv-clore");
  for (let i = 0; i < 25 && !(await card.isVisible()); i++) {
    await page.getByTestId("screen.map").evaluate((root) => {
      const all = [root, ...Array.from(root.querySelectorAll("*"))] as HTMLElement[];
      for (const el of all) if (el.scrollHeight > el.clientHeight + 4) el.scrollTop += 900;
    });
    await page.waitForTimeout(150);
  }
  await card.click();
  await expect(page.getByTestId("map.venue.sheet")).toBeVisible();
  await page.getByTestId("map.venue.tab.photos").click();
  await expect(page.getByTestId("venue.photos.grid")).toBeVisible();
  const photos = page.locator('[data-testid^="venue.photo."]');
  await expect(photos).toHaveCount(4);
  await page.getByTestId("venue.photos.range.week").click();
  await expect(photos).toHaveCount(4);
  expect(errors, errors.join("\n")).toEqual([]);
});
