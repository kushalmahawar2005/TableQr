import { describe, expect, it } from "vitest";
import { displayPhone, formatIndianMobile, isValidIndianMobile, normaliseIndianMobile, otpSupported, toE164 } from "./phone";
import { formatCountdown, isCompleteCode, normaliseCode } from "./otp";

describe("Indian mobile numbers", () => {
  it("keeps 10 digits from typed or pasted input", () => {
    expect(normaliseIndianMobile("98765 43210")).toBe("9876543210");
    expect(normaliseIndianMobile("+91 98765-43210")).toBe("9876543210");
    expect(normaliseIndianMobile("098765 43210")).toBe("9876543210");
    expect(normaliseIndianMobile("९८७६५४३२१०")).toBe("9876543210");
    expect(normaliseIndianMobile("987654321099")).toBe("9876543210");
  });

  it("accepts 10 digits starting 6 to 9 only", () => {
    expect(isValidIndianMobile("9876543210")).toBe(true);
    expect(isValidIndianMobile("6000000000")).toBe(true);
    expect(isValidIndianMobile("5876543210")).toBe(false);
    expect(isValidIndianMobile("987654321")).toBe(false);
  });

  it("formats for screens", () => {
    expect(formatIndianMobile("98765")).toBe("98765");
    expect(formatIndianMobile("987654")).toBe("98765 4");
    expect(displayPhone(toE164("+91", "9876543210"))).toBe("+91 98765 43210");
  });

  it("sends OTP to Indian numbers only for now", () => {
    expect(otpSupported("IN")).toBe(true);
    expect(otpSupported("AE")).toBe(false);
    expect(otpSupported("XX")).toBe(false);
  });
});

describe("one-time code", () => {
  it("normalises typed, pasted and Hindi digits", () => {
    expect(normaliseCode(" 4 7-9 1 ")).toBe("4791");
    expect(normaliseCode("४७९१")).toBe("4791");
    expect(normaliseCode("479123")).toBe("4791");
    expect(isCompleteCode("479")).toBe(false);
    expect(isCompleteCode("4791")).toBe(true);
  });

  it("formats countdowns", () => {
    expect(formatCountdown(30)).toBe("0:30");
    expect(formatCountdown(47.2)).toBe("0:48");
    expect(formatCountdown(245)).toBe("4:05");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});
