/**
 * Font files for expo-font (RN / web). NOT pure: each import is a bundled .ttf asset,
 * so tests must import `fonts.ts` instead. Names match `fontAssetNames` in fonts.ts
 * (enforced by test/fonts.test.ts).
 *
 * Usage (app root):
 *   const brandFonts = useAppFonts(locale);              // Rubik + the locale's script fallback
 *   <ThemeProvider locale={locale} brandFonts={brandFonts}>…
 * or, with your own loader: useFonts(fontAssetsForLocale(locale)).
 */
import { NotoSansArabic_400Regular } from "@expo-google-fonts/noto-sans-arabic/400Regular";
import { NotoSansArabic_500Medium } from "@expo-google-fonts/noto-sans-arabic/500Medium";
import { NotoSansArabic_600SemiBold } from "@expo-google-fonts/noto-sans-arabic/600SemiBold";
import { NotoSansArabic_700Bold } from "@expo-google-fonts/noto-sans-arabic/700Bold";
import { NotoSansArabic_800ExtraBold } from "@expo-google-fonts/noto-sans-arabic/800ExtraBold";
import { NotoSansDevanagari_400Regular } from "@expo-google-fonts/noto-sans-devanagari/400Regular";
import { NotoSansDevanagari_500Medium } from "@expo-google-fonts/noto-sans-devanagari/500Medium";
import { NotoSansDevanagari_600SemiBold } from "@expo-google-fonts/noto-sans-devanagari/600SemiBold";
import { NotoSansDevanagari_700Bold } from "@expo-google-fonts/noto-sans-devanagari/700Bold";
import { NotoSansDevanagari_800ExtraBold } from "@expo-google-fonts/noto-sans-devanagari/800ExtraBold";
import { Rubik_400Regular } from "@expo-google-fonts/rubik/400Regular";
import { Rubik_500Medium } from "@expo-google-fonts/rubik/500Medium";
import { Rubik_600SemiBold } from "@expo-google-fonts/rubik/600SemiBold";
import { Rubik_700Bold } from "@expo-google-fonts/rubik/700Bold";
import { Rubik_800ExtraBold } from "@expo-google-fonts/rubik/800ExtraBold";
import { useFonts } from "expo-font";
import { useMemo } from "react";

import { fontGroupsForLocale, type FontGroup } from "./fonts";

type FontSource = number | string | { uri: string };

/** expo-font maps per group: `useFonts(fontAssets.rubik)`. */
export const fontAssets: Record<FontGroup, Record<string, FontSource>> = {
  rubik: { Rubik_400Regular, Rubik_500Medium, Rubik_600SemiBold, Rubik_700Bold, Rubik_800ExtraBold },
  arabic: {
    NotoSansArabic_400Regular,
    NotoSansArabic_500Medium,
    NotoSansArabic_600SemiBold,
    NotoSansArabic_700Bold,
    NotoSansArabic_800ExtraBold,
  },
  devanagari: {
    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_500Medium,
    NotoSansDevanagari_600SemiBold,
    NotoSansDevanagari_700Bold,
    NotoSansDevanagari_800ExtraBold,
  },
};

/** The merged map a locale needs (Rubik + its script fallback). */
export function fontAssetsForLocale(locale: string | undefined | null): Record<string, FontSource> {
  return Object.assign({}, ...fontGroupsForLocale(locale).map((g) => fontAssets[g]));
}

/**
 * Loads Rubik (+ Noto Arabic / Devanagari when the locale needs it) with expo-font.
 * Returns true once usable — pass it to `<ThemeProvider brandFonts>`. Falls back to
 * system fonts (false) on error. CJK locales use Rubik for Latin runs + system Han fonts.
 */
export function useAppFonts(locale?: string | null): boolean {
  const key = fontGroupsForLocale(locale).join("+");
  const map = useMemo<Record<string, FontSource>>(
    () => Object.assign({}, ...key.split("+").map((g) => fontAssets[g as FontGroup])),
    [key],
  );
  const [loaded, error] = useFonts(map);
  return loaded && !error;
}
