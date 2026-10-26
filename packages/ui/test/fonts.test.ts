import { describe, expect, it } from "vitest";

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  bundledScripts,
  detectScript,
  fontAssetNames,
  fontFamilyForLocale,
  fontFamilyForScript,
  fontGroupPackages,
  fontGroupsForLocale,
  fontStacks,
  googleFontsCssUrl,
  isRtlLocale,
  localeNativeNames,
  requiredFontPackages,
  scriptForLocale,
  supportedLocales,
  typeStyleFor,
} from "../src/fonts";

describe("v2 fonts: Rubik + script fallbacks", () => {
  it.each([
    ["en", "Rubik_400Regular"],
    ["en-US", "Rubik_400Regular"],
    ["es", "Rubik_400Regular"],
    ["pt-BR", "Rubik_400Regular"],
    ["ru", "Rubik_400Regular"],
    ["fr", "Rubik_400Regular"],
    ["it", "Rubik_400Regular"],
    ["de", "Rubik_400Regular"],
    ["he", "Rubik_400Regular"],
    ["he-IL", "Rubik_400Regular"],
    ["iw", "Rubik_400Regular"],
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

  it("returns the weight-specific native family (incl. heavy 800)", () => {
    expect(fontFamilyForLocale("en", { weight: "bold" })).toBe("Rubik_700Bold");
    expect(fontFamilyForLocale("he", { weight: "heavy" })).toBe("Rubik_800ExtraBold");
    expect(fontFamilyForLocale("ar", { weight: "bold" })).toBe("NotoSansArabic_700Bold");
    expect(fontFamilyForLocale("hi", { weight: "semibold" })).toBe("NotoSansDevanagari_600SemiBold");
  });

  it("web stacks start with Rubik, then the script family, and end in system fonts", () => {
    for (const s of Object.values(fontStacks)) {
      expect(s.web.startsWith('"Rubik"')).toBe(true);
      expect(s.web.endsWith("sans-serif")).toBe(true);
    }
    expect(fontFamilyForLocale("ar", { platform: "web" })).toContain('"Noto Sans Arabic"');
    expect(fontFamilyForLocale("ja", { platform: "web" })).toContain('"Noto Sans JP"');
    expect(fontFamilyForLocale("zh-Hant", { platform: "web" })).toContain('"Noto Sans TC"');
  });

  it("registered web stacks lead with the per-weight faces (no synthetic bold)", () => {
    expect(fontFamilyForScript("latin", { platform: "web", weight: "bold", registered: true }).startsWith("Rubik_700Bold, ")).toBe(true);
    expect(fontFamilyForScript("arabic", { platform: "web", weight: "medium", registered: true })).toMatch(
      /^Rubik_500Medium, NotoSansArabic_500Medium, /,
    );
  });

  it("legacy mode keeps the v1 Noto names for apps that still load Noto", () => {
    expect(fontFamilyForScript("latin", { legacy: true })).toBe("NotoSans_400Regular");
    expect(fontFamilyForScript("hebrew", { legacy: true, weight: "bold" })).toBe("NotoSansHebrew_700Bold");
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

  it("lists font packages and a Google Fonts URL with Rubik first", () => {
    expect(requiredFontPackages()).toContain("@expo-google-fonts/rubik");
    expect(requiredFontPackages()).toContain("@expo-google-fonts/noto-sans-arabic");
    expect(googleFontsCssUrl(["latin", "hebrew"])).toBe(
      "https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800&display=swap",
    );
    expect(googleFontsCssUrl(["arabic"])).toContain("family=Noto+Sans+Arabic:wght@");
  });

  it("loads only the groups a locale needs", () => {
    expect(fontGroupsForLocale("en")).toEqual(["rubik"]);
    expect(fontGroupsForLocale("he")).toEqual(["rubik"]);
    expect(fontGroupsForLocale("ar")).toEqual(["rubik", "arabic"]);
    expect(fontGroupsForLocale("hi")).toEqual(["rubik", "devanagari"]);
    expect(fontGroupsForLocale("ja")).toEqual(["rubik"]);
    expect(bundledScripts).toEqual(["latin", "hebrew", "arabic", "devanagari"]);
  });
});

describe("font assets map (fontAssets.ts ↔ fontAssetNames ↔ installed files)", () => {
  const root = fileURLToPath(new URL("../../../node_modules/", import.meta.url));
  const src = readFileSync(fileURLToPath(new URL("../src/fontAssets.ts", import.meta.url)), "utf8");

  it.each(Object.entries(fontAssetNames))("%s: every weight is an installed .ttf and imported by fontAssets.ts", (group, names) => {
    const pkg = fontGroupPackages[group as keyof typeof fontGroupPackages];
    expect(names).toHaveLength(5);
    for (const name of names) {
      const weightDir = name.split("_")[1]!;
      expect(existsSync(`${root}${pkg}/${weightDir}/${name}.ttf`), `${pkg}/${weightDir}/${name}.ttf`).toBe(true);
      expect(src, name).toContain(`import { ${name} } from "${pkg}/${weightDir}";`);
    }
  });

  it("every native family the theme can request for a bundled script is in the asset map", () => {
    const all = new Set(Object.values(fontAssetNames).flat());
    for (const s of bundledScripts) {
      for (const w of ["regular", "medium", "semibold", "bold", "heavy"] as const) {
        expect(all.has(fontFamilyForScript(s, { weight: w })), `${s}/${w}`).toBe(true);
      }
    }
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
