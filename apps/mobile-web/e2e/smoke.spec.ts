/**
 * Smoke: the static web export boots, renders content and logs no errors.
 * Expanded in M4a with the critical flows listed in docs/qa-strategy.md (E2E-01 .. E2E-12).
 */
import { expect, test, type ConsoleMessage } from "@playwright/test";

/** Console noise that is not an app defect. Keep this list short and justified. */
const IGNORED_CONSOLE: RegExp[] = [
  // Chromium logs a 404 for /favicon.ico on some static servers; not app code.
  /favicon\.ico/i,
];

function trackErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = `${msg.text()} ${msg.location().url ?? ""}`;
    if (!IGNORED_CONSOLE.some((re) => re.test(text))) errors.push(`console.error: ${text}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (!IGNORED_CONSOLE.some((re) => re.test(url))) errors.push(`requestfailed: ${url} ${req.failure()?.errorText ?? ""}`);
  });
  return errors;
}

test.describe("SMK-01 app boot", () => {
  test("loads / and renders without console errors", async ({ page }) => {
    const errors = trackErrors(page);
    const response = await page.goto("/", { waitUntil: "load" });
    expect(response?.ok(), "index.html should be served with 2xx").toBe(true);

    // Expo web mounts into #root; wait until React has rendered something visible.
    const root = page.locator("#root");
    await expect(root).toBeAttached();
    await expect.poll(async () => (await root.innerText()).trim().length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page).toHaveTitle(/.+/);

    // Let late effects (fonts, lazy chunks) settle before asserting on errors.
    await page.waitForLoadState("networkidle");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("deep link to an unknown route is handled by the SPA (no blank page)", async ({ page }) => {
    const errors = trackErrors(page);
    const response = await page.goto("/this-route-does-not-exist", { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);
    await expect.poll(async () => (await page.locator("#root").innerText()).trim().length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(errors.filter((e) => e.startsWith("pageerror")), errors.join("\n")).toEqual([]);
  });
});

test.describe("SMK-02 locale direction", () => {
  test("he-IL renders with dir=rtl on <html>", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "rtl-he", "RTL project only");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", /^he/);
  });
});
