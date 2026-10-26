/**
 * App shell: phone OTP → age gate → onboarding → map → game details, plus the
 * returning-host path. Runs against the static export with the InMemoryAdapter
 * (EXPO_PUBLIC_DATA=mock, OTP 123456) and the bundled blank map style.
 * Selectors are test ids only (copy is localized).
 */
import { expect, test, type Page } from "@playwright/test";

const DEMO_HOST = { country: "IL", national: "500000001" }; // seeded "Dana Levi", hosts g-tlv-6

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon\.ico/i.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function signIn(page: Page, phone: { country?: string; national: string }) {
  await page.goto("/");
  await expect(page.getByTestId("auth.phone.input")).toBeVisible();
  if (phone.country) await page.getByTestId("auth.phone.country").selectOption(phone.country);
  await page.getByTestId("auth.phone.input").fill(phone.national);
  await page.getByTestId("auth.phone.submit").click();
  await expect(page.getByTestId("auth.otp.input")).toBeVisible();
  await page.getByTestId("auth.otp.input").fill("123456"); // auto-submits at 6 digits
}

async function openListIfCollapsed(page: Page) {
  const toggle = page.getByTestId("map.list.toggle");
  if (await toggle.isVisible()) await toggle.click();
}

test.describe("APP-01 sign-up to map to game", () => {
  test("new player: OTP → age gate → onboarding → map → game details → request to join", async ({ page }) => {
    const errors = trackErrors(page);
    await signIn(page, { national: "201555" + String(Date.now()).slice(-4) });

    await expect(page).toHaveURL(/\/age-gate$/);
    await page.getByTestId("auth.age.month").selectOption("5");
    await page.getByTestId("auth.age.year").selectOption(String(new Date().getFullYear() - 25));
    await page.getByTestId("auth.age.submit").click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByTestId("auth.onboarding.name").fill("Alex Runner");
    await page.getByTestId("auth.onboarding.sport.football").click();
    await page.getByTestId("auth.onboarding.position.football.midfielder").click();
    await page.getByTestId("auth.onboarding.submit").click();

    // Map with the Tel Aviv fixture (geolocation is Dizengoff Sq.).
    await expect(page).toHaveURL(/\/map$/);
    await expect(page.getByTestId("map.canvas")).toBeVisible();
    await expect(page.locator('[data-testid^="map.pin."], [data-testid^="map.cluster."]').first()).toBeVisible();
    await openListIfCollapsed(page);
    const card = page.getByTestId("map.card.g-tlv-1");
    await expect(card).toBeVisible();
    await card.click();

    await expect(page).toHaveURL(/\/game\/g-tlv-1$/);
    await expect(page.getByTestId("game.title")).toBeVisible();
    await expect(page.getByTestId("game.host")).toBeVisible();
    await page.getByTestId("game.join").click();
    await expect(page.getByTestId("game.status.requested")).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("under 18 is stopped with an explanation", async ({ page }) => {
    await signIn(page, { national: "201666" + String(Date.now()).slice(-4) });
    await expect(page).toHaveURL(/\/age-gate$/);
    await page.getByTestId("auth.age.month").selectOption("12");
    await page.getByTestId("auth.age.year").selectOption(String(new Date().getFullYear() - 17));
    await page.getByTestId("auth.age.submit").click();
    await expect(page.getByTestId("auth.age.blocked")).toBeVisible();
  });
});

test.describe("APP-02 returning host", () => {
  test("lands on the map and approves a join request", async ({ page }) => {
    const errors = trackErrors(page);
    await signIn(page, DEMO_HOST);
    await expect(page).toHaveURL(/\/map$/);

    // In-app navigation (a full reload would restart the in-memory backend).
    await page.getByTestId("nav.tab.games").click();
    await page.getByTestId("games.card.g-tlv-6").click();
    await expect(page).toHaveURL(/\/game\/g-tlv-6$/);
    await expect(page.getByTestId("game.requests")).toBeVisible();
    const approve = page.locator('[data-testid^="game.host.approve."]').first();
    await approve.click();
    await expect(page.getByTestId("toast")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("APP-03 map filters", () => {
  test("allows at most 3 sports and changes the radius", async ({ page }) => {
    await signIn(page, DEMO_HOST);
    await expect(page).toHaveURL(/\/map$/);
    for (const s of ["football", "basketball", "tennis"]) await page.getByTestId(`map.filter.sport.${s}`).click();
    const fourth = page.getByTestId("map.filter.sport.padel");
    await expect(fourth).toHaveAttribute("aria-disabled", "true");
    // A real tap on the disabled chip lands on its wrapper, which explains the limit.
    await page.getByTestId("map.filter.sport.padel.wrap").click();
    await expect(page.getByTestId("toast")).toBeVisible();
    await page.getByTestId("map.filter.radius.10").click();
    await expect(page.getByTestId("map.filter.radius.10")).toHaveAttribute("aria-checked", "true");
  });
});
