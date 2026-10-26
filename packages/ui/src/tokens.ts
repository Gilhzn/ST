/**
 * Sport Talent design tokens.
 *
 * Pure data (no react-native import) so it can be unit-tested in Node and shared with
 * the web shell, e-mail templates and the moderation console.
 * Every text/background pair used by primitives is listed in `contrastPairs` and is
 * verified ≥ WCAG 2.2 AA by `test/tokens.test.ts`.
 */

/* ------------------------------------------------------------------ */
/* Brand palette (raw). Components never use these directly.           */
/* ------------------------------------------------------------------ */

export const palette = {
  // "Night Court" indigo: trust and depth
  indigo50: "#ECE9FF",
  indigo100: "#D9D3FF",
  indigo300: "#B3A8FF",
  indigo400: "#9A8CFF",
  indigo500: "#4B2FE0",
  indigo600: "#4126D6",
  indigo700: "#3A21C0",
  indigo900: "#262247",
  // "Volt": energy. Used as a fill only, always with dark text
  volt400: "#C5F230",
  volt300: "#D2FF45",
  // Ink neutrals (cool, slightly blue)
  ink950: "#0A0B12",
  ink900: "#12131C",
  ink850: "#14151F",
  ink800: "#1C1E2B",
  ink750: "#0F1018",
  ink700: "#2B2E40",
  ink600: "#6B6F88",
  ink500: "#8A8EA6",
  ink450: "#9094AB",
  ink400: "#62667D",
  ink300: "#B4B7CA",
  ink350: "#4B4E63",
  ink200: "#D6D8E3",
  ink100: "#EDEEF4",
  ink50: "#F6F7FB",
  ink25: "#F2F3F8",
  white: "#FFFFFF",
  // Semantic hues
  red700: "#A8141F",
  red600: "#C21E2B",
  red300: "#FF9198",
  red400: "#FF6B73",
  red50: "#FDE7E8",
  red950: "#3A1418",
  green700: "#146B31",
  green600: "#1A7F3C",
  green400: "#4CD07D",
  green300: "#6EE59A",
  green50: "#E2F4E7",
  green950: "#10301D",
  amber800: "#6B4A00",
  amber500: "#F5B700",
  amber300: "#FFD466",
  amber400: "#FFC83D",
  amber50: "#FFF3CC",
  amber950: "#33280A",
  slate800: "#33407A",
  slate300: "#B9C2FF",
  slate50: "#E8EAF6",
  slate950: "#1E2236",
} as const;

/* ------------------------------------------------------------------ */
/* Semantic colors                                                      */
/* ------------------------------------------------------------------ */

export interface SemanticColors {
  /** App canvas behind everything. */
  background: string;
  /** Cards, sheets, list rows. */
  surface: string;
  /** Raised surfaces in dark mode (sheets, menus); same as surface in light. */
  surfaceRaised: string;
  /** Inputs, segmented controls, skeletons. */
  surfaceSunken: string;
  /** Toasts, tooltips. */
  surfaceInverse: string;
  text: string;
  textSecondary: string;
  /** Placeholder, helper text, timestamps. Still ≥ 4.5:1 (placeholder is informational). */
  textTertiary: string;
  textInverse: string;
  /** Hairlines, decorative dividers (not required to meet 3:1). */
  border: string;
  /** Input outlines, unselected chip outline, focus-independent boundaries (≥ 3:1). */
  borderStrong: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  primarySubtle: string;
  onPrimarySubtle: string;
  /** Links and primary-colored text on surface. */
  primaryText: string;
  accent: string;
  onAccent: string;
  danger: string;
  dangerPressed: string;
  onDanger: string;
  dangerSubtle: string;
  dangerText: string;
  success: string;
  onSuccess: string;
  successSubtle: string;
  successText: string;
  warning: string;
  onWarning: string;
  warningSubtle: string;
  warningText: string;
  info: string;
  infoSubtle: string;
  infoText: string;
  /** Focus outline (≥ 3:1 against background and surface). */
  focusRing: string;
  /** Modal scrim. */
  scrim: string;
  /** Skeleton shimmer base. */
  skeleton: string;
  disabledBg: string;
  disabledText: string;
  /** Map pin outline ring (non-text contrast against map tiles). */
  pinRing: string;
  pinOutline: string;
  /** Representative map tile color used for pin contrast checks. */
  mapBase: string;
}

