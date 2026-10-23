import { afterEach, describe, expect, it } from "vitest";
import { Fast2SmsSender, smsMockEnabled, smsProviderReadiness, smsSender } from "./sender";

const env = process.env as Record<string, string | undefined>;
const keys = ["NODE_ENV", "SMS_MOCK", "SMS_PROVIDER", "FAST2SMS_API_KEY", "FAST2SMS_OTP_TEMPLATE_ID", "FAST2SMS_OTP_EXPIRY_MINUTES"] as const;
const previous = Object.fromEntries(keys.map(key => [key, env[key]]));

afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete env[key];
    else env[key] = previous[key];
  }
});

describe("SMS mock mode", () => {
  it("never enables mock OTP in production, even with the old switch", () => {
    env.NODE_ENV = "production";
    delete env.SMS_MOCK;
    expect(smsMockEnabled()).toBe(false);
    expect(smsSender().name).toBe("none");

    env.SMS_MOCK = "1";
    expect(smsMockEnabled()).toBe(false);
    expect(smsSender().name).toBe("none");
  });

  it("accepts true as an enabled switch and keeps local mock OTP available", () => {
    env.NODE_ENV = "production";
    env.SMS_MOCK = "true";
    expect(smsSender().name).toBe("none");

    env.NODE_ENV = "test";
    delete env.SMS_MOCK;
    expect(smsSender().name).toBe("mock");
  });

  it("selects Fast2SMS only when all required provider settings are present", () => {
    env.NODE_ENV = "production";
    env.SMS_PROVIDER = "fast2sms";
    env.FAST2SMS_API_KEY = "configured-key";
    env.FAST2SMS_OTP_TEMPLATE_ID = "123456";
    expect(smsSender().name).toBe("fast2sms");
    expect(smsProviderReadiness()).toEqual({ provider: "fast2sms", configured: true });

    delete env.FAST2SMS_OTP_TEMPLATE_ID;
    expect(smsSender().name).toBe("none");
    expect(smsProviderReadiness()).toEqual({ provider: "fast2sms", configured: false });
  });

  it("sends the app-generated OTP through the Fast2SMS OTP template without exposing secrets", async () => {
    let call: { url: string; init: RequestInit } | undefined;
    const sender = new Fast2SmsSender({ apiKey: "private-api-key", templateId: "123456", otpExpiryMinutes: 5 }, async (url, init) => {
      call = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ return: true, status_code: 200 }), { status: 200 });
    });

    await expect(sender.sendOtp({ phone: "+919876543210", code: "0421", outletName: "BMW" })).resolves.toEqual({ ok: true });
    expect(call?.url).toBe("https://www.fast2sms.com/dev/otp/send");
    expect(new Headers(call?.init.headers).get("Authorization")).toBe("private-api-key");
    expect(JSON.parse(String(call?.init.body))).toEqual({ mobile: "9876543210", otp_id: "123456", otp: "0421", otp_length: 4, otp_expiry: 5 });
    expect(String(call?.init.body)).not.toContain("private-api-key");
  });

  it("treats provider errors, malformed responses, and invalid numbers as failed sends", async () => {
    const failing = new Fast2SmsSender({ apiKey: "private-api-key", templateId: "123456", otpExpiryMinutes: 5 }, async () => new Response("{}", { status: 401 }));
    const malformed = new Fast2SmsSender({ apiKey: "private-api-key", templateId: "123456", otpExpiryMinutes: 5 }, async () => new Response("{}", { status: 200 }));
    await expect(failing.sendOtp({ phone: "+919876543210", code: "1234", outletName: "BMW" })).resolves.toEqual({ ok: false });
    await expect(malformed.sendOtp({ phone: "+919876543210", code: "1234", outletName: "BMW" })).resolves.toEqual({ ok: false });
    await expect(malformed.sendOtp({ phone: "+12025550123", code: "1234", outletName: "BMW" })).resolves.toEqual({ ok: false });
  });
});
