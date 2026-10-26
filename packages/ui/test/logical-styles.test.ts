import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Lint-like guard: packages/ui must use logical style props only
 * (marginStart/End, paddingStart/End, start/end, borderStart*, *Start*Radius).
 * Physical sides break RTL (Hebrew, Arabic).
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));

const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "marginLeft/Right", re: /\bmargin(Left|Right)\b/ },
  { name: "paddingLeft/Right", re: /\bpadding(Left|Right)\b/ },
  { name: "left:/right: offsets", re: /(^|[\s{,])(left|right)\s*:/ },
  { name: "textAlign left/right", re: /textAlign\s*:\s*["'](left|right)["']/ },
  { name: "border Left/Right", re: /\bborder(Left|Right)(Width|Color|Style)?\b/ },
  { name: "physical corner radius", re: /\bborder(Top|Bottom)(Left|Right)Radius\b/ },
  { name: "row-reverse as RTL hack", re: /["']row-reverse["']/ },
  { name: "translateX without mirroring helper", re: /translateX/ },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("logical styles only (RTL safety)", () => {
  const files = walk(SRC);

  it("finds source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [relative(SRC, f), f]))("%s has no physical left/right styles", (_rel, file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    const hits: string[] = [];
    lines.forEach((line, i) => {
      for (const { name, re } of FORBIDDEN) {
        if (re.test(line)) hits.push(`${i + 1}: [${name}] ${line.trim()}`);
      }
    });
    expect(hits).toEqual([]);
  });
});
