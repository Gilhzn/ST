/**
 * Shared steps for the phase-B specs. The InMemoryAdapter lives in the page, so
 * switching users must happen in-app (sign out → sign in) without reloading.
 */
import { expect, type Page } from "@playwright/test";

export const DANA = { country: "IL", national: "500000001" }; // player in g-tlv-1, host of g-tlv-9
export const YOSSI = { country: "IL", national: "500000002" }; // host of g-tlv-1

const ISOLATES = /[⁦-⁩]/g;

export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon\.ico/i.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Signs in from the phone screen; loads the app first unless `inApp`. */
export async function signIn(page: Page, who: { country: string; national: string }, inApp = false) {
  if (!inApp) await page.goto("/");
  await expect(page.getByTestId("auth.phone.input")).toBeVisible();
  await page.getByTestId("auth.phone.country").selectOption(who.country);
  await page.getByTestId("auth.phone.input").fill(who.national);
  await page.getByTestId("auth.phone.submit").click();
  await expect(page.getByTestId("auth.otp.input")).toBeVisible();
  await page.getByTestId("auth.otp.input").fill("123456");
  await expect(page).toHaveURL(/\/map$/);
}

/** Pops pushed screens (game details, check-in, …) until the tab bar is reachable. */
export async function backToTabs(page: Page) {
  const tab = page.getByTestId("nav.tab.profile");
  for (let i = 0; i < 5 && !(await tab.isVisible()); i++) {
    await page.getByTestId("nav.back").filter({ visible: true }).last().click();
  }
  await expect(tab).toBeVisible();
}

export async function signOut(page: Page) {
  await backToTabs(page);
  await page.getByTestId("nav.tab.profile").click();
  await page.getByTestId("profile.settings").click();
  await page.getByTestId("settings.signOut").click();
  await page.getByTestId("settings.signOut.dialog.confirm").click();
  await expect(page.getByTestId("auth.phone.input")).toBeVisible();
}

/** Opens a game from the map list (phones collapse the list into a sheet). */
export async function openGameFromMap(page: Page, gameId: string) {
  const toggle = page.getByTestId("map.list.toggle");
  if (await toggle.isVisible()) await toggle.click();
  await page.getByTestId(`map.card.${gameId}`).click();
  await expect(page).toHaveURL(new RegExp(`/game/${gameId}$`));
}

export async function textOf(page: Page, testId: string): Promise<string> {
  return ((await page.getByTestId(testId).innerText()) ?? "").replace(ISOLATES, "").trim();
}
