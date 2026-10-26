/**
 * Sport Talent design tokens — Design Language v2 ("Floodlight").
 *
 * Pure data (no react-native import) so it can be unit-tested in Node and shared with
 * the web shell, e-mail templates and the moderation console.
 * Every text/background pair used by primitives is listed in `contrastPairs` and is
 * verified ≥ WCAG 2.2 AA by `test/tokens.test.ts`. docs/design-system.md §2 explains the system.
 */

/* ------------------------------------------------------------------ */
/* Brand palette (raw). Components never use these directly.           */
/* ------------------------------------------------------------------ */

export const palette = {
  // "Electric Indigo": trust, depth, brand. Hue ≈ 250°.
  indigo50: "#EFEDFF",
  indigo100: "#E0DBFF",
  indigo200: "#C7BEFF",
  indigo300: "#AA9DFF",
  indigo400: "#8F7DFF",
  indigo500: "#5B3DF5",
  indigo600: "#4A2BE6",
  indigo700: "#3C1FC7",
  indigo800: "#2B1890",
  indigo900: "#221A55",
  indigo950: "#17123A",
  // "Volt": energy. A fill only, always with ink content on it.
  volt300: "#E1FF66",
  volt400: "#CCFF33",
  volt500: "#B8F000",
  // Ink neutrals tinted toward the brand hue (never pure grey).
  ink975: "#08071A",
  ink950: "#0B0A1C",
  ink900: "#121129",
  ink850: "#17162E",
  ink800: "#1F1E3A",
  ink750: "#100F24",
  ink700: "#2C2B4A",
  ink600: "#6E6D92",
  ink500: "#8B8AAE",
  ink450: "#9897B9",
  ink400: "#5F5E80",
  ink350: "#4A4968",
  ink300: "#B9B8D4",
  ink200: "#E3E2EE",
  ink150: "#EAE9F3",
  ink100: "#EFEEF6",
  ink50: "#F6F6FB",
  ink25: "#F4F4FA",
  white: "#FFFFFF",
  // Semantic hues
  red700: "#B3121F",
  red600: "#D11F2D",
  red400: "#FF6B76",
  red300: "#FF97A0",
  red50: "#FFE9EB",
  red950: "#3D1219",
  green700: "#0E6B37",
  green600: "#11803F",
  green400: "#3FD98A",
  green300: "#74EBA9",
  green50: "#E2F7EA",
  green950: "#0D3020",
  amber800: "#6E4700",
  amber500: "#FFB21E",
  amber400: "#FFC24D",
  amber300: "#FFD685",
  amber50: "#FFF3D6",
  amber950: "#35270A",
  sky700: "#0857B0",
  sky600: "#0A5FC2",
  sky400: "#6CB6FF",
  sky300: "#9CCBFF",
  sky50: "#E3EFFD",
  sky950: "#0D2442",
  slate800: "#363F7D",
  slate300: "#BAC2FF",
  slate50: "#E9EBF8",
  slate950: "#1E2140",
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
  /** Inputs, segmented tracks, chips, skeletons. */
  surfaceSunken: string;
  /** Toasts, tooltips, cluster markers. */
  surfaceInverse: string;
  /** Translucent bar background (tab bar / header over content), used with blur. */
  surfaceGlass: string;
  text: string;
  /** Alias of `text` (v2 name used by Icon color props). */
  textPrimary: string;
  textSecondary: string;
  /** Placeholder, helper text, timestamps. Still ≥ 4.5:1 (placeholder is informational). */
  textTertiary: string;
  textInverse: string;
  /** White text/glyphs over sport gradients and photos (fixed in both schemes). */
  textOnMedia: string;
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
  accentPressed: string;
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
  /** Skeleton base. */
  skeleton: string;
  /** Skeleton shimmer highlight. */
  skeletonHighlight: string;
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
  surfaceGlass: "rgba(255, 255, 255, 0.82)",
  text: palette.ink900,
  textPrimary: palette.ink900,
  textSecondary: palette.ink350,
  textTertiary: palette.ink400,
  textInverse: palette.ink25,
  textOnMedia: palette.white,
  border: palette.ink200,
  borderStrong: palette.ink500,
  primary: palette.indigo500,
  primaryPressed: palette.indigo700,
  onPrimary: palette.white,
  primarySubtle: palette.indigo50,
  onPrimarySubtle: palette.indigo700,
  primaryText: palette.indigo600,
  accent: palette.volt400,
  accentPressed: palette.volt500,
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
  info: palette.sky600,
  infoSubtle: palette.sky50,
  infoText: palette.sky700,
  focusRing: palette.indigo500,
  scrim: "rgba(11, 10, 28, 0.48)",
  skeleton: palette.ink100,
  skeletonHighlight: palette.ink25,
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
  surfaceGlass: "rgba(23, 22, 46, 0.78)",
  text: palette.ink25,
  textPrimary: palette.ink25,
  textSecondary: palette.ink300,
  textTertiary: palette.ink450,
  textInverse: palette.ink900,
  textOnMedia: palette.white,
  border: palette.ink700,
  borderStrong: palette.ink600,
  primary: palette.indigo400,
  primaryPressed: palette.indigo300,
  onPrimary: palette.ink975,
  primarySubtle: palette.indigo900,
  onPrimarySubtle: palette.indigo200,
  primaryText: palette.indigo300,
  accent: palette.volt400,
  accentPressed: palette.volt300,
  onAccent: palette.ink975,
  danger: palette.red400,
  dangerPressed: palette.red300,
  onDanger: palette.ink975,
  dangerSubtle: palette.red950,
  dangerText: palette.red300,
  success: palette.green400,
  onSuccess: palette.ink975,
  successSubtle: palette.green950,
  successText: palette.green300,
  warning: palette.amber400,
  onWarning: palette.ink975,
  warningSubtle: palette.amber950,
  warningText: palette.amber300,
  info: palette.sky400,
  infoSubtle: palette.sky950,
  infoText: palette.sky300,
  focusRing: palette.indigo400,
  scrim: "rgba(0, 0, 0, 0.62)",
  skeleton: palette.ink800,
  skeletonHighlight: palette.ink700,
  disabledBg: palette.ink800,
  disabledText: palette.ink450,
  pinRing: palette.white,
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
  { fg: "text", bg: "surfaceSunken", min: 4.5, use: "input text / chip label" },
  { fg: "textSecondary", bg: "background", min: 4.5, use: "secondary text on canvas" },
  { fg: "textSecondary", bg: "surface", min: 4.5, use: "secondary text on cards" },
  { fg: "textSecondary", bg: "surfaceRaised", min: 4.5, use: "secondary text on sheets" },
  { fg: "textSecondary", bg: "surfaceSunken", min: 4.5, use: "unselected segment label" },
  { fg: "textTertiary", bg: "surface", min: 4.5, use: "placeholder/helper" },
  { fg: "textTertiary", bg: "background", min: 4.5, use: "timestamps on canvas" },
  { fg: "textTertiary", bg: "surfaceRaised", min: 4.5, use: "helper on sheets" },
  { fg: "textTertiary", bg: "surfaceSunken", min: 4.5, use: "placeholder in sunken input" },
  { fg: "textInverse", bg: "surfaceInverse", min: 4.5, use: "toast / cluster count" },
  { fg: "onPrimary", bg: "primary", min: 4.5, use: "primary button label" },
  { fg: "onPrimary", bg: "primaryPressed", min: 4.5, use: "primary button pressed" },
  { fg: "onPrimarySubtle", bg: "primarySubtle", min: 4.5, use: "tonal button / selected chip label" },
  { fg: "primaryText", bg: "surface", min: 4.5, use: "link / ghost button" },
  { fg: "primaryText", bg: "background", min: 4.5, use: "link on canvas" },
  { fg: "onAccent", bg: "accent", min: 4.5, use: "volt FAB / badge" },
  { fg: "onAccent", bg: "accentPressed", min: 4.5, use: "volt pressed" },
  { fg: "onDanger", bg: "danger", min: 4.5, use: "danger button" },
  { fg: "onDanger", bg: "dangerPressed", min: 4.5, use: "danger pressed" },
  { fg: "dangerText", bg: "surface", min: 4.5, use: "error message" },
  { fg: "dangerText", bg: "dangerSubtle", min: 4.5, use: "error banner" },
  { fg: "onSuccess", bg: "success", min: 4.5, use: "success button" },
  { fg: "successText", bg: "successSubtle", min: 4.5, use: "success banner" },
  { fg: "successText", bg: "surface", min: 4.5, use: "checked-in label" },
  { fg: "onWarning", bg: "warning", min: 4.5, use: "warning fill" },
  { fg: "warningText", bg: "warningSubtle", min: 4.5, use: "warning banner" },
  { fg: "infoText", bg: "infoSubtle", min: 4.5, use: "info banner" },
  { fg: "infoText", bg: "surface", min: 4.5, use: "info text" },
  { fg: "disabledText", bg: "disabledBg", min: 3, use: "disabled (exempt, kept legible)" },
  { fg: "borderStrong", bg: "surface", min: 3, use: "input outline" },
  { fg: "borderStrong", bg: "background", min: 3, use: "chip outline on canvas" },
  { fg: "focusRing", bg: "background", min: 3, use: "focus indicator" },
  { fg: "focusRing", bg: "surface", min: 3, use: "focus indicator on cards" },
  { fg: "primary", bg: "surface", min: 3, use: "active tab icon / progress ring" },
  { fg: "pinOutline", bg: "mapBase", min: 3, use: "map pin outline vs tiles" },
];

