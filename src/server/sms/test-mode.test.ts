import { afterEach, describe, expect, it } from "vitest";
import { otpTestBypassEnabled } from "./test-mode";

const keys = ["NODE_ENV", "OTP_TEST_BYPASS", "OTP_TEST_PHONE"] as const;
const env = process.env as Record<string, string | undefined>;
const previous = Object.fromEntries(keys.map(key => [key, env[key]]));

afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete env[key];
    else env[key] = previous[key];
  }
});

describe("temporary guest OTP test bypass", () => {
  it("only skips verification for the single allowlisted production phone", () => {
    env.NODE_ENV = "production";
    env.OTP_TEST_BYPASS = "1";
    env.OTP_TEST_PHONE = "+91 98765 43210";

    expect(otpTestBypassEnabled("98765-43210")).toBe(true);
    expect(otpTestBypassEnabled("+919876543211")).toBe(false);
  });

  it("stays off when disabled, missing a valid test phone, or running outside production", () => {
    env.NODE_ENV = "production";
    delete env.OTP_TEST_BYPASS;
    env.OTP_TEST_PHONE = "9876543210";
    expect(otpTestBypassEnabled("9876543210")).toBe(false);

    env.OTP_TEST_BYPASS = "true";
    env.OTP_TEST_PHONE = "1234";
    expect(otpTestBypassEnabled("1234")).toBe(false);

    env.NODE_ENV = "development";
    env.OTP_TEST_PHONE = "9876543210";
    expect(otpTestBypassEnabled("9876543210")).toBe(false);
  });
});
