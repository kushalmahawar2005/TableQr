import { describe, expect, it } from "vitest";
import { contrast, DEFAULT_ACCENT, deriveBrandTokens } from "./brand";

describe("adaptive brand tokens", () => {
  it("keeps an accessible colour as it is", () => {
    const t = deriveBrandTokens("#C9482B");
    expect(t.main).toBe("#C9482B");
    expect(t.adjusted).toBe(false);
    expect(contrast(t.main, t.on)).toBeGreaterThanOrEqual(4.5);
  });

  it("darkens a colour that is too light for white button text", () => {
    for (const light of ["#E4572E", "#FFD400", "#39FF14", "#F4B63F"]) {
      const t = deriveBrandTokens(light);
      expect(t.adjusted).toBe(true);
      expect(t.original).toBe(light);
      expect(contrast(t.main, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("falls back to the Tableeqr accent when the outlet has none or it is invalid", () => {
    expect(deriveBrandTokens(null).main).toBe(DEFAULT_ACCENT);
    expect(deriveBrandTokens("red").main).toBe(DEFAULT_ACCENT);
  });

  it("orders the derived shades from soft to strong", () => {
    const t = deriveBrandTokens("#237A68");
    const lightness = (hex: string) => contrast(hex, "#000000");
    expect(lightness(t.soft)).toBeGreaterThan(lightness(t.border));
    expect(lightness(t.border)).toBeGreaterThan(lightness(t.main));
    expect(lightness(t.main)).toBeGreaterThan(lightness(t.hover));
    expect(lightness(t.pressed)).toBeGreaterThan(lightness(t.strong));
  });
});
