import { describe, expect, it } from "vitest";

import { contrastRatio, deltaE, simulateCvd } from "../src/color";
import {
  avatarFills,
  colors,
  contrastPairs,
  elevation,
  motion,
  motionDuration,
  RADIUS_OPTIONS_KM,
  MAX_SPORT_FILTERS,
  reliabilityColors,
  sportColors,
  sportKeys,
  spacing,
  sizing,
  type ColorScheme,
} from "../src/tokens";

const schemes: ColorScheme[] = ["light", "dark"];

describe("color math", () => {
  it("matches known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1 AA threshold color
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 1);
  });
});

describe.each(schemes)("semantic colors (%s) meet WCAG 2.2 AA", (scheme) => {
  const c = colors[scheme];
  it.each(contrastPairs.map((p) => [p.fg, p.bg, p.min, p.use] as const))("%s on %s ≥ %d (%s)", (fg, bg, min) => {
    const ratio = contrastRatio(c[fg], c[bg]);
    expect(ratio, `${scheme} ${fg} ${c[fg]} on ${bg} ${c[bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
  });

  it("every solid hex token is a valid color", () => {
    for (const [k, v] of Object.entries(c)) {
      expect(v, k).toMatch(/^(#[0-9A-Fa-f]{6}|rgba\(.+\))$/);
    }
  });

  it("has an elevation scale with increasing zIndex", () => {
    const z = [0, 1, 2, 3, 4].map((l) => elevation[scheme][l as 0 | 1 | 2 | 3 | 4].zIndex);
    expect([...z].sort((a, b) => a - b)).toEqual(z);
  });
});

describe.each(schemes)("reliability colors (%s)", (scheme) => {
  const r = reliabilityColors[scheme];
  const surface = colors[scheme].surface;
  it.each(Object.entries(r))("%s label ≥ 4.5 on its badge and solid ≥ 3 on surface", (_k, t) => {
    expect(contrastRatio(t.fg, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.fg, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.solid, surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(surface, t.solid)).toBeGreaterThanOrEqual(3);
  });
  it("never relies on color alone: every status has a unique glyph", () => {
    const glyphs = Object.values(r).map((t) => t.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe("sport colors", () => {
  it("covers the six launch sports", () => {
    expect(sportKeys.sort()).toEqual(["basketball", "football", "padel", "running", "tennis", "volleyball"]);
  });

  it("glyph/text on each fill is ≥ 4.5:1", () => {
    for (const t of Object.values(sportColors)) {
      expect(contrastRatio(t.on, t.color), t.key).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses a unique shape, glyph and icon per sport (redundant non-color cues)", () => {
    const v = Object.values(sportColors);
    for (const field of ["shape", "glyph", "icon", "color"] as const) {
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
    "all pairs stay distinguishable under %s (ΔE ≥ 15)",
    (cvd) => {
      for (const [a, b, ca, cb] of pairs) {
        const d = deltaE(simulateCvd(ca, cvd), simulateCvd(cb, cvd));
        expect(d, `${a}/${b} under ${cvd}`).toBeGreaterThanOrEqual(15);
      }
    },
  );

  it("pin outline separates every fill from map tiles (≥ 3:1)", () => {
    for (const scheme of schemes) {
      const c = colors[scheme];
      expect(contrastRatio(c.pinOutline, c.mapBase)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.pinOutline, c.pinRing)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("other scales", () => {
  it("avatar fills keep white initials ≥ 4.5:1", () => {
    for (const f of avatarFills) expect(contrastRatio(f, "#FFFFFF"), f).toBeGreaterThanOrEqual(4.5);
  });

  it("spacing is on a 2/4pt grid and ascending", () => {
    const v = Object.values(spacing);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
    for (const n of v) expect(n % 2).toBe(0);
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
});