/* ------------------------------------------------------------------ */
/* Sports                                                               */
/* ------------------------------------------------------------------ */

export type SportKey = "football" | "basketball" | "tennis" | "padel" | "running" | "volleyball";
export type PinShape = "circle" | "square" | "diamond" | "shield" | "pill" | "capsule";

/** Phosphor component names used for each sport (see `src/icons/registry.ts`). */
export type SportIconName = "SoccerBall" | "Basketball" | "TennisBall" | "Racquet" | "PersonSimpleRun" | "Volleyball";

export interface SportToken {
  key: SportKey;
  /** v2 marker fill. White glyph on it is ≥ 3:1 (WCAG 1.4.11 graphic). */
  color: string;
  /** Glyph color on `color` (v2: always white). */
  on: string;
  /** Gradient stops for hero bands: white text ≥ 4.5:1 on both. */
  gradient: readonly [string, string];
  /** Sport-colored text (labels, chips) on `tint` and on surface: ≥ 4.5:1. */
  text: string;
  /** Light tinted background (chips, icon wells) in light mode. */
  tint: string;
  /** Tinted background in dark mode. */
  tintDark: string;
  /** Sport-colored text on `tintDark` in dark mode (≥ 4.5:1). */
  textDark: string;
  /** Phosphor icon (the primary, non-color identity cue). */
  phosphor: SportIconName;
  /** @deprecated v1 silhouette for `PinBadge`/`SportDot`. v2 markers are teardrops; identity = glyph. */
  shape: PinShape;
  /** @deprecated v1 emoji fallback glyph. */
  glyph: string;
  /** @deprecated v1 MaterialCommunityIcons name (app `Icon` until it migrates to Phosphor). */
  icon: string;
}