export const lightColors: SemanticColors = {
  background: palette.ink50,
  surface: palette.white,
  surfaceRaised: palette.white,
  surfaceSunken: palette.ink100,
  surfaceInverse: palette.ink900,
  text: palette.ink900,
  textSecondary: palette.ink350,
  textTertiary: palette.ink400,
  textInverse: palette.ink25,
  border: palette.ink200,
  borderStrong: palette.ink500,
  primary: palette.indigo500,
  primaryPressed: palette.indigo700,
  onPrimary: palette.white,
  primarySubtle: palette.indigo50,
  onPrimarySubtle: palette.indigo700,
  primaryText: palette.indigo600,
  accent: palette.volt400,
  onAccent: palette.ink900,
  danger: palette.red600,
  dangerPressed: palette.red700,
  onDanger: palette.white,
  dangerSubtle: palette.red50,
  dangerText: palette.red700,
  success: palette.green600,
  onSuccess: palette.white,
  successSubtle: palette.green50,
  successText: palette.green700,
  warning: palette.amber500,
  onWarning: palette.ink900,
  warningSubtle: palette.amber50,
  warningText: palette.amber800,
  info: "#0B5FB0",
  infoSubtle: "#E3EFFB",
  infoText: "#0A4F93",
  focusRing: palette.indigo500,
  scrim: "rgba(10, 11, 18, 0.52)",
  skeleton: palette.ink100,
  disabledBg: palette.ink100,
  disabledText: palette.ink400,
  pinRing: palette.white,
  pinOutline: palette.ink900,
  mapBase: "#F2EFE9",
};

export const darkColors: SemanticColors = {
  background: palette.ink950,
  surface: palette.ink850,
  surfaceRaised: palette.ink800,
  surfaceSunken: palette.ink750,
  surfaceInverse: palette.ink25,
  text: palette.ink25,
  textSecondary: palette.ink300,
  textTertiary: palette.ink450,
  textInverse: palette.ink900,
  border: palette.ink700,
  borderStrong: palette.ink600,
  primary: palette.indigo400,
  primaryPressed: palette.indigo300,
  onPrimary: palette.ink950,
  primarySubtle: palette.indigo900,
  onPrimarySubtle: "#C9C1FF",
  primaryText: palette.indigo300,
  accent: palette.volt300,
  onAccent: palette.ink950,
  danger: palette.red400,
  dangerPressed: palette.red300,
  onDanger: palette.ink950,
  dangerSubtle: palette.red950,
  dangerText: palette.red300,
  success: palette.green400,
  onSuccess: palette.ink950,
  successSubtle: palette.green950,
  successText: palette.green300,
  warning: palette.amber400,
  onWarning: palette.ink950,
  warningSubtle: palette.amber950,
  warningText: palette.amber300,
  info: "#6CB4FF",
  infoSubtle: "#0E2540",
  infoText: "#8EC6FF",
  focusRing: palette.indigo400,
  scrim: "rgba(0, 0, 0, 0.64)",
  skeleton: palette.ink800,
  disabledBg: palette.ink800,
  disabledText: palette.ink450,
  pinRing: palette.ink950,
  pinOutline: palette.ink25,
  mapBase: "#1B1D24",
};

export type ColorScheme = "light" | "dark";
export const colors: Record<ColorScheme, SemanticColors> = { light: lightColors, dark: darkColors };
export type ColorToken = keyof SemanticColors;

/**
 * Text/background pairs that primitives actually render. Each is verified by tests.
 * `min` is 4.5 for text (WCAG 1.4.3) and 3 for non-text UI boundaries (WCAG 1.4.11).
 */
