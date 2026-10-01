import { describe, expect, it } from "vitest";
import { g2Copy } from "./_copy";

/** Every key path in a copy object, functions and arrays included */
function keys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => keys(v, `${prefix}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  return [`${prefix}:${typeof value}`];
}

describe("G2 copy", () => {
  const { en, hi } = g2Copy;

  it("has every English line in Hindi too", () => {
    expect(keys(hi)).toEqual(keys(en));
  });

  it("uses the locked wording", () => {
    expect(en.heading).toBe("Confirm your number");
    expect(en.trust).toBe("We send a 4-digit code so only people at this table can order.");
    expect(en.trust).not.toMatch(/spam/i);
    expect(en.joining(3)).toBe("Joining 3 people");
    expect(en.consent("Spice Route")).toBe("Remember my favourites and send me offers from Spice Route");
    expect(en.nameError).toBe("Use letters, spaces, hyphens or apostrophes.");
    expect(en.intlUnavailable).toBe("International OTP isn't available yet. Please ask staff to continue.");
  });

  it("keeps digits 0–9 in Hindi countdowns", () => {
    expect(hi.resendIn("0:30")).toContain("0:30");
    expect(hi.tryAgainIn("0:47")).toContain("0:47");
  });
});