export const sportColors: Record<SportKey, SportToken> = {
  football: {
    key: "football",
    color: "#00A846",
    on: "#FFFFFF",
    gradient: ["#008738", "#006649"],
    text: "#007832",
    tint: "#E0FFED",
    tintDark: "#104125",
    textDark: "#70FFAC",
    phosphor: "SoccerBall",
    shape: "circle",
    glyph: "⚽",
    icon: "soccer",
  },
  basketball: {
    key: "basketball",
    color: "#FF5E1A",
    on: "#FFFFFF",
    gradient: ["#D43F00", "#B31100"],
    text: "#BD3800",
    tint: "#FFE9E0",
    tintDark: "#411F10",
    textDark: "#FF9B70",
    phosphor: "Basketball",
    shape: "square",
    glyph: "🏀",
    icon: "basketball",
  },
  tennis: {
    key: "tennis",
    color: "#72A008",
    on: "#FFFFFF",
    gradient: ["#5A7E06", "#166602"],
    text: "#507006",
    tint: "#F5FEE2",
    tintDark: "#323F13",
    textDark: "#D1F877",
    phosphor: "TennisBall",
    shape: "diamond",
    glyph: "🎾",
    icon: "tennis",
  },
  padel: {
    key: "padel",
    color: "#6E89F7",
    on: "#FFFFFF",
    gradient: ["#4568F5", "#3D2FF9"],
    text: "#2D54F3",
    tint: "#E2E7FD",
    tintDark: "#131C3F",
    textDark: "#8FA4FA",
    phosphor: "Racquet",
    shape: "shield",
    glyph: "🏓",
    icon: "racquetball",
  },
  running: {
    key: "running",
    color: "#E56CA2",
    on: "#FFFFFF",
    gradient: ["#D92877", "#A3177F"],
    text: "#C12269",
    tint: "#FAE5EF",
    tintDark: "#3A1827",
    textDark: "#EA86B2",
    phosphor: "PersonSimpleRun",
    shape: "pill",
    glyph: "🏃",
    icon: "run-fast",
  },
  volleyball: {
    key: "volleyball",
    color: "#0B9FD0",
    on: "#FFFFFF",
    gradient: ["#097EA5", "#0554B5"],
    text: "#086F91",
    tint: "#E2F7FD",
    tintDark: "#13343F",
    textDark: "#77D8F8",
    phosphor: "Volleyball",
    shape: "capsule",
    glyph: "🏐",
    icon: "volleyball",
  },
};

