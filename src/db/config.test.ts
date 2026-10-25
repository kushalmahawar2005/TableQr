import { describe, expect, it } from "vitest";
import { poolSizeFrom } from "./config";

describe("poolSizeFrom", () => {
  it("uses the number set, as a whole number", () => {
    expect(poolSizeFrom("20")).toBe(20);
    expect(poolSizeFrom("15.9")).toBe(15);
    expect(poolSizeFrom(" 8 ")).toBe(8);
  });

  it("falls back to 10 for nothing, text, zero or negatives", () => {
    for (const v of [undefined, "", "abc", "0", "-5", "NaN"]) expect(poolSizeFrom(v)).toBe(10);
  });

  it("never goes past 40, so a typo cannot use up the host's 75 connections", () => {
    expect(poolSizeFrom("40")).toBe(40);
    expect(poolSizeFrom("500")).toBe(40);
  });
});
