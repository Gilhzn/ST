import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { legacyIconMap } from "../src/icons/legacy";
import { reliabilityColors, sportColors, sportKeys } from "../src/tokens";

/**
 * The registry uses lazy `require()` of deep Phosphor modules, so it can't be imported in Node.
 * These tests parse the registry source and check every entry against the installed package.
 */
const ICONS_DIR = fileURLToPath(new URL("../../../node_modules/phosphor-react-native/src/icons/", import.meta.url));
const registrySrc = readFileSync(fileURLToPath(new URL("../src/icons/registry.ts", import.meta.url)), "utf8");
const entryRe = /^ {2}(\w+): \(\) => pick\(require\("phosphor-react-native\/src\/icons\/(\w+)"\), "(\w+)"\),$/gm;
const entries = [...registrySrc.matchAll(entryRe)].map((m) => ({ key: m[1]!, file: m[2]!, name: m[3]! }));
const names = new Set(entries.map((e) => e.key));

describe("icon registry (Phosphor only)", () => {
  it("parses a curated set (≈100 icons, sorted, unique)", () => {
    expect(entries.length).toBeGreaterThan(80);
    expect(entries.length).toBeLessThan(140);
    const keys = entries.map((e) => e.key);
    expect([...keys].sort()).toEqual(keys);
    expect(names.size).toBe(keys.length);
  });

  it("every registry line is well-formed (key = module = export name)", () => {
    const lines = registrySrc.split("\n").filter((l) => l.includes("require(\"phosphor-react-native/src/icons/"));
    expect(lines.length).toBe(entries.length);
    for (const e of entries) {
      expect(e.file, e.key).toBe(e.key);
      expect(e.name, e.key).toBe(e.key);
    }
  });

  it.each(entries.map((e) => [e.key]))("%s resolves to a real Phosphor export", (key) => {
    const file = `${ICONS_DIR}${key}.tsx`;
    expect(existsSync(file), file).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(new RegExp(`export \\{ I as ${key}Icon \\}`));
  });

  it("every sport has a registered icon, and sport icons are unique", () => {
    for (const k of sportKeys) expect(names.has(sportColors[k].phosphor), k).toBe(true);
    expect(new Set(sportKeys.map((k) => sportColors[k].phosphor)).size).toBe(sportKeys.length);
  });

  it("every reliability status icon is registered", () => {
    for (const t of Object.values(reliabilityColors.light)) expect(names.has(t.phosphor), t.phosphor).toBe(true);
  });

  it("every legacy MaterialCommunityIcons name maps to a registered icon", () => {
    for (const [mci, ph] of Object.entries(legacyIconMap)) expect(names.has(ph), `${mci} → ${ph}`).toBe(true);
    for (const k of sportKeys) expect(legacyIconMap[sportColors[k].icon as keyof typeof legacyIconMap]).toBe(sportColors[k].phosphor);
  });

  it("directional (RTL-mirroring) icons are registered and never include sport/object glyphs", () => {
    const block = registrySrc.slice(registrySrc.indexOf("directionalIcons"));
    const dir = [...block.matchAll(/^ {2}"(\w+)",$/gm)].map((m) => m[1]!);
    expect(dir).toContain("ArrowLeft");
    expect(dir).toContain("CaretRight");
    expect(dir).toContain("PaperPlaneRight");
    for (const d of dir) expect(names.has(d), d).toBe(true);
    for (const k of sportKeys) expect(dir).not.toContain(sportColors[k].phosphor);
    for (const never of ["Check", "Clock", "QrCode", "MagnifyingGlass", "Plus"]) expect(dir).not.toContain(never);
  });
});
