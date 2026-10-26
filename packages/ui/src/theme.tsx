import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, I18nManager, Platform, useColorScheme, View, type ViewStyle } from "react-native";

import { bundledScripts, fontFamilyForScript, scriptForLocale, scriptMetrics, type Script } from "./fonts";
import {
  colors as colorSets,
  elevation as elevationSets,
  gradients,
  reliabilityColors as reliabilitySets,
  sportColors,
  tokens,
  type ColorScheme,
  type ElevationLevel,
  type FontWeightKey,
  type ReliabilityStatus,
  type ReliabilityToken,
  type SemanticColors,
  type SportKey,
} from "./tokens";

/** Sport colors resolved for the current scheme. */
export interface ResolvedSport {
  key: SportKey;
  /** Marker / glyph-well fill (white glyph on it). */
  color: string;
  on: string;
  gradient: readonly [string, string];
  /** Sport-colored label on surfaces and on `tint`. */
  text: string;
  /** Tinted well / chip background. */
  tint: string;
}

export type ThemePreference = "light" | "dark" | "system";
export type Direction = "ltr" | "rtl";

export interface Theme {
  /** What the user picked in Settings. */
  preference: ThemePreference;
  /** What is rendered right now. */
  scheme: ColorScheme;
  colors: SemanticColors;
  reliability: Record<ReliabilityStatus, ReliabilityToken>;
  elevation: (level: ElevationLevel) => ViewStyle;
  /** Scheme-resolved sport colors (tint/text switch between light and dark). */
  sport: (key: SportKey) => ResolvedSport;
  gradients: typeof gradients;
  tokens: typeof tokens;
  direction: Direction;
  isRTL: boolean;
  locale: string;
  script: Script;
  /** True when the OS asks for reduced motion — skip springs, parallax, pulsing pins. */
  reducedMotion: boolean;
  /** Font family for the current locale (falls back to system fonts until loaded on native). */
  fontFamily: (weight?: FontWeightKey, script?: Script) => string | undefined;
  /** Whether `fontWeight` is baked into the family (registered per-weight faces) instead of set separately. */
  usesWeightedFamilies: boolean;
  /** True when the v2 brand fonts (Rubik + script fallbacks from `fontAssets`) are registered. */
  brandFonts: boolean;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<Theme | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  /** Initial preference (persisted by the app; default "system"). */
  initialPreference?: ThemePreference;
  /** Called when `setPreference` runs, so the app can persist it. */
  onPreferenceChange?: (p: ThemePreference) => void;
  /** Active UI locale (BCP-47), drives font stack and script metrics. */
  locale?: string;
  /** Layout direction. Defaults to I18nManager.isRTL on native, or the locale on web. */
  direction?: Direction;
  /**
   * @deprecated v1: native Noto fonts loaded by the app's own loader. Use `brandFonts`.
   * Native only: true once Noto fonts are loaded via expo-font; until then system fonts are used.
   */
  fontsLoaded?: boolean;
  /** v2: true once `useAppFonts(locale)` (Rubik + script fallback) has loaded. Web and native. */
  brandFonts?: boolean;
  /** Wraps children in a View with `direction` so logical styles resolve (default true). */
  applyDirection?: boolean;
}

export function ThemeProvider({
  children,
  initialPreference = "system",
  onPreferenceChange,
  locale = "en",
  direction,
  fontsLoaded = false,
  brandFonts = false,
  applyDirection = true,
}: ThemeProviderProps) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReducedMotion(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v: boolean) => setReducedMotion(v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  const setPreference = useCallback(
    (p: ThemePreference) => {
      setPreferenceState(p);
      onPreferenceChange?.(p);
    },
    [onPreferenceChange],
  );

  const script = scriptForLocale(locale);
  const resolvedDirection: Direction =
    direction ??
    (Platform.OS === "web" ? (scriptMetrics[script].rtl ? "rtl" : "ltr") : I18nManager.isRTL ? "rtl" : "ltr");

  // Web: keep <html dir/lang> in sync so browser features (scrollbars, inputs) follow.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.setAttribute("dir", resolvedDirection);
    document.documentElement.setAttribute("lang", locale);
  }, [resolvedDirection, locale]);

  const scheme: ColorScheme = preference === "system" ? (system === "dark" ? "dark" : "light") : preference;

  const theme = useMemo<Theme>(() => {
    const isWeb = Platform.OS === "web";
    const fontFamily = (weight: FontWeightKey = "regular", s: Script = script): string | undefined => {
      if (brandFonts && bundledScripts.includes(s)) {
        return fontFamilyForScript(s, { weight, platform: isWeb ? "web" : "native", registered: true });
      }
      if (isWeb) return fontFamilyForScript(s, { weight, platform: "web" });
      if (fontsLoaded && bundledScripts.includes(s)) return fontFamilyForScript(s, { weight, legacy: true });
      return undefined;
    };
    return {
      preference,
      scheme,
      colors: colorSets[scheme],
      reliability: reliabilitySets[scheme],
      elevation: (level: ElevationLevel): ViewStyle => elevationStyle(scheme, level),
      sport: (key: SportKey) => resolveSport(scheme, key),
      gradients,
      tokens,
      direction: resolvedDirection,
      isRTL: resolvedDirection === "rtl",
      locale,
      script,
      reducedMotion,
      fontFamily,
      usesWeightedFamilies: brandFonts || (!isWeb && fontsLoaded),
      brandFonts,
      setPreference,
    };
  }, [preference, scheme, resolvedDirection, locale, script, reducedMotion, fontsLoaded, brandFonts, setPreference]);

  return (
    <ThemeContext.Provider value={theme}>
      {applyDirection ? (
        <View style={{ flex: 1, direction: resolvedDirection, backgroundColor: theme.colors.background }}>
          {children}
        </View>
      ) : (
        children
      )}
    </ThemeContext.Provider>
  );
}

/** Access the theme. Outside a provider it returns a light/LTR default (useful for isolated previews). */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  return ctx ?? fallbackTheme;
}

const fallbackTheme: Theme = {
  preference: "system",
  scheme: "light",
  colors: colorSets.light,
  reliability: reliabilitySets.light,
  elevation: (level) => elevationStyle("light", level),
  sport: (key) => resolveSport("light", key),
  gradients,
  tokens,
  direction: "ltr",
  isRTL: false,
  locale: "en",
  script: "latin",
  reducedMotion: false,
  fontFamily: () => undefined,
  usesWeightedFamilies: false,
  brandFonts: false,
  setPreference: () => undefined,
};

function elevationStyle(scheme: ColorScheme, level: ElevationLevel): ViewStyle {
  if (level === 0) return {};
  const e = elevationSets[scheme][level];
  const c = colorSets[scheme];
  return {
    ...(e.boxShadow !== "none" ? { boxShadow: e.boxShadow } : null),
    backgroundColor: c[e.surface],
    ...(e.border ? { borderWidth: 1, borderColor: c[e.border] } : null),
    zIndex: e.zIndex,
  };
}

function resolveSport(scheme: ColorScheme, key: SportKey): ResolvedSport {
  const t = sportColors[key];
  return {
    key,
    color: t.color,
    on: t.on,
    gradient: t.gradient,
    text: scheme === "dark" ? t.textDark : t.text,
    tint: scheme === "dark" ? t.tintDark : t.tint,
  };
}

/** Style that mirrors a directional glyph (back arrow, chevron, progress) in RTL. */
export function useMirrorStyle(): ViewStyle | undefined {
  const { isRTL } = useTheme();
  return isRTL ? { transform: [{ scaleX: -1 }] } : undefined;
}