export const contrastPairs: ReadonlyArray<{ fg: ColorToken; bg: ColorToken; min: number; use: string }> = [
  { fg: "text", bg: "background", min: 4.5, use: "body text on canvas" },
  { fg: "text", bg: "surface", min: 4.5, use: "body text on cards" },
  { fg: "text", bg: "surfaceRaised", min: 4.5, use: "body text on sheets" },
  { fg: "text", bg: "surfaceSunken", min: 4.5, use: "input text" },
  { fg: "textSecondary", bg: "background", min: 4.5, use: "secondary text on canvas" },
  { fg: "textSecondary", bg: "surface", min: 4.5, use: "secondary text on cards" },
  { fg: "textSecondary", bg: "surfaceRaised", min: 4.5, use: "secondary text on sheets" },
  { fg: "textTertiary", bg: "surface", min: 4.5, use: "placeholder/helper" },
  { fg: "textTertiary", bg: "surfaceRaised", min: 4.5, use: "helper on sheets" },
  { fg: "textTertiary", bg: "surfaceSunken", min: 4.5, use: "placeholder in sunken input" },
  { fg: "textInverse", bg: "surfaceInverse", min: 4.5, use: "toast" },
  { fg: "onPrimary", bg: "primary", min: 4.5, use: "primary button label" },
  { fg: "onPrimary", bg: "primaryPressed", min: 4.5, use: "primary button pressed" },
  { fg: "onPrimarySubtle", bg: "primarySubtle", min: 4.5, use: "selected chip label" },
  { fg: "primaryText", bg: "surface", min: 4.5, use: "link / ghost button" },
  { fg: "primaryText", bg: "background", min: 4.5, use: "link on canvas" },
  { fg: "onAccent", bg: "accent", min: 4.5, use: "volt badge / FAB" },
  { fg: "onDanger", bg: "danger", min: 4.5, use: "danger button" },
  { fg: "onDanger", bg: "dangerPressed", min: 4.5, use: "danger pressed" },
  { fg: "dangerText", bg: "surface", min: 4.5, use: "error message" },
  { fg: "dangerText", bg: "dangerSubtle", min: 4.5, use: "error banner" },
  { fg: "onSuccess", bg: "success", min: 4.5, use: "success button" },
  { fg: "successText", bg: "successSubtle", min: 4.5, use: "success banner" },
  { fg: "onWarning", bg: "warning", min: 4.5, use: "warning fill" },
  { fg: "warningText", bg: "warningSubtle", min: 4.5, use: "warning banner" },
  { fg: "infoText", bg: "infoSubtle", min: 4.5, use: "info banner" },
  { fg: "infoText", bg: "surface", min: 4.5, use: "info text" },
  { fg: "disabledText", bg: "disabledBg", min: 3, use: "disabled (exempt, kept legible)" },
  { fg: "borderStrong", bg: "surface", min: 3, use: "input outline" },
  { fg: "borderStrong", bg: "background", min: 3, use: "chip outline on canvas" },
  { fg: "focusRing", bg: "background", min: 3, use: "focus indicator" },
  { fg: "focusRing", bg: "surface", min: 3, use: "focus indicator on cards" },
  { fg: "pinOutline", bg: "mapBase", min: 3, use: "map pin outline vs tiles" },
];

/* ------------------------------------------------------------------ */
/* Sports (map pins)                                                    */
/* ------------------------------------------------------------------ */

export type SportKey = "football" | "basketball" | "tennis" | "padel" | "running" | "volleyball";
export type PinShape = "circle" | "square" | "diamond" | "shield" | "pill" | "capsule";

export interface SportToken {
  key: SportKey;
  /** Okabe–Ito based fill, colorblind-safe set. */
  color: string;
  /** Foreground for glyphs/text on the fill (≥ 4.5:1). */
  on: string;
  /** Distinct marker silhouette so color is never the only cue. */
  shape: PinShape;
  /** Fallback glyph when no vector icon is passed. */
  glyph: string;
  /** Suggested @expo/vector-icons MaterialCommunityIcons name. */
  icon: string;
}

export const sportColors: Record<SportKey, SportToken> = {
  football: { key: "football", color: "#009E73", on: "#0A0B12", shape: "circle", glyph: "⚽", icon: "soccer" },
  basketball: { key: "basketball", color: "#D55E00", on: "#0A0B12", shape: "square", glyph: "🏀", icon: "basketball" },
  tennis: { key: "tennis", color: "#F0E442", on: "#0A0B12", shape: "diamond", glyph: "🎾", icon: "tennis" },
  padel: { key: "padel", color: "#0072B2", on: "#FFFFFF", shape: "shield", glyph: "🏓", icon: "racquetball" },
  running: { key: "running", color: "#CC79A7", on: "#0A0B12", shape: "pill", glyph: "🏃", icon: "run-fast" },
  volleyball: { key: "volleyball", color: "#E69F00", on: "#0A0B12", shape: "capsule", glyph: "🏐", icon: "volleyball" },
};

export const sportKeys = Object.keys(sportColors) as SportKey[];

/** Max sports selectable in the map filter at once (PRD §2). */
export const MAX_SPORT_FILTERS = 3;
/** Radius choices for the map (km). */
export const RADIUS_OPTIONS_KM = [1, 2, 5, 10, 30, 50] as const;

/* ------------------------------------------------------------------ */
/* Reliability status                                                   */
/* ------------------------------------------------------------------ */

export type ReliabilityStatus = "green" | "yellow" | "red" | "new";

export interface ReliabilityToken {
  /** Tinted badge background. */
  bg: string;
  /** Label + glyph color on `bg` (≥ 4.5:1). */
  fg: string;
  /** Solid dot / meter fill (≥ 3:1 on surface). */
  solid: string;
  /** Glyph shown with the label — never color alone. */
  glyph: string;
  /** Suggested vector icon. */
  icon: string;
}

