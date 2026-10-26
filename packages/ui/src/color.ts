/**
 * Pure color math used by tokens, tests and docs.
 * No react-native imports here: this file must run in plain Node (vitest).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha ignored). */
export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6 && h.length !== 8) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) throw new Error(`Invalid hex color: ${hex}`);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, c * 255));
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.x contrast ratio (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick black-ish or white-ish foreground with the best contrast on `bg`. */
export function bestOn(bg: string, dark = "#0A0B12", light = "#FFFFFF"): string {
  return contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light;
}

/** CIE L*a*b* (D65). */
export function hexToLab(hex: string): { l: number; a: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

function rgbToLab(r8: number, g8: number, b8: number): { l: number; a: number; b: number } {
  const r = srgbToLinear(r8);
  const g = srgbToLinear(g8);
  const b = srgbToLinear(b8);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 delta E. > ~10 is clearly distinguishable at pin sizes; > 20 is very distinct. */
export function deltaE(a: string, b: string): number {
  const la = hexToLab(a);
  const lb = hexToLab(b);
  return Math.hypot(la.l - lb.l, la.a - lb.a, la.b - lb.b);
}

export type ColorVisionDeficiency = "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";

/**
 * Machado, Oliveira & Fernandes (2009) simulation matrices at severity 1.0,
 * applied in linear RGB. Achromatopsia = luminance only.
 */
const CVD_MATRICES: Record<Exclude<ColorVisionDeficiency, "achromatopsia">, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

export function simulateCvd(hex: string, type: ColorVisionDeficiency): string {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  if (type === "achromatopsia") {
    const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    const v = linearToSrgb(y);
    return rgbToHex({ r: v, g: v, b: v });
  }
  const m = CVD_MATRICES[type];
  const at = (i: number) => m[i] ?? 0;
  const nr = at(0) * lr + at(1) * lg + at(2) * lb;
  const ng = at(3) * lr + at(4) * lg + at(5) * lb;
  const nb = at(6) * lr + at(7) * lg + at(8) * lb;
  return rgbToHex({ r: linearToSrgb(nr), g: linearToSrgb(ng), b: linearToSrgb(nb) });
}

/** `#RRGGBB` + alpha (0..1) → `rgba()` string usable on every platform. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}
