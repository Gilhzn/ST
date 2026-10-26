/**
 * Per-script font stacks and typographic adjustments (Design Language v2).
 * Pure (no react-native import) so it is testable in Node.
 *
 * Brand face: Rubik (Latin, Cyrillic, Hebrew), weights 400/500/600/700/800.
 * Script fallbacks: Noto Sans Arabic, Noto Sans Devanagari, Noto Sans SC/TC/JP.
 *
 * Native: `fontFamily` must be ONE registered family name (no fallback stacks), so we
 * expose the @expo-google-fonts registration names per weight. Native text engines
 * (CoreText / Minikin) still fall back per glyph to system fonts for mixed-script text.
 * Web: a CSS stack with Rubik first, then the script family, then system fonts.
 * The font files themselves are listed in `fontAssets.ts` (RN-only module).
 */
import { typography, type FontWeightKey, type TextVariant, type TypeSpec } from "./tokens";

export type Script = "latin" | "hebrew" | "arabic" | "devanagari" | "sc" | "tc" | "jp";

/** The 13 locale folders shipped (zh split into Simplified/Traditional). */
export const supportedLocales = [
  "en",
  "he",
  "ar",
  "es",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "pt",
  "ru",
  "fr",
  "it",
  "de",
  "hi",
] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

/** Endonyms for the language picker (always rendered in their own script/font). */
export const localeNativeNames: Record<SupportedLocale, string> = {
  en: "English",
  he: "עברית",
  ar: "العربية",
  es: "Español",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  ja: "日本語",
  pt: "Português",
  ru: "Русский",
  fr: "Français",
  it: "Italiano",
  de: "Deutsch",
  hi: "हिन्दी",
};

export interface ScriptMetrics {
  /** Multiplier applied to the Latin line-height of each text variant. */
  lineHeightScale: number;
  /** Smallest font size allowed for this script (tiny Arabic/Devanagari marks become illegible). */
  minFontSize: number;
  /** Tracking breaks cursive joining (Arabic) and conjuncts (Devanagari). */
  letterSpacingAllowed: boolean;
  /** No case in these scripts: never uppercase-transform. */
  uppercaseAllowed: boolean;
  /** Avoid synthetic italics (no true italic in these Noto families). */
  italicAllowed: boolean;
  /** Android: keep font padding on scripts with tall marks to avoid clipping. */
  includeFontPadding: boolean;
  rtl: boolean;
}

export const scriptMetrics: Record<Script, ScriptMetrics> = {
  latin: {
    lineHeightScale: 1,
    minFontSize: 12,
    letterSpacingAllowed: true,
    uppercaseAllowed: true,
    italicAllowed: true,
    includeFontPadding: false,
    rtl: false,
  },
  hebrew: {
    lineHeightScale: 1.05,
    minFontSize: 12,
    letterSpacingAllowed: false,
    uppercaseAllowed: false,
    italicAllowed: false,
    includeFontPadding: false,
    rtl: true,
  },
  arabic: {
    lineHeightScale: 1.25,
    minFontSize: 13,
    letterSpacingAllowed: false,
    uppercaseAllowed: false,
    italicAllowed: false,
    includeFontPadding: true,
    rtl: true,
  },
  devanagari: {
    lineHeightScale: 1.25,
    minFontSize: 13,
    letterSpacingAllowed: false,
    uppercaseAllowed: false,
    italicAllowed: false,
    includeFontPadding: true,
    rtl: false,
  },
  sc: {
    lineHeightScale: 1.12,
    minFontSize: 12,
    letterSpacingAllowed: false,
    uppercaseAllowed: false,
    italicAllowed: false,
    includeFontPadding: false,
    rtl: false,
  },
  tc: {
    lineHeightScale: 1.12,
    minFontSize: 12,
    letterSpacingAllowed: false,
    uppercaseAllowed: false,
    italicAllowed: false,
    includeFontPadding: false,
    rtl: false,
  },
  jp: {
    lineHeightScale: 1.12,
    minFontSize: 12,
    letterSpacingAllowed: false,
    uppercaseAllowed: false,
    italicAllowed: false,
    includeFontPadding: false,
    rtl: false,
  },
};

