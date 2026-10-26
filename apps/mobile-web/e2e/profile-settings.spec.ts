/**
 * Profile, games tab and settings in mock mode (EXPO_PUBLIC_DATA=mock, OTP 123456).
 * Signs in as the seeded returning player "Dana Levi" (+972 500000001: reliability
 * 11 of 12, one active yellow card). Selectors are test ids only (copy is localized).
 * Navigation is in-app on purpose: a full reload would restart the in-memory backend.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

const DEMO_PLAYER = { country: "IL", national: "500000001" };

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
  await expect(page).toHaveURL(/\/map$/);
}

async function openSettings(page: Page) {
  await page.getByTestId("nav.tab.profile").click();
  await expect(page.getByTestId("screen.profile")).toBeVisible();
  await page.getByTestId("profile.settings").click();
  await expect(page.getByTestId("screen.settings")).toBeVisible();
}

const background = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe("PRF-01 profile", () => {
  test("shows the reliability card, counts, sports and sanctions", async ({ page }) => {
    const errors = trackErrors(page);
    await signIn(page, DEMO_PLAYER);
    await page.getByTestId("nav.tab.profile").click();

    await expect(page.getByTestId("profile.name")).toContainText("Dana Levi");
    const card = page.getByTestId("profile.reliability");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("profile.reliability.percent")).toContainText("%");
    await expect(page.getByTestId("profile.reliability.meter")).toHaveAttribute("aria-valuenow", /^\d+$/);
    // Status is a glyph + label, not only a colour (Dana has an active yellow card: "!").
    await expect(card).toContainText(/[✓!✕✦]/);
    await expect(page.getByTestId("profile.reliability.cards")).toBeVisible(); // 1 active yellow card

    await expect(page.getByTestId("profile.stat.played")).toBeVisible();
    await expect(page.getByTestId("profile.stat.verified")).toContainText("11");
    await expect(page.getByTestId("profile.stat.noShows")).toBeVisible();

    await expect(page.getByTestId("profile.sport.football")).toBeVisible();
    await expect(page.getByTestId("profile.sport.running")).toBeVisible();

    // "How this works" expands inline.
    await page.getByTestId("profile.reliability.how").click();
    await expect(page.getByTestId("profile.reliability.explain")).toBeVisible();

    // Active sanctions link to the statement of reasons.
    const sanction = page.getByTestId("profile.sanction.sanction-demo-1");
    await expect(sanction).toBeVisible();
    await sanction.click();
    await expect(page).toHaveURL(/\/sanctions\/sanction-demo-1$/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("edits name, bio and sports", async ({ page }) => {
    await signIn(page, DEMO_PLAYER);
    await page.getByTestId("nav.tab.profile").click();
    await page.getByTestId("profile.edit").click();
    await expect(page.getByTestId("screen.profile.edit")).toBeVisible();

    await page.getByTestId("profile.edit.name").fill("Dana L.");
    await page.getByTestId("profile.edit.bio").fill("Weekend striker");
    await page.getByTestId("profile.edit.sport.tennis").click();
    await page.getByTestId("profile.edit.skill.tennis.4").click();
    await page.getByTestId("profile.edit.save").click();

    await expect(page.getByTestId("screen.profile")).toBeVisible();
    await expect(page.getByTestId("profile.name")).toContainText("Dana L.");
    await expect(page.getByTestId("profile.bio")).toContainText("Weekend striker");
    await expect(page.getByTestId("profile.sport.tennis")).toBeVisible();
  });

  test("rejects an empty name", async ({ page }) => {
    await signIn(page, DEMO_PLAYER);
    await page.getByTestId("nav.tab.profile").click();
    await page.getByTestId("profile.edit").click();
    await page.getByTestId("profile.edit.name").fill("");
    await page.getByTestId("profile.edit.save").click();
    await expect(page.getByTestId("screen.profile.edit")).toBeVisible();
    await expect(page.getByTestId("profile.edit.name")).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("PRF-02 games tab", () => {
  test("switches between upcoming, hosting and past", async ({ page }) => {
    await signIn(page, DEMO_PLAYER);
    await page.getByTestId("nav.tab.games").click();
    await expect(page.getByTestId("screen.games")).toBeVisible();
    await expect(page.getByTestId("games.segment.upcoming")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-testid^="games.card."]').first()).toBeVisible();

    await page.getByTestId("games.segment.hosting").click();
    await expect(page.getByTestId("games.segment.hosting")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("games.segment.upcoming")).toHaveAttribute("aria-checked", "false");

    await page.getByTestId("games.segment.past").click();
    await expect(page.getByTestId("games.segment.past")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("games.refresh").click(); // web stand-in for pull-to-refresh
    await expect(page.getByTestId("screen.games")).toBeVisible();
  });
});

test.describe("PRF-03 settings", () => {
  test("language switch to Hebrew sets dir=rtl, then back to English", async ({ page }) => {
    const errors = trackErrors(page);
    await signIn(page, DEMO_PLAYER);
    await openSettings(page);

    await page.getByTestId("settings.language.open").click();
    await expect(page.getByTestId("settings.language")).toBeVisible();
    await page.getByTestId("settings.language.en").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

    await page.getByTestId("settings.language.he").click();
    await expect(page.locator("html[dir=rtl]")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.getByTestId("settings.language.he")).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("settings.language.en").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("theme switch changes the palette and is remembered in the control", async ({ page }) => {
    await signIn(page, DEMO_PLAYER);
    await openSettings(page);
    await page.getByTestId("settings.theme.light").click();
    await expect(page.getByTestId("settings.theme.light")).toHaveAttribute("aria-checked", "true");
    const light = await background(page, "screen.settings");

    await page.getByTestId("settings.theme.dark").click();
    await expect(page.getByTestId("settings.theme.dark")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("settings.theme.light")).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => background(page, "screen.settings")).not.toBe(light);

    await page.getByTestId("settings.theme.system").click();
    await expect(page.getByTestId("settings.theme.system")).toHaveAttribute("aria-checked", "true");
  });

  test("notification switches toggle and safety notices stay on", async ({ page }) => {
    await signIn(page, DEMO_PLAYER);
    await openSettings(page);
    await page.getByTestId("settings.notifications.open").click();
    const chat = page.getByTestId("settings.notifications.chat");
    await expect(chat).toHaveAttribute("aria-checked", "true");
    await chat.click();
    await expect(chat).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("settings.notifications.safety")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("settings.notifications.safety")).toHaveAttribute("aria-disabled", "true");
  });

  test("privacy shows the location explanation and an empty blocked list", async ({ page }) => {
    await signIn(page, DEMO_PLAYER);
    await openSettings(page);
    await page.getByTestId("settings.privacy.open").click();
    await expect(page.getByTestId("settings.privacy.location")).toBeVisible();
    await expect(page.getByTestId("settings.blocked.empty")).toBeVisible();
  });

  test("sign out asks first, then returns to the phone screen", async ({ page }) => {
    await signIn(page, DEMO_PLAYER);
    await openSettings(page);
    await page.getByTestId("settings.signOut").click();
    await page.getByTestId("settings.signOut.dialog.cancel").click();
    await expect(page.getByTestId("screen.settings")).toBeVisible();
    await page.getByTestId("settings.signOut").click();
    await page.getByTestId("settings.signOut.dialog.confirm").click();
    await expect(page.getByTestId("auth.phone.input")).toBeVisible();
  });

  test("screens have no serious accessibility violations", async ({ page }) => {
    await signIn(page, DEMO_PLAYER);
    await page.getByTestId("nav.tab.profile").click();
    await expect(page.getByTestId("profile.reliability")).toBeVisible();
    const scan = async (testId: string) => {
      const res = await new AxeBuilder({ page: page as unknown as AxePage }).include(`[data-testid="${testId}"]`).withTags(["wcag2a", "wcag2aa"]).analyze();
      return res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${testId}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
    };
    const found = [...(await scan("screen.profile"))];
    await page.getByTestId("profile.settings").click();
    await expect(page.getByTestId("screen.settings")).toBeVisible();
    found.push(...(await scan("screen.settings")));
    expect(found, found.join("\n")).toEqual([]);
  });
});

test.describe("PRF-04 delete account", () => {
  test("two-step confirmation, then back on the phone screen", async ({ page }) => {
    const errors = trackErrors(page);
    await signIn(page, DEMO_PLAYER);
    await openSettings(page);
    await page.getByTestId("settings.delete.open").click();

    // Step 1: what is deleted and what is kept.
    await expect(page.getByTestId("settings.delete.review")).toBeVisible();
    await expect(page.getByTestId("settings.delete.deleted")).toBeVisible();
    await expect(page.getByTestId("settings.delete.kept")).toBeVisible();
    await page.getByTestId("settings.delete.continue").click();

    // Step 2: nothing happens until the confirm word is typed.
    const submit = page.getByTestId("settings.delete.submit");
    await expect(submit).toBeDisabled();
    await page.getByTestId("settings.delete.input").fill("delet");
    await expect(submit).toBeDisabled();
    await page.getByTestId("settings.delete.input").fill("DELETE");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByTestId("auth.phone.input")).toBeVisible();
    await expect(page).toHaveURL(/\/phone$/);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