export const sportKeys = Object.keys(sportColors) as SportKey[];

/** Max sports selectable in the map filter at once (PRD §2). */
export const MAX_SPORT_FILTERS = 3;
/** Radius choices for the map (km). */
export const RADIUS_OPTIONS_KM = [1, 2, 5, 10, 30, 50] as const;

/* ------------------------------------------------------------------ */
/* Gradients                                                            */
/* ------------------------------------------------------------------ */

export type GradientName = "brand" | "brandNight" | "volt" | "live" | "scrimBottom" | SportKey;

export interface GradientToken {
  colors: readonly [string, string, ...string[]];
  /** Logical start/end in unit space (x flips in RTL for horizontal gradients). */
  start: { x: number; y: number };
  end: { x: number; y: number };
}

const diagonal = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };

export const gradients: Record<GradientName, GradientToken> = {
  /** Primary brand moments: auth hero, brand header, success. White text ≥ 4.5 on every stop. */
  brand: { colors: ["#5B3DF5", "#3C1FC7"], ...diagonal },
  /** Night stadium: dark hero panels (works in both schemes). */
  brandNight: { colors: ["#221A55", "#0B0A1C"], start: { x: 0, y: 0 }, end: { x: 0.4, y: 1 } },
  /** Volt sheen for the FAB / celebration (ink content on it). */
  volt: { colors: ["#E1FF66", "#B8F000"], ...diagonal },
  /** Live indicator glow. */
  live: { colors: ["#CCFF33", "#00A846"], ...diagonal },
  /** Bottom scrim over imagery so white text stays legible. */
  scrimBottom: { colors: ["rgba(11, 10, 28, 0)", "rgba(11, 10, 28, 0.72)"], start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
  football: { colors: sportColors.football.gradient, ...diagonal },
  basketball: { colors: sportColors.basketball.gradient, ...diagonal },
  tennis: { colors: sportColors.tennis.gradient, ...diagonal },
  padel: { colors: sportColors.padel.gradient, ...diagonal },
  running: { colors: sportColors.running.gradient, ...diagonal },
  volleyball: { colors: sportColors.volleyball.gradient, ...diagonal },
};

/* ------------------------------------------------------------------ */
/* Reliability status                                                   */
/* ------------------------------------------------------------------ */

export type ReliabilityStatus = "green" | "yellow" | "red" | "new";

export interface ReliabilityToken {
  /** Tinted badge background. */
  bg: string;
  /** Label + glyph color on `bg` (≥ 4.5:1). */
  fg: string;
  /** Solid dot / meter / ring fill (≥ 3:1 on surface). */
  solid: string;
  /** Text glyph fallback — never color alone. */
  glyph: string;
  /** @deprecated v1 MaterialCommunityIcons name. */
  icon: string;
  /** Phosphor icon shown with the label. */
  phosphor: "ShieldCheck" | "Warning" | "Prohibit" | "Sparkle";
}

export const reliabilityColors: Record<ColorScheme, Record<ReliabilityStatus, ReliabilityToken>> = {
  light: {
    green: { bg: palette.green50, fg: palette.green700, solid: palette.green600, glyph: "✓", icon: "shield-check", phosphor: "ShieldCheck" },
    yellow: { bg: palette.amber50, fg: palette.amber800, solid: "#B27600", glyph: "!", icon: "alert", phosphor: "Warning" },
    red: { bg: palette.red50, fg: palette.red700, solid: palette.red600, glyph: "✕", icon: "cancel", phosphor: "Prohibit" },
    new: { bg: palette.slate50, fg: palette.slate800, solid: "#5B66A8", glyph: "✦", icon: "sprout", phosphor: "Sparkle" },
  },
  dark: {
    green: { bg: palette.green950, fg: palette.green300, solid: palette.green400, glyph: "✓", icon: "shield-check", phosphor: "ShieldCheck" },
    yellow: { bg: palette.amber950, fg: palette.amber300, solid: palette.amber400, glyph: "!", icon: "alert", phosphor: "Warning" },
    red: { bg: palette.red950, fg: palette.red300, solid: palette.red400, glyph: "✕", icon: "cancel", phosphor: "Prohibit" },
    new: { bg: palette.slate950, fg: palette.slate300, solid: "#8C97E0", glyph: "✦", icon: "sprout", phosphor: "Sparkle" },
  },
};

/** Initials-avatar fills (brand-adjacent jewel tones); each is ≥ 4.5:1 against white initials (tested). */
export const avatarFills = [
  "#4A2BE6",
  "#0A5FC2",
  "#0E6B37",
  "#B3121F",
  "#8A4B00",
  "#7A2E8E",
  "#363F7D",
  "#00635A",
] as const;

/* ------------------------------------------------------------------ */
/* Spacing, radius, sizing                                              */
/* ------------------------------------------------------------------ */

/** 4-pt grid (xxs 2 is the only half step, for hairline nudges). */
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

/** Generous but not bubbly: cards 20, sheets 28, controls 14, chips pill. */
export const radius = {
  none: 0,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;
export type RadiusToken = keyof typeof radius;

/** Icon sizes (Phosphor). 16 inline-with-caption · 20 inline/list · 24 nav/actions · 28 hero/tab-active. */
export const iconSizes = { xs: 16, sm: 20, md: 24, lg: 28 } as const;
export type IconSizeToken = keyof typeof iconSizes;

export const sizing = {
  /** Minimum touch target: 44pt (iOS HIG) / 48dp (Material). We use 48 everywhere. */
  touchTarget: 48,
  touchTargetIos: 44,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  iconXl: 28,
  avatarXs: 24,
  avatarSm: 32,
  avatarMd: 40,
  avatarLg: 56,
  avatarXl: 88,
  pin: 36,
  pinSelected: 44,
  /** v2 teardrop marker (width × height = pinMarker × pinMarker·1.25). */
  pinMarker: 40,
  pinMarkerSelected: 52,
  fab: 56,
  buttonSm: 36,
  buttonMd: 48,
  buttonLg: 56,
  inputHeight: 52,
  listRow: 56,
  tabBar: 64,
  headerCompact: 52,
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

export type FontWeightKey = "regular" | "medium" | "semibold" | "bold" | "heavy";
export const fontWeights: Record<FontWeightKey, "400" | "500" | "600" | "700" | "800"> = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  heavy: "800",
};

export type TextVariant =
  | "display"
  | "largeTitle"
  | "title1"
  | "title2"
  | "title3"
  | "headline"
  | "body"
  | "bodyStrong"
  | "callout"
  | "label"
  | "footnote"
  | "caption"
  | "overline"
  | "numeric"
  | "statLarge"
  | "statSmall";

export interface TypeSpec {
  fontSize: number;
  lineHeight: number;
  weight: FontWeightKey;
  /** Latin-only tracking (px). Ignored for Hebrew, Arabic, Devanagari, CJK. */
  letterSpacing: number;
  /** Cap for dynamic type (allowFontScaling multiplier). */
  maxFontSizeMultiplier: number;
  uppercase?: boolean;
  tabularNums?: boolean;
  /** Semantic heading level for screen readers. */
  headingLevel?: 1 | 2 | 3;
}

/** Rubik scale (major-third-ish, 4pt line grid). */
export const typography: Record<TextVariant, TypeSpec> = {
  display: { fontSize: 40, lineHeight: 44, weight: "heavy", letterSpacing: -1, maxFontSizeMultiplier: 1.3, headingLevel: 1 },
  largeTitle: { fontSize: 32, lineHeight: 38, weight: "bold", letterSpacing: -0.6, maxFontSizeMultiplier: 1.4, headingLevel: 1 },
  title1: { fontSize: 26, lineHeight: 32, weight: "bold", letterSpacing: -0.4, maxFontSizeMultiplier: 1.5, headingLevel: 1 },
  title2: { fontSize: 21, lineHeight: 28, weight: "semibold", letterSpacing: -0.2, maxFontSizeMultiplier: 1.6, headingLevel: 2 },
  title3: { fontSize: 18, lineHeight: 24, weight: "semibold", letterSpacing: -0.1, maxFontSizeMultiplier: 1.8, headingLevel: 3 },
  headline: { fontSize: 16, lineHeight: 22, weight: "semibold", letterSpacing: 0, maxFontSizeMultiplier: 2 },
  body: { fontSize: 16, lineHeight: 24, weight: "regular", letterSpacing: 0, maxFontSizeMultiplier: 2 },
  bodyStrong: { fontSize: 16, lineHeight: 24, weight: "medium", letterSpacing: 0, maxFontSizeMultiplier: 2 },
  callout: { fontSize: 15, lineHeight: 22, weight: "regular", letterSpacing: 0, maxFontSizeMultiplier: 2 },
  label: { fontSize: 14, lineHeight: 20, weight: "medium", letterSpacing: 0.1, maxFontSizeMultiplier: 1.8 },
  footnote: { fontSize: 13, lineHeight: 18, weight: "regular", letterSpacing: 0.1, maxFontSizeMultiplier: 1.8 },
  caption: { fontSize: 12, lineHeight: 16, weight: "regular", letterSpacing: 0.2, maxFontSizeMultiplier: 1.8 },
  overline: { fontSize: 12, lineHeight: 16, weight: "semibold", letterSpacing: 1, maxFontSizeMultiplier: 1.6, uppercase: true },
  numeric: { fontSize: 28, lineHeight: 34, weight: "bold", letterSpacing: -0.4, maxFontSizeMultiplier: 1.4, tabularNums: true },
  statLarge: { fontSize: 44, lineHeight: 48, weight: "heavy", letterSpacing: -1.2, maxFontSizeMultiplier: 1.3, tabularNums: true },
  statSmall: { fontSize: 17, lineHeight: 22, weight: "semibold", letterSpacing: -0.1, maxFontSizeMultiplier: 1.6, tabularNums: true },
};

/* ------------------------------------------------------------------ */
/* Elevation                                                            */
/* ------------------------------------------------------------------ */

export type ElevationLevel = 0 | 1 | 2 | 3 | 4;

export interface ElevationToken {
  /** CSS-style layered box-shadow (RN ≥ 0.76 New Architecture + react-native-web). */
  boxShadow: string;
  /** In dark mode surfaces get lighter instead of relying on shadow. */
  surface: ColorToken;
  /** Dark mode: hairline border that separates the surface (null = none). */
  border: ColorToken | null;
  zIndex: number;
}

/** Light: soft layered (key + ambient) shadows tinted with ink. Dark: lighter surfaces + hairline borders. */
export const elevation: Record<ColorScheme, Record<ElevationLevel, ElevationToken>> = {
  light: {
    0: { boxShadow: "none", surface: "surface", border: null, zIndex: 0 },
    1: {
      boxShadow: "0px 1px 2px rgba(18, 17, 41, 0.05), 0px 4px 12px rgba(18, 17, 41, 0.06)",
      surface: "surface",
      border: null,
      zIndex: 1,
    },
    2: {
      boxShadow: "0px 2px 4px rgba(18, 17, 41, 0.05), 0px 10px 24px rgba(18, 17, 41, 0.10)",
      surface: "surface",
      border: null,
      zIndex: 10,
    },
    3: {
      boxShadow: "0px 4px 10px rgba(18, 17, 41, 0.06), 0px 18px 44px rgba(18, 17, 41, 0.16)",
      surface: "surfaceRaised",
      border: null,
      zIndex: 100,
    },
    4: {
      boxShadow: "0px 8px 16px rgba(18, 17, 41, 0.08), 0px 28px 72px rgba(18, 17, 41, 0.24)",
      surface: "surfaceRaised",
      border: null,
      zIndex: 1000,
    },
  },
  dark: {
    0: { boxShadow: "none", surface: "surface", border: null, zIndex: 0 },
    1: { boxShadow: "none", surface: "surface", border: "border", zIndex: 1 },
    2: { boxShadow: "0px 8px 24px rgba(0, 0, 0, 0.36)", surface: "surfaceRaised", border: "border", zIndex: 10 },
    3: { boxShadow: "0px 16px 40px rgba(0, 0, 0, 0.48)", surface: "surfaceRaised", border: "border", zIndex: 100 },
    4: { boxShadow: "0px 24px 64px rgba(0, 0, 0, 0.60)", surface: "surfaceRaised", border: "border", zIndex: 1000 },
  },
};

/* ------------------------------------------------------------------ */
/* Motion                                                               */
/* ------------------------------------------------------------------ */

export interface SpringPreset {
  damping: number;
  stiffness: number;
  mass: number;
}

export const motion = {
  duration: {
    instant: 0,
    fast: 120,
    base: 200,
    slow: 320,
    sheet: 280,
    shimmer: 1400,
    toast: 4000,
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
  /** Spring presets (Animated.spring / Reanimated withSpring). */
  springs: {
    /** Press feedback: fast, no visible overshoot. */
    press: { damping: 26, stiffness: 520, mass: 0.7 },
    /** Selection (chip, segment thumb, tab pill). */
    snappy: { damping: 22, stiffness: 380, mass: 0.9 },
    /** Sheets, cards entering. */
    gentle: { damping: 24, stiffness: 220, mass: 1 },
    /** Celebrations (check-in success, pin select): a little bounce. */
    bouncy: { damping: 12, stiffness: 260, mass: 0.9 },
  } satisfies Record<string, SpringPreset>,
  /** @deprecated v1 single spring; use `springs.gentle`. */
  spring: { damping: 22, stiffness: 240, mass: 1 },
  pressedScale: 0.97,
  /** Large surfaces (cards) scale less. */
  pressedScaleCard: 0.985,
  pressedOpacity: 0.88,
} as const;

/** With reduced motion: durations collapse to `fast` cross-fades, no scale/translate/spring. */
export function motionDuration(key: keyof typeof motion.duration, reducedMotion: boolean): number {
  const d = motion.duration[key];
  if (!reducedMotion || key === "qrRotation" || key === "toast") return d;
  return Math.min(d, motion.duration.fast);
}

/* ------------------------------------------------------------------ */
/* Haptics                                                              */
/* ------------------------------------------------------------------ */

export type HapticKind = "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "error" | "none";

/** Which action gets which haptic (docs §8). Web is always silent. */
export const hapticMap = {
  tabChange: "selection",
  chipToggle: "selection",
  segmentChange: "selection",
  pinSelect: "selection",
  sheetDetent: "light",
  buttonPrimary: "light",
  fab: "medium",
  joinGame: "medium",
  checkInSuccess: "success",
  publishGame: "success",
  resultSubmitted: "success",
  limitReached: "warning",
  destructiveConfirm: "warning",
  actionFailed: "error",
  pullToRefresh: "light",
  scorePlusMinus: "selection",
} as const satisfies Record<string, HapticKind>;
export type HapticEvent = keyof typeof hapticMap;

export const zIndex = { base: 0, sticky: 10, fab: 20, sheet: 30, overlay: 40, modal: 50, toast: 60 } as const;

export const tokens = {
  palette,
  colors,
  sportColors,
  gradients,
  reliabilityColors,
  avatarFills,
  spacing,
  radius,
  sizing,
  iconSizes,
  borderWidth,
  typography,
  fontWeights,
  elevation,
  motion,
  hapticMap,
  zIndex,
} as const;
export type Tokens = typeof tokens;
