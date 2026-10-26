import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Static guard: components must pass accessibility semantics with `role` / `aria-*` props.
 * react-native-web 0.21 ignores `accessibilityState` (so checked/selected never reached the
 * DOM) and the other legacy props below have aria equivalents in RN ≥ 0.71.
 * Still allowed (no aria equivalent in RN): accessible, accessibilityHint,
 * accessibilityActions/onAccessibilityAction, accessibilityLanguage.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));

const LEGACY_JSX_PROPS = [
  "accessibilityState",
  "accessibilityRole",
  "accessibilityLabel",
  "accessibilityLabelledBy",
  "accessibilityValue",
  "accessibilityLiveRegion",
  "accessibilityElementsHidden",
  "importantForAccessibility",
  "accessibilityViewIsModal",
];

/** JSX attribute usage: `<X accessibilityRole="…"`, `accessibilityState={…}` or a bare boolean attr. */
const jsxAttr = (name: string) => new RegExp(`(^|\\s)${name}(\\s*=\\s*[{"']|\\s*$|\\s+[a-zA-Z/>])`);
/** Object-literal usage, e.g. an `accessibilityState: {…}` style prop bag. */
const objKey = (name: string) => new RegExp(`(^|[\\s{,])${name}\\s*:\\s*[{"'\\[]`);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(f) ? [p] : [];
  });
}

describe("modern accessibility props only (role / aria-*)", () => {
  const files = walk(SRC);

  it("finds component files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [relative(SRC, f), f]))("%s uses no legacy accessibility* JSX props", (_rel, file) => {
    const hits: string[] = [];
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return; // comments
        for (const name of LEGACY_JSX_PROPS) {
          if (jsxAttr(name).test(line) || objKey(name).test(line)) hits.push(`${i + 1}: ${name} → ${line.trim()}`);
        }
      });
    expect(hits).toEqual([]);
  });

  it("never uses roles axe requires extra attributes for without them", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // slider/adjustable need aria-valuenow; we use buttons + custom actions instead
      expect(src, file).not.toMatch(/role=["'](slider|adjustable|spinbutton|scrollbar)["']/);
      // aria-selected is only valid on tab/option/row/gridcell
      if (/aria-selected=/.test(src)) expect(src, file).toMatch(/["']tab["']/);
    }
  });

  it("the legacy-prop detector catches known bad lines", () => {
    expect(jsxAttr("accessibilityState").test("      accessibilityState={{ checked: true }}")).toBe(true);
    expect(jsxAttr("accessibilityElementsHidden").test("<View accessibilityElementsHidden style={s} />")).toBe(true);
    expect(jsxAttr("accessibilityLabel").test("  accessibilityLabel?: string;")).toBe(false);
    expect(objKey("accessibilityState").test("{ accessibilityState: { busy: true } }")).toBe(true);
  });
});
