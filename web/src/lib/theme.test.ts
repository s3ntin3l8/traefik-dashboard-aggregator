import { describe, it, expect } from "vitest";
import { relLum } from "./theme";

describe("relLum", () => {
  it("is 1 for white and 0 for black", () => {
    expect(relLum("#ffffff")).toBeCloseTo(1, 5);
    expect(relLum("#000000")).toBeCloseTo(0, 5);
  });

  it("computes a mid-gray luminance", () => {
    // #808080 → ~0.2159 by the WCAG sRGB formula.
    expect(relLum("#808080")).toBeCloseTo(0.216, 2);
  });

  it("ignores a leading # and is case-insensitive on hex", () => {
    expect(relLum("FFFFFF")).toBeCloseTo(relLum("#ffffff"), 6);
  });

  it("weights green most heavily (per the WCAG coefficients)", () => {
    expect(relLum("#00ff00")).toBeGreaterThan(relLum("#ff0000"));
    expect(relLum("#ff0000")).toBeGreaterThan(relLum("#0000ff"));
  });
});
