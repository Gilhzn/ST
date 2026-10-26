/// <reference types="node" />
/**
 * Playwright e2e config for the static web export (`expo export --platform web --output-dir dist`).
 *
 * Build first (with the in-memory data adapter for deterministic flows):
 *   EXPO_PUBLIC_DATA=mock npx expo export --platform web --output-dir dist
 *   npx playwright test                    # all projects
 *   npx playwright test --project=chromium-desktop
 *
 * Env:
 *   E2E_PORT       port for the static server (default 4173)
 *   E2E_BASE_URL   test an already-running server instead of starting one
 *   CI             enables retries, forbids test.only, single worker
 */
import { existsSync } from "node:fs";
import { chromium, defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

/**
 * Use Playwright's managed Chromium when its expected revision is installed; otherwise fall back to
 * the container's preinstalled build (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 environments).
 */
function chromiumExecutable(): string | undefined {
  try {
    const managed = chromium.executablePath();
    if (managed && existsSync(managed)) return undefined; // let Playwright resolve it
  } catch {
    // fall through
  }
  const candidates = [process.env.E2E_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p));
}

const executablePath = chromiumExecutable();
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    // RTL/visual snapshots: tolerate tiny anti-aliasing differences between machines.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  reporter: isCI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // The app must never need real location in e2e; grant a fixed position (Dizengoff Sq, Tel Aviv).
    geolocation: { latitude: 32.0779, longitude: 34.7745, accuracy: 10 },
    permissions: ["geolocation"],
    timezoneId: "Asia/Jerusalem",
    launchOptions,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], locale: "en-US", launchOptions },
    },
    {
      name: "mobile-pixel7",
      use: { ...devices["Pixel 7"], locale: "en-US", launchOptions },
    },
    {
      name: "rtl-he",
      use: { ...devices["Pixel 7"], locale: "he-IL", launchOptions },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // `serve` is preinstalled globally in this container; elsewhere npx fetches it.
        command: `(command -v serve >/dev/null && serve dist -s -l ${PORT} -n) || npx --yes serve dist -s -l ${PORT} -n`,
        url: BASE_URL,
        reuseExistingServer: !isCI,
        timeout: 60_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
