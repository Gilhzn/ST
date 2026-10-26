/**
 * Native font loading (design §5.2): Noto Sans always, plus the per-script
 * families for Hebrew, Arabic and Devanagari. CJK families are several MB each
 * and are not bundled; those scripts use the system font (fontsLoaded=false).
 */
import { NotoSans_400Regular } from '@expo-google-fonts/noto-sans/400Regular';
import { NotoSans_500Medium } from '@expo-google-fonts/noto-sans/500Medium';
import { NotoSans_600SemiBold } from '@expo-google-fonts/noto-sans/600SemiBold';
import { NotoSans_700Bold } from '@expo-google-fonts/noto-sans/700Bold';
import { NotoSansArabic_400Regular } from '@expo-google-fonts/noto-sans-arabic/400Regular';
import { NotoSansArabic_500Medium } from '@expo-google-fonts/noto-sans-arabic/500Medium';
import { NotoSansArabic_600SemiBold } from '@expo-google-fonts/noto-sans-arabic/600SemiBold';
import { NotoSansArabic_700Bold } from '@expo-google-fonts/noto-sans-arabic/700Bold';
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari/400Regular';
import { NotoSansDevanagari_500Medium } from '@expo-google-fonts/noto-sans-devanagari/500Medium';
import { NotoSansDevanagari_600SemiBold } from '@expo-google-fonts/noto-sans-devanagari/600SemiBold';
import { NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari/700Bold';
import { NotoSansHebrew_400Regular } from '@expo-google-fonts/noto-sans-hebrew/400Regular';
import { NotoSansHebrew_500Medium } from '@expo-google-fonts/noto-sans-hebrew/500Medium';
import { NotoSansHebrew_600SemiBold } from '@expo-google-fonts/noto-sans-hebrew/600SemiBold';
import { NotoSansHebrew_700Bold } from '@expo-google-fonts/noto-sans-hebrew/700Bold';
import { scriptForLocale } from '@st/ui';
import { useFonts } from 'expo-font';

const FONTS = {
  NotoSans_400Regular,
  NotoSans_500Medium,
  NotoSans_600SemiBold,
  NotoSans_700Bold,
  NotoSansHebrew_400Regular,
  NotoSansHebrew_500Medium,
  NotoSansHebrew_600SemiBold,
  NotoSansHebrew_700Bold,
  NotoSansArabic_400Regular,
  NotoSansArabic_500Medium,
  NotoSansArabic_600SemiBold,
  NotoSansArabic_700Bold,
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_500Medium,
  NotoSansDevanagari_600SemiBold,
  NotoSansDevanagari_700Bold,
};

/** True once the families for `locale` are usable (always false for CJK → system font). */
export function useAppFonts(locale: string): boolean {
  const [loaded, error] = useFonts(FONTS);
  const script = scriptForLocale(locale);
  if (error) return false;
  return loaded && script !== 'sc' && script !== 'tc' && script !== 'jp';
}
