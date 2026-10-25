import { afterEach, describe, expect, it } from "vitest";
import { Fast2SmsSender, Msg91Sender, smsMockEnabled, smsProviderReadiness, smsSender } from "./sender";

const env = process.env as Record<string, string | undefined>;
const keys = ["NODE_ENV", "SMS_MOCK", "SMS_PROVIDER", "FAST2SMS_API_KEY", "FAST2SMS_OTP_TEMPLATE_ID", "FAST2SMS_OTP_EXPIRY_MINUTES", "MSG91_AUTH_KEY", "MSG91_OTP_TEMPLATE_ID", "MSG91_OTP_EXPIRY_MINUTES"] as const;
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

describe("MSG91", () => {
  it("is selected only when its key and template are present", () => {
    env.NODE_ENV = "production";
    env.SMS_PROVIDER = "msg91";
    env.MSG91_AUTH_KEY = "configured-key";
    expect(smsSender().name).toBe("none");
    env.MSG91_OTP_TEMPLATE_ID = "6a1b2c3d4e5f60718293a4b5";
    expect(smsSender().name).toBe("msg91");
    expect(smsProviderReadiness()).toEqual({ provider: "msg91", configured: true });
    delete env.MSG91_AUTH_KEY;
    expect(smsProviderReadiness()).toEqual({ provider: "msg91", configured: false });
  });

  it("sends the app's own code, keeps the key in a header and out of the address", async () => {
    let call: { url: string; init: RequestInit } | undefined;
    const sender = new Msg91Sender({ authKey: "private-auth-key", templateId: "6a1b2c3d4e5f60718293a4b5", otpExpiryMinutes: 5 }, async (url, init) => {
      call = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ type: "success", message: "3566" }), { status: 200 });
    });
    await expect(sender.sendOtp({ phone: "+919876543210", code: "0421", outletName: "BMW" })).resolves.toEqual({ ok: true });
    const url = new URL(call!.url);
    expect(url.origin + url.pathname).toBe("https://control.msg91.com/api/v5/otp");
    expect(Object.fromEntries(url.searchParams)).toEqual({ template_id: "6a1b2c3d4e5f60718293a4b5", mobile: "919876543210", otp: "0421", otp_length: "4", otp_expiry: "5" });
    expect(new Headers(call!.init.headers).get("authkey")).toBe("private-auth-key");
    expect(call!.url).not.toContain("private-auth-key");
  });

  it("treats provider errors, an error type and non-Indian numbers as failed sends", async () => {
    const config = { authKey: "k", templateId: "6a1b2c3d4e5f60718293a4b5", otpExpiryMinutes: 5 };
    const down = new Msg91Sender(config, async () => new Response("{}", { status: 401 }));
    const rejected = new Msg91Sender(config, async () => new Response(JSON.stringify({ type: "error", message: "Template not found" }), { status: 200 }));
    await expect(down.sendOtp({ phone: "+919876543210", code: "1234", outletName: "BMW" })).resolves.toEqual({ ok: false });
    await expect(rejected.sendOtp({ phone: "+919876543210", code: "1234", outletName: "BMW" })).resolves.toEqual({ ok: false });
    await expect(rejected.sendOtp({ phone: "+12025550123", code: "1234", outletName: "BMW" })).resolves.toEqual({ ok: false });
  });
});
