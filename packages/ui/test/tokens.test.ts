import { describe, expect, it } from "vitest";

import { contrastRatio, deltaE, simulateCvd } from "../src/color";
import {
  avatarFills,
  colors,
  contrastPairs,
  elevation,
  gradients,
  hapticMap,
  iconSizes,
  motion,
  motionDuration,
  RADIUS_OPTIONS_KM,
  MAX_SPORT_FILTERS,
  radius,
  reliabilityColors,
  sportColors,
  sportKeys,
  spacing,
  sizing,
  typography,
  type ColorScheme,
} from "../src/tokens";

const schemes: ColorScheme[] = ["light", "dark"];
const WHITE = "#FFFFFF";

describe("color math", () => {
  it("matches known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1 AA threshold color
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 1);
  });
});

describe.each(schemes)("v2 semantic colors (%s) meet WCAG 2.2 AA", (scheme) => {
  const c = colors[scheme];
  it.each(contrastPairs.map((p) => [p.fg, p.bg, p.min, p.use] as const))("%s on %s ≥ %d (%s)", (fg, bg, min) => {
    const ratio = contrastRatio(c[fg], c[bg]);
    expect(ratio, `${scheme} ${fg} ${c[fg]} on ${bg} ${c[bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
  });

  it("every token is a valid #RRGGBB or rgba() color", () => {
    for (const [k, v] of Object.entries(c)) {
      expect(v, k).toMatch(/^(#[0-9A-Fa-f]{6}|rgba\(.+\))$/);
    }
  });

  it("textPrimary is an alias of text", () => {
    expect(c.textPrimary).toBe(c.text);
  });

  it("neutrals are tinted toward the brand (blue channel leads, never pure grey)", () => {
    for (const k of ["background", "surfaceSunken", "text", "textSecondary", "border"] as const) {
      const hex = c[k].slice(1);
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
      expect(b, `${k} ${c[k]}`).toBeGreaterThanOrEqual(Math.max(r, g));
      expect(r === g && g === b, `${k} is pure grey`).toBe(false);
    }
  });

  it("has an elevation scale with increasing zIndex", () => {
    const z = [0, 1, 2, 3, 4].map((l) => elevation[scheme][l as 0 | 1 | 2 | 3 | 4].zIndex);
    expect([...z].sort((a, b) => a - b)).toEqual(z);
  });
});

describe("elevation model", () => {
  it("light uses layered (≥ 2) shadows; dark uses borders", () => {
    for (const l of [1, 2, 3, 4] as const) {
      expect(elevation.light[l].boxShadow.split("),").length, `light ${l}`).toBeGreaterThanOrEqual(2);
      expect(elevation.dark[l].border, `dark ${l}`).toBe("border");
    }
  });
});

describe.each(schemes)("reliability colors (%s)", (scheme) => {
  const r = reliabilityColors[scheme];
  const surface = colors[scheme].surface;
  it.each(Object.entries(r))("%s label ≥ 4.5 on its badge and solid ≥ 3 on surface", (_k, t) => {
    expect(contrastRatio(t.fg, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.fg, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.solid, surface)).toBeGreaterThanOrEqual(3);
  });
  it("never relies on color alone: every status has a unique glyph and icon", () => {
    const glyphs = Object.values(r).map((t) => t.glyph);
    const icons = Object.values(r).map((t) => t.phosphor);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("sport tokens (v2)", () => {
  it("covers the six launch sports", () => {
    expect([...sportKeys].sort()).toEqual(["basketball", "football", "padel", "running", "tennis", "volleyball"]);
  });

  it.each(sportKeys)("%s: white glyph ≥ 3:1 on the marker fill (graphic, WCAG 1.4.11)", (k) => {
    const t = sportColors[k];
    expect(t.on).toBe(WHITE);
    expect(contrastRatio(t.on, t.color)).toBeGreaterThanOrEqual(3);
  });

  it.each(sportKeys)("%s: white text ≥ 4.5:1 on both gradient stops", (k) => {
    for (const stop of sportColors[k].gradient) expect(contrastRatio(WHITE, stop), stop).toBeGreaterThanOrEqual(4.5);
  });

  it.each(sportKeys)("%s: sport text ≥ 4.5:1 on its tint and on surfaces (both schemes)", (k) => {
    const t = sportColors[k];
    expect(contrastRatio(t.text, t.tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.text, colors.light.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.textDark, t.tintDark)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.textDark, colors.dark.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses a unique Phosphor icon and color per sport (the icon is the primary non-color cue)", () => {
    const v = Object.values(sportColors);
    for (const field of ["phosphor", "color", "icon"] as const) {
      expect(new Set(v.map((t) => t[field])).size, field).toBe(v.length);
    }
  });

  const pairs: [string, string, string, string][] = [];
  for (let i = 0; i < sportKeys.length; i++) {
    for (let j = i + 1; j < sportKeys.length; j++) {
      const a = sportKeys[i]!;
      const b = sportKeys[j]!;
      pairs.push([a, b, sportColors[a].color, sportColors[b].color]);
    }
  }

  it.each(pairs)("%s vs %s are distinct in normal vision (ΔE ≥ 25)", (_a, _b, ca, cb) => {
    expect(deltaE(ca, cb)).toBeGreaterThanOrEqual(25);
  });

  it.each(["protanopia", "deuteranopia", "tritanopia"] as const)(
    "all pairs stay separable under %s (ΔE ≥ 12; the glyph carries identity)",
    (cvd) => {
      for (const [a, b, ca, cb] of pairs) {
        const d = deltaE(simulateCvd(ca, cvd), simulateCvd(cb, cvd));
        expect(d, `${a}/${b} under ${cvd}`).toBeGreaterThanOrEqual(12);
      }
    },
  );

  it("pin outline separates every fill from map tiles (≥ 3:1)", () => {
    for (const scheme of schemes) {
      const c = colors[scheme];
      expect(contrastRatio(c.pinOutline, c.mapBase)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("gradients", () => {
  it("has a gradient per sport that matches the sport token", () => {
    for (const k of sportKeys) expect(gradients[k].colors).toEqual(sportColors[k].gradient);
  });
  it("brand gradient keeps white text ≥ 4.5:1", () => {
    for (const stop of gradients.brand.colors) expect(contrastRatio(WHITE, stop)).toBeGreaterThanOrEqual(4.5);
    for (const stop of gradients.brandNight.colors) expect(contrastRatio(WHITE, stop)).toBeGreaterThanOrEqual(4.5);
  });
  it("volt gradient keeps ink content ≥ 4.5:1", () => {
    for (const stop of gradients.volt.colors) expect(contrastRatio(colors.light.onAccent, stop)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("type scale", () => {
  it("stats use tabular numerals", () => {
    for (const v of ["numeric", "statLarge", "statSmall"] as const) expect(typography[v].tabularNums).toBe(true);
  });
  it("line heights sit on a 2pt grid and are ≥ 1.1× size", () => {
    for (const [k, t] of Object.entries(typography)) {
      expect(t.lineHeight % 2, k).toBe(0);
      expect(t.lineHeight / t.fontSize, k).toBeGreaterThanOrEqual(1.09);
    }
  });
  it("body text is never below 16 and captions never below 12", () => {
    expect(typography.body.fontSize).toBe(16);
    for (const t of Object.values(typography)) expect(t.fontSize).toBeGreaterThanOrEqual(12);
  });
});

describe("other scales", () => {
  it("avatar fills keep white initials ≥ 4.5:1", () => {
    for (const f of avatarFills) expect(contrastRatio(f, "#FFFFFF"), f).toBeGreaterThanOrEqual(4.5);
  });

  it("spacing is on a 4pt grid (xxs 2 is the only half step) and ascending", () => {
    const v = Object.values(spacing);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
    for (const [k, n] of Object.entries(spacing)) if (k !== "xxs") expect(n % 4, k).toBe(0);
  });

  it("radii are generous but bounded (cards 20, sheets 28)", () => {
    expect(radius.lg).toBe(20);
    expect(radius.xl).toBe(28);
    const v = Object.values(radius);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
  });

  it("icon sizes are 16/20/24/28", () => {
    expect(Object.values(iconSizes)).toEqual([16, 20, 24, 28]);
  });

  it("touch target is at least 48dp (≥ 44pt iOS)", () => {
    expect(sizing.touchTarget).toBeGreaterThanOrEqual(48);
    expect(sizing.touchTargetIos).toBeGreaterThanOrEqual(44);
  });

  it("map constants follow PRD", () => {
    expect([...RADIUS_OPTIONS_KM]).toEqual([1, 2, 5, 10, 30, 50]);
    expect(MAX_SPORT_FILTERS).toBe(3);
  });

  it("reduced motion caps durations but keeps QR rotation", () => {
    expect(motionDuration("sheet", true)).toBeLessThanOrEqual(motion.duration.fast);
    expect(motionDuration("sheet", false)).toBe(motion.duration.sheet);
    expect(motionDuration("qrRotation", true)).toBe(30_000);
  });

  it("spring presets are stable (damping ratio > 0.3)", () => {
    for (const [k, s] of Object.entries(motion.springs)) {
      const ratio = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
      expect(ratio, k).toBeGreaterThan(0.3);
    }
  });

  it("haptic map only uses known kinds", () => {
    const kinds = ["selection", "light", "medium", "heavy", "success", "warning", "error", "none"];
    for (const [k, v] of Object.entries(hapticMap)) expect(kinds, k).toContain(v);
  });
});