export interface FontStack {
  /** Google Fonts family name (web CSS + @expo-google-fonts). */
  family: string;
  /** npm package that registers the native fonts. */
  expoPackage: string;
  /** Registration names per weight (as exported by @expo-google-fonts/*). */
  native: Record<FontWeightKey, string>;
  /** CSS font-family stack for react-native-web when brand fonts are NOT registered (Google Fonts / system). */
  web: string;
}

const WEIGHT_SUFFIX: Record<FontWeightKey, string> = {
  regular: "400Regular",
  medium: "500Medium",
  semibold: "600SemiBold",
  bold: "700Bold",
  heavy: "800ExtraBold",
};

const nativeNames = (prefix: string): Record<FontWeightKey, string> => ({
  regular: `${prefix}_${WEIGHT_SUFFIX.regular}`,
  medium: `${prefix}_${WEIGHT_SUFFIX.medium}`,
  semibold: `${prefix}_${WEIGHT_SUFFIX.semibold}`,
  bold: `${prefix}_${WEIGHT_SUFFIX.bold}`,
  heavy: `${prefix}_${WEIGHT_SUFFIX.heavy}`,
});

const SYSTEM_TAIL = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Rubik: the v2 brand face. Covers Latin, Latin-Ext, Cyrillic and Hebrew. */
export const brandFont: FontStack = {
  family: "Rubik",
  expoPackage: "@expo-google-fonts/rubik",
  native: nativeNames("Rubik"),
  web: `"Rubik", ${SYSTEM_TAIL}`,
};

const RUBIK_WEB = '"Rubik"';

/**
 * v2 per-script stacks. Latin/Cyrillic and Hebrew use Rubik; Arabic, Devanagari and CJK use
 * the matching Noto family (Rubik has no glyphs for them). On web the Rubik face is listed first
 * so Latin runs inside Arabic/CJK text still render in the brand face (per-glyph fallback).
 */
export const fontStacks: Record<Script, FontStack> = {
  latin: brandFont,
  hebrew: { ...brandFont, web: `"Rubik", "Noto Sans Hebrew", Arial, ${SYSTEM_TAIL}` },
  arabic: {
    family: "Noto Sans Arabic",
    expoPackage: "@expo-google-fonts/noto-sans-arabic",
    native: nativeNames("NotoSansArabic"),
    web: `${RUBIK_WEB}, "Noto Sans Arabic", Tahoma, ${SYSTEM_TAIL}`,
  },
  devanagari: {
    family: "Noto Sans Devanagari",
    expoPackage: "@expo-google-fonts/noto-sans-devanagari",
    native: nativeNames("NotoSansDevanagari"),
    web: `${RUBIK_WEB}, "Noto Sans Devanagari", "Nirmala UI", "Kohinoor Devanagari", ${SYSTEM_TAIL}`,
  },
  sc: {
    family: "Noto Sans SC",
    expoPackage: "@expo-google-fonts/noto-sans-sc",
    native: nativeNames("NotoSansSC"),
    web: `${RUBIK_WEB}, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", ${SYSTEM_TAIL}`,
  },
  tc: {
    family: "Noto Sans TC",
    expoPackage: "@expo-google-fonts/noto-sans-tc",
    native: nativeNames("NotoSansTC"),
    web: `${RUBIK_WEB}, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", ${SYSTEM_TAIL}`,
  },
  jp: {
    family: "Noto Sans JP",
    expoPackage: "@expo-google-fonts/noto-sans-jp",
    native: nativeNames("NotoSansJP"),
    web: `${RUBIK_WEB}, "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, ${SYSTEM_TAIL}`,
  },
};

/** Scripts whose font files ship in the app via `fontAssets` (CJK stays on system fonts / lazy CDN). */
export const bundledScripts: readonly Script[] = ["latin", "hebrew", "arabic", "devanagari"];

