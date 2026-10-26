import { describe, expect, it } from "vitest";

import {
  FSI,
  LRI,
  PDI,
  RLI,
  containsRtl,
  detectDirection,
  initialsFor,
  isolate,
  isolateValues,
  stripBidiControls,
} from "../src/bidi";

describe("isolate", () => {
  it("wraps with FSI…PDI by default", () => {
    expect(isolate("Dana")).toBe(`${FSI}Dana${PDI}`);
  });
  it("forces LRI/RLI when asked", () => {
    expect(isolate("+972 50-123-4567", "ltr")).toBe(`${LRI}+972 50-123-4567${PDI}`);
    expect(isolate("שלום", "rtl")).toBe(`${RLI}שלום${PDI}`);
  });
  it("strips override/embedding controls from untrusted content (Trojan Source)", () => {
    const evil = "abc‮dcba‬";
    expect(stripBidiControls(evil)).toBe("abcdcba");
    expect(isolate(evil)).toBe(`${FSI}abcdcba${PDI}`);
    // Unbalanced isolates in input cannot escape our isolate
    expect(isolate("x⁩y")).toBe(`${FSI}xy${PDI}`);
  });
  it("isolates interpolation values; numbers as LTR", () => {
    const v = isolateValues({ name: "محمد", count: 3, flag: true });
    expect(v.name).toBe(`${FSI}محمد${PDI}`);
    expect(v.count).toBe(`${LRI}3${PDI}`);
    expect(v.flag).toBe(true);
  });
});

describe("detectDirection", () => {
  it.each([
    ["Hello", "ltr"],
    ["שלום world", "rtl"],
    ["123 مرحبا", "rtl"],
    ["!!! hi", "ltr"],
    ["こんにちは", "ltr"],
    ["नमस्ते", "ltr"],
  ])("%s → %s", (t, d) => {
    expect(detectDirection(t)).toBe(d);
  });
  it("uses the fallback for neutral-only text", () => {
    expect(detectDirection("12:30", "rtl")).toBe("rtl");
    expect(detectDirection("👍", "ltr")).toBe("ltr");
  });
  it("skips already-isolated runs", () => {
    expect(detectDirection(`${FSI}Dana${PDI} כתבה`)).toBe("rtl");
  });
  it("containsRtl", () => {
    expect(containsRtl("abc")).toBe(false);
    expect(containsRtl("abc ש")).toBe(true);
  });
});

describe("initialsFor", () => {
  it.each([
    ["Dana Levi", "DL"],
    ["dana", "D"],
    ["José María Pérez", "JP"],
    ["דנה לוי", "דל"],
    ["محمد علي", "مع"],
    ["王小明", "王"],
    ["", "?"],
  ])("%s → %s", (name, expected) => {
    expect(initialsFor(name)).toBe(expected);
  });
  it("keeps Devanagari combining marks with the first letter", () => {
    expect(initialsFor("किरण शर्मा")).toBe("किश");
  });
});
