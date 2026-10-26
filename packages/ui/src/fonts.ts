/**
 * Per-script font stacks and typographic adjustments.
 * Pure (no react-native import) so it is testable in Node.
 *
 * Native: `fontFamily` must be ONE registered family name (no fallback stacks), so we
 * expose the @expo-google-fonts registration names per weight. Native text engines
 * (CoreText / Minikin) still fall back per glyph to system fonts for mixed-script text.
 * Web: a CSS stack with the locale font first (Latin first for CJK).
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
  /** CSS font-family stack for react-native-web. */
  web: string;
}

const nativeNames = (prefix: string): Record<FontWeightKey, string> => ({
  regular: `${prefix}_400Regular`,
  medium: `${prefix}_500Medium`,
  semibold: `${prefix}_600SemiBold`,
  bold: `${prefix}_700Bold`,
});

const SYSTEM_TAIL = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const fontStacks: Record<Script, FontStack> = {
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
  arabic: {
    family: "Noto Sans Arabic",
    expoPackage: "@expo-google-fonts/noto-sans-arabic",
    native: nativeNames("NotoSansArabic"),
    web: `"Noto Sans Arabic", "Noto Sans", Tahoma, ${SYSTEM_TAIL}`,
  },
  devanagari: {
    family: "Noto Sans Devanagari",
    expoPackage: "@expo-google-fonts/noto-sans-devanagari",
    native: nativeNames("NotoSansDevanagari"),
    web: `"Noto Sans Devanagari", "Noto Sans", "Nirmala UI", "Kohinoor Devanagari", ${SYSTEM_TAIL}`,
  },
  sc: {
    family: "Noto Sans SC",
    expoPackage: "@expo-google-fonts/noto-sans-sc",
    native: nativeNames("NotoSansSC"),
    web: `"Noto Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", ${SYSTEM_TAIL}`,
  },
  tc: {
    family: "Noto Sans TC",
    expoPackage: "@expo-google-fonts/noto-sans-tc",
    native: nativeNames("NotoSansTC"),
    web: `"Noto Sans", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", ${SYSTEM_TAIL}`,
  },
  jp: {
    family: "Noto Sans JP",
    expoPackage: "@expo-google-fonts/noto-sans-jp",
    native: nativeNames("NotoSansJP"),
    web: `"Noto Sans", "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, ${SYSTEM_TAIL}`,
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
}

/**
 * The font family string for a locale.
 * - web: CSS stack (`"Noto Sans Hebrew", "Noto Sans", …`)
 * - native: registered family for the weight (`NotoSansHebrew_700Bold`)
 */
export function fontFamilyForLocale(locale: string | undefined | null, opts: FontFamilyOptions = {}): string {
  return fontFamilyForScript(scriptForLocale(locale), opts);
}

export function fontFamilyForScript(script: Script, opts: FontFamilyOptions = {}): string {
  const stack = fontStacks[script];
  const platform = opts.platform ?? "native";
  if (platform === "web") return stack.web;
  return stack.native[opts.weight ?? "regular"];
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

/** All font packages the app must load (native) — for the app dev's font loader. */
export function requiredFontPackages(): string[] {
  return Object.values(fontStacks).map((s) => s.expoPackage);
}

/** Google Fonts CSS2 URL for the web shell (`display=swap`; browser subsets via unicode-range). */
export function googleFontsCssUrl(scripts: Script[] = ["latin"]): string {
  const families = Array.from(new Set(scripts.map((s) => fontStacks[s].family)))
    .map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}
