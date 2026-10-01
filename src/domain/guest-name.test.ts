import { describe, expect, it } from "vitest";
import { checkFirstName } from "./guest-name";

describe("first name (G2)", () => {
  it("accepts Latin and Devanagari names with spaces, hyphens and apostrophes", () => {
    for (const name of ["Aarav", "आरव", "Anne-Marie", "D'Souza", "D’Souza", "Mary Jane", "José", "क्षितिज", "श्रीया"]) {
      expect(checkFirstName(name)).toEqual({ ok: true, name });
    }
  });

  it("trims and collapses spaces", () => {
    expect(checkFirstName("  Aarav   Kumar ")).toEqual({ ok: true, name: "Aarav Kumar" });
  });

  it("rejects emoji, digits and other symbols", () => {
    for (const name of ["Aarav 😀", "❤️", "Aarav2", "आरव१", "R@hul", "Aarav!", "Ravi.", "आरव।", "Иван", "---", "'"]) {
      expect(checkFirstName(name)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("rejects empty and over-long names", () => {
    expect(checkFirstName("   ")).toEqual({ ok: false, reason: "empty" });
    expect(checkFirstName("a".repeat(40)).ok).toBe(true);
    expect(checkFirstName("a".repeat(41))).toEqual({ ok: false, reason: "too_long" });
  });
});