export const reliabilityColors: Record<ColorScheme, Record<ReliabilityStatus, ReliabilityToken>> = {
  light: {
    green: { bg: palette.green50, fg: palette.green700, solid: palette.green600, glyph: "✓", icon: "shield-check" },
    yellow: { bg: palette.amber50, fg: palette.amber800, solid: "#B07D00", glyph: "!", icon: "alert" },
    red: { bg: palette.red50, fg: palette.red700, solid: palette.red600, glyph: "✕", icon: "cancel" },
    new: { bg: palette.slate50, fg: palette.slate800, solid: "#5B66A8", glyph: "✦", icon: "sprout" },
  },
  dark: {
    green: { bg: palette.green950, fg: palette.green300, solid: palette.green400, glyph: "✓", icon: "shield-check" },
    yellow: { bg: palette.amber950, fg: palette.amber300, solid: palette.amber400, glyph: "!", icon: "alert" },
    red: { bg: palette.red950, fg: palette.red300, solid: palette.red400, glyph: "✕", icon: "cancel" },
    new: { bg: palette.slate950, fg: palette.slate300, solid: "#8C97E0", glyph: "✦", icon: "sprout" },
  },
};

/** Initials-avatar fills; each is ≥ 4.5:1 against white initials (tested). */
export const avatarFills = [
  "#4B2FE0",
  "#0072B2",
  "#146B31",
  "#A8141F",
  "#6B4A00",
  "#7A2E8E",
  "#33407A",
  "#00635A",
] as const;

/* ------------------------------------------------------------------ */
/* Spacing, radius, sizing                                              */
/* ------------------------------------------------------------------ */

/** 4-pt grid. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
} as const;
export type SpaceToken = keyof typeof spacing;

export const radius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;
export type RadiusToken = keyof typeof radius;

export const sizing = {
  /** Minimum touch target: 44pt (iOS HIG) / 48dp (Material). We use 48 everywhere. */
  touchTarget: 48,
  touchTargetIos: 44,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  avatarSm: 32,
  avatarMd: 40,
  avatarLg: 56,
  avatarXl: 88,
  pin: 36,
  pinSelected: 44,
  fab: 56,
  /** Breakpoints (dp/px). */
  breakpointMd: 768,
  breakpointLg: 1024,
  breakpointXl: 1440,
  /** Side rail width on wide web. */
  railWidth: 80,
  /** List pane width in map/list split view. */
  splitListWidth: 400,
  maxContentWidth: 720,
} as const;

export const borderWidth = { hairline: 1, regular: 1.5, thick: 2, focus: 3 } as const;

/* ------------------------------------------------------------------ */
/* Typography                                                           */
/* ------------------------------------------------------------------ */

export type FontWeightKey = "regular" | "medium" | "semibold" | "bold";
export const fontWeights: Record<FontWeightKey, "400" | "500" | "600" | "700"> = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};

export type TextVariant =
  | "display"
  | "title1"
  | "title2"
  | "title3"
  | "body"
  | "bodyStrong"
  | "callout"
  | "label"
  | "caption"
  | "overline"
  | "numeric";

export interface TypeSpec {
  fontSize: number;
  lineHeight: number;
  weight: FontWeightKey;
  /** Latin-only tracking (em × size). Ignored for Arabic, Devanagari, CJK. */
  letterSpacing: number;
  /** Cap for dynamic type (allowFontScaling multiplier). */
  maxFontSizeMultiplier: number;
  uppercase?: boolean;
  tabularNums?: boolean;
  /** Semantic heading level for screen readers. */
  headingLevel?: 1 | 2 | 3;
}