/** Font groups the app registers with expo-font (`fontAssets` in fontAssets.ts mirrors these names). */
export type FontGroup = "rubik" | "arabic" | "devanagari";
const GROUP_PREFIX: Record<FontGroup, string> = { rubik: "Rubik", arabic: "NotoSansArabic", devanagari: "NotoSansDevanagari" };
export const fontGroupPackages: Record<FontGroup, string> = {
  rubik: "@expo-google-fonts/rubik",
  arabic: "@expo-google-fonts/noto-sans-arabic",
  devanagari: "@expo-google-fonts/noto-sans-devanagari",
};
const WEIGHT_KEYS: FontWeightKey[] = ["regular", "medium", "semibold", "bold", "heavy"];

/** Registration names per group, e.g. rubik → ["Rubik_400Regular", …, "Rubik_800ExtraBold"]. */
export const fontAssetNames: Record<FontGroup, string[]> = {
  rubik: WEIGHT_KEYS.map((w) => `${GROUP_PREFIX.rubik}_${WEIGHT_SUFFIX[w]}`),
  arabic: WEIGHT_KEYS.map((w) => `${GROUP_PREFIX.arabic}_${WEIGHT_SUFFIX[w]}`),
  devanagari: WEIGHT_KEYS.map((w) => `${GROUP_PREFIX.devanagari}_${WEIGHT_SUFFIX[w]}`),
};

/** Which font groups a locale needs (Rubik always: Latin runs, digits and brand UI). */
export function fontGroupsForLocale(locale: string | undefined | null): FontGroup[] {
  const s = scriptForLocale(locale);
  if (s === "arabic") return ["rubik", "arabic"];
  if (s === "devanagari") return ["rubik", "devanagari"];
  return ["rubik"];
}

/** @deprecated v1 Noto-only stacks (kept for apps that still load Noto Sans for Latin). */
export const legacyFontStacks: Record<Script, FontStack> = {
  ...fontStacks,
  latin: {
    family: "Noto Sans",
    expoPackage: "@expo-google-fonts/noto-sans",
    native: nativeNames("NotoSans"),
    web: `"Noto Sans", ${SYSTEM_TAIL}`,
  },
  hebrew: {
    family: "Noto Sans Hebrew",
    expoPackage: "@expo-google-fonts/noto-sans-hebrew",
    native: nativeNames("NotoSansHebrew"),
    web: `"Noto Sans Hebrew", "Noto Sans", Arial, ${SYSTEM_TAIL}`,
  },
};

/** Maps a BCP-47 tag (e.g. "he-IL", "zh-TW", "zh-Hans-CN", "pt-BR") to its script. */
export function scriptForLocale(locale: string | undefined | null): Script {
  if (!locale) return "latin";
  const parts = locale.replace(/_/g, "-").toLowerCase().split("-");
  const lang = parts[0] ?? "";
  const rest = parts.slice(1);
  switch (lang) {
    case "he":
    case "iw":
    case "yi":
      return "hebrew";
    case "ar":
    case "fa":
    case "ur":
      return "arabic";
    case "hi":
    case "mr":
    case "ne":
      return "devanagari";
    case "ja":
      return "jp";
    case "zh": {
      if (rest.includes("hant")) return "tc";
      if (rest.includes("hans")) return "sc";
      if (rest.some((r) => r === "tw" || r === "hk" || r === "mo")) return "tc";
      return "sc";
    }
    default:
      return "latin";
  }
}

export function isRtlLocale(locale: string | undefined | null): boolean {
  return scriptMetrics[scriptForLocale(locale)].rtl;
}

export interface FontFamilyOptions {
  weight?: FontWeightKey;
  platform?: "web" | "native";
  /**
   * Web only: the weighted faces are registered with expo-font (`fontAssets`), so the stack
   * starts with the per-weight family (`Rubik_700Bold`) and `fontWeight` must NOT be set.
   */
  registered?: boolean;
  /** Use the v1 Noto mapping (apps that have not migrated their font loader yet). */
  legacy?: boolean;
}

