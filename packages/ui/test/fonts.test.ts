import { describe, expect, it } from "vitest";

import {
  detectScript,
  fontFamilyForLocale,
  fontStacks,
  googleFontsCssUrl,
  isRtlLocale,
  localeNativeNames,
  requiredFontPackages,
  scriptForLocale,
  supportedLocales,
  typeStyleFor,
} from "../src/fonts";

describe("scriptForLocale / fontFamilyForLocale", () => {
  it.each([
    ["en", "NotoSans_400Regular"],
    ["en-US", "NotoSans_400Regular"],
    ["es", "NotoSans_400Regular"],
    ["pt-BR", "NotoSans_400Regular"],
    ["ru", "NotoSans_400Regular"],
    ["fr", "NotoSans_400Regular"],
    ["it", "NotoSans_400Regular"],
    ["de", "NotoSans_400Regular"],
    ["he", "NotoSansHebrew_400Regular"],
    ["he-IL", "NotoSansHebrew_400Regular"],
    ["iw", "NotoSansHebrew_400Regular"],
    ["ar", "NotoSansArabic_400Regular"],
    ["ar-EG", "NotoSansArabic_400Regular"],
    ["hi", "NotoSansDevanagari_400Regular"],
    ["hi_IN", "NotoSansDevanagari_400Regular"],
    ["ja", "NotoSansJP_400Regular"],
    ["zh-Hans", "NotoSansSC_400Regular"],
    ["zh-CN", "NotoSansSC_400Regular"],
    ["zh", "NotoSansSC_400Regular"],
    ["zh-Hant", "NotoSansTC_400Regular"],
    ["zh-TW", "NotoSansTC_400Regular"],
    ["zh-HK", "NotoSansTC_400Regular"],
    ["zh-Hant-HK", "NotoSansTC_400Regular"],
  ])("%s → %s", (locale, family) => {
    expect(fontFamilyForLocale(locale)).toBe(family);
  });

  it("returns the weight-specific native family", () => {
    expect(fontFamilyForLocale("ar", { weight: "bold" })).toBe("NotoSansArabic_700Bold");
    expect(fontFamilyForLocale("he", { weight: "semibold" })).toBe("NotoSansHebrew_600SemiBold");
  });

  it("returns CSS stacks on web with the right primary family", () => {
    expect(fontFamilyForLocale("he", { platform: "web" }).startsWith('"Noto Sans Hebrew"')).toBe(true);
    expect(fontFamilyForLocale("ar", { platform: "web" }).startsWith('"Noto Sans Arabic"')).toBe(true);
    expect(fontFamilyForLocale("hi", { platform: "web" }).startsWith('"Noto Sans Devanagari"')).toBe(true);
    // CJK: Latin first, then the region-correct Han font (Han unification)
    expect(fontFamilyForLocale("ja", { platform: "web" })).toMatch(/^"Noto Sans", "Noto Sans JP"/);
    expect(fontFamilyForLocale("zh-Hant", { platform: "web" })).toContain('"Noto Sans TC"');
    for (const s of Object.values(fontStacks)) expect(s.web.endsWith("sans-serif")).toBe(true);
  });

  it("falls back to Latin for unknown/empty locales", () => {
    expect(scriptForLocale(undefined)).toBe("latin");
    expect(scriptForLocale("")).toBe("latin");
    expect(scriptForLocale("xx")).toBe("latin");
  });

  it("flags RTL locales", () => {
    expect(isRtlLocale("he")).toBe(true);
    expect(isRtlLocale("ar-SA")).toBe(true);
    expect(isRtlLocale("en")).toBe(false);
    expect(isRtlLocale("hi")).toBe(false);
  });

  it("has a native name for each of the 13 locale folders", () => {
    expect(supportedLocales).toHaveLength(13);
    for (const l of supportedLocales) expect(localeNativeNames[l]).toBeTruthy();
  });

  it("lists font packages and a Google Fonts URL", () => {
    expect(requiredFontPackages()).toContain("@expo-google-fonts/noto-sans-arabic");
    expect(googleFontsCssUrl(["latin", "hebrew"])).toBe(
      "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&family=Noto+Sans+Hebrew:wght@400;500;600;700&display=swap",
    );
  });
});

describe("typeStyleFor (per-script adjustments)", () => {
  it("raises line-height for Arabic and Devanagari", () => {
    const latin = typeStyleFor("body", "latin");
    expect(typeStyleFor("body", "arabic").lineHeight).toBeGreaterThan(latin.lineHeight);
    expect(typeStyleFor("body", "devanagari").lineHeight).toBeGreaterThan(latin.lineHeight);
    expect(latin.lineHeight).toBe(24);
  });

  it("never letter-spaces or uppercases caseless/cursive scripts", () => {
    for (const s of ["arabic", "devanagari", "hebrew", "sc", "tc", "jp"] as const) {
      const o = typeStyleFor("overline", s);
      expect(o.letterSpacing).toBe(0);
      expect(o.uppercase).toBe(false);
    }
    expect(typeStyleFor("overline", "latin").uppercase).toBe(true);
  });

  it("enforces a minimum size for Arabic/Devanagari captions", () => {
    expect(typeStyleFor("caption", "arabic").fontSize).toBe(13);
    expect(typeStyleFor("caption", "latin").fontSize).toBe(12);
  });

  it("keeps Android font padding for tall-mark scripts", () => {
    expect(typeStyleFor("body", "arabic").includeFontPadding).toBe(true);
    expect(typeStyleFor("body", "latin").includeFontPadding).toBe(false);
  });
});

describe("detectScript", () => {
  it.each([
    ["שלום", "hebrew"],
    ["مرحبا", "arabic"],
    ["नमस्ते", "devanagari"],
    ["こんにちは", "jp"],
    ["你好", "sc"],
    ["Hello", null],
    ["12:30 👍", null],
  ])("%s → %s", (text, script) => {
    expect(detectScript(text)).toBe(script);
  });

  it("uses the locale hint for Han-only text", () => {
    expect(detectScript("東京", "ja")).toBe("jp");
    expect(detectScript("臺灣", "zh-TW")).toBe("tc");
  });
});