export const typography: Record<TextVariant, TypeSpec> = {
  display: {
    fontSize: 32,
    lineHeight: 40,
    weight: "bold",
    letterSpacing: -0.5,
    maxFontSizeMultiplier: 1.4,
    headingLevel: 1,
  },
  title1: {
    fontSize: 26,
    lineHeight: 32,
    weight: "bold",
    letterSpacing: -0.3,
    maxFontSizeMultiplier: 1.5,
    headingLevel: 1,
  },
  title2: {
    fontSize: 22,
    lineHeight: 28,
    weight: "semibold",
    letterSpacing: -0.2,
    maxFontSizeMultiplier: 1.6,
    headingLevel: 2,
  },
  title3: {
    fontSize: 18,
    lineHeight: 24,
    weight: "semibold",
    letterSpacing: 0,
    maxFontSizeMultiplier: 1.8,
    headingLevel: 3,
  },
  body: { fontSize: 16, lineHeight: 24, weight: "regular", letterSpacing: 0, maxFontSizeMultiplier: 2 },
  bodyStrong: { fontSize: 16, lineHeight: 24, weight: "semibold", letterSpacing: 0, maxFontSizeMultiplier: 2 },
  callout: { fontSize: 15, lineHeight: 22, weight: "medium", letterSpacing: 0, maxFontSizeMultiplier: 2 },
  label: { fontSize: 14, lineHeight: 20, weight: "medium", letterSpacing: 0.1, maxFontSizeMultiplier: 1.8 },
  caption: { fontSize: 12, lineHeight: 16, weight: "regular", letterSpacing: 0.2, maxFontSizeMultiplier: 1.8 },
  overline: {
    fontSize: 12,
    lineHeight: 16,
    weight: "bold",
    letterSpacing: 0.8,
    maxFontSizeMultiplier: 1.6,
    uppercase: true,
  },
  numeric: {
    fontSize: 28,
    lineHeight: 34,
    weight: "bold",
    letterSpacing: 0,
    maxFontSizeMultiplier: 1.4,
    tabularNums: true,
  },
};

/* ------------------------------------------------------------------ */
/* Elevation                                                            */
/* ------------------------------------------------------------------ */

export type ElevationLevel = 0 | 1 | 2 | 3 | 4;

export interface ElevationToken {
  /** CSS-style box-shadow (RN ≥ 0.76 New Architecture + react-native-web). */
  boxShadow: string;
  /** In dark mode surfaces get lighter instead of relying on shadow. */
  surface: ColorToken;
  zIndex: number;
}

export const elevation: Record<ColorScheme, Record<ElevationLevel, ElevationToken>> = {
  light: {
    0: { boxShadow: "none", surface: "surface", zIndex: 0 },
    1: {
      boxShadow: "0px 1px 2px rgba(18, 19, 28, 0.08), 0px 1px 3px rgba(18, 19, 28, 0.06)",
      surface: "surface",
      zIndex: 1,
    },
    2: { boxShadow: "0px 4px 12px rgba(18, 19, 28, 0.10)", surface: "surface", zIndex: 10 },
    3: { boxShadow: "0px 8px 24px rgba(18, 19, 28, 0.14)", surface: "surfaceRaised", zIndex: 100 },
    4: { boxShadow: "0px 16px 40px rgba(18, 19, 28, 0.20)", surface: "surfaceRaised", zIndex: 1000 },
  },
  dark: {
    0: { boxShadow: "none", surface: "surface", zIndex: 0 },
    1: { boxShadow: "0px 1px 2px rgba(0, 0, 0, 0.40)", surface: "surface", zIndex: 1 },
    2: { boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.45)", surface: "surfaceRaised", zIndex: 10 },
    3: { boxShadow: "0px 8px 24px rgba(0, 0, 0, 0.55)", surface: "surfaceRaised", zIndex: 100 },
    4: { boxShadow: "0px 16px 40px rgba(0, 0, 0, 0.65)", surface: "surfaceRaised", zIndex: 1000 },
  },
};

/* ------------------------------------------------------------------ */
/* Motion                                                               */
/* ------------------------------------------------------------------ */

export const motion = {
  duration: {
    instant: 0,
    fast: 120,
    base: 200,
    slow: 320,
    sheet: 280,
    /** Host QR rotation period (ms) — matches the server's 30s TOTP step. */
    qrRotation: 30_000,
  },
  /** Cubic-bezier control points [x1, y1, x2, y2] for Easing.bezier / CSS. */
  easing: {
    standard: [0.2, 0, 0, 1] as const,
    enter: [0, 0, 0.2, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
    emphasized: [0.3, 0, 0, 1.15] as const,
  },
  spring: { damping: 22, stiffness: 240, mass: 1 },
  pressedScale: 0.97,
  pressedOpacity: 0.88,
} as const;

/** With reduced motion: durations collapse to `fast` cross-fades, no scale/translate/spring. */
export function motionDuration(key: keyof typeof motion.duration, reducedMotion: boolean): number {
  const d = motion.duration[key];
  if (!reducedMotion || key === "qrRotation") return d;
  return Math.min(d, motion.duration.fast);
}

export const zIndex = { base: 0, sticky: 10, fab: 20, sheet: 30, overlay: 40, modal: 50, toast: 60 } as const;

export const tokens = {
  palette,
  colors,
  sportColors,
  reliabilityColors,
  avatarFills,
  spacing,
  radius,
  sizing,
  borderWidth,
  typography,
  fontWeights,
  elevation,
  motion,
  zIndex,
} as const;
export type Tokens = typeof tokens;