/**
 * The font family string for a locale.
 * - native: registered family for the weight (`Rubik_700Bold`, `NotoSansArabic_700Bold`)
 * - web: CSS stack (`"Rubik", …`); with `registered`, the per-weight faces come first.
 */
export function fontFamilyForLocale(locale: string | undefined | null, opts: FontFamilyOptions = {}): string {
  return fontFamilyForScript(scriptForLocale(locale), opts);
}

export function fontFamilyForScript(script: Script, opts: FontFamilyOptions = {}): string {
  const stacks = opts.legacy ? legacyFontStacks : fontStacks;
  const stack = stacks[script];
  const weight = opts.weight ?? "regular";
  const platform = opts.platform ?? "native";
  if (platform === "native") return stack.native[weight];
  if (!opts.registered) return stack.web;
  const rubik = brandFont.native[weight];
  const scriptFace = script === "latin" || script === "hebrew" ? null : stack.native[weight];
  return [rubik, scriptFace, stack.web].filter(Boolean).join(", ");
}

/**
 * Detects the dominant non-Latin script of user content (chat, names) so it can render
 * with the right font even inside a UI of another locale. Returns null for Latin/neutral.
 * `hint` disambiguates Han characters (ja vs zh) using the UI locale.
 */
export function detectScript(text: string, hint?: string): Script | null {
  let kana = false;
  let han = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0590 && cp <= 0x05ff) return "hebrew";
    if (
      (cp >= 0x0600 && cp <= 0x06ff) ||
      (cp >= 0x0750 && cp <= 0x077f) ||
      (cp >= 0x08a0 && cp <= 0x08ff) ||
      (cp >= 0xfb50 && cp <= 0xfdff) ||
      (cp >= 0xfe70 && cp <= 0xfeff)
    )
      return "arabic";
    if (cp >= 0x0900 && cp <= 0x097f) return "devanagari";
    if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff)) kana = true;
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff))
      han = true;
  }
  if (kana) return "jp";
  if (han) {
    const hinted = scriptForLocale(hint);
    if (hinted === "jp" || hinted === "tc" || hinted === "sc") return hinted;
    return "sc";
  }
  return null;
}

export interface ResolvedTypeStyle {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  weight: FontWeightKey;
  uppercase: boolean;
  tabularNums: boolean;
  includeFontPadding: boolean;
  maxFontSizeMultiplier: number;
}

/** Applies per-script adjustments (line-height, min size, tracking, casing) to a variant. */
export function typeStyleFor(variant: TextVariant, script: Script): ResolvedTypeStyle {
  const spec: TypeSpec = typography[variant];
  const m = scriptMetrics[script];
  const fontSize = Math.max(spec.fontSize, m.minFontSize);
  const baseRatio = spec.lineHeight / spec.fontSize;
  const lineHeight = Math.ceil(fontSize * baseRatio * m.lineHeightScale);
  return {
    fontSize,
    lineHeight,
    letterSpacing: m.letterSpacingAllowed ? spec.letterSpacing : 0,
    weight: spec.weight,
    uppercase: Boolean(spec.uppercase) && m.uppercaseAllowed,
    tabularNums: Boolean(spec.tabularNums),
    includeFontPadding: m.includeFontPadding,
    maxFontSizeMultiplier: spec.maxFontSizeMultiplier,
  };
}

/** All font packages the app loads natively (v2: Rubik + script fallbacks). */
export function requiredFontPackages(): string[] {
  return Array.from(new Set(Object.values(fontStacks).map((s) => s.expoPackage)));
}

/** Google Fonts CSS2 URL for the web shell (`display=swap`; browser subsets via unicode-range). */
export function googleFontsCssUrl(scripts: Script[] = ["latin"]): string {
  const families = Array.from(new Set(["Rubik", ...scripts.map((s) => fontStacks[s].family)]))
    .map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700;800`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}
