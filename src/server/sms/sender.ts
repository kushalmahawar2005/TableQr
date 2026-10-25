import "server-only";

// SMS boundary for one-time codes. Mock codes are development/test-only and never leave production.

export interface SmsSender {
  readonly name: string;
  sendOtp(input: { phone: string; code: string; outletName: string }): Promise<{ ok: boolean }>;
}

type Fast2SmsConfig = {
  apiKey: string;
  templateId: string;
  otpExpiryMinutes: number;
};

function fast2SmsConfig(): Fast2SmsConfig | null {
  const apiKey = process.env.FAST2SMS_API_KEY?.trim() ?? "";
  const templateId = process.env.FAST2SMS_OTP_TEMPLATE_ID?.trim() ?? "";
  const expiry = Number(process.env.FAST2SMS_OTP_EXPIRY_MINUTES || 5);
  if (!apiKey || !/^\d{4,20}$/.test(templateId) || !Number.isInteger(expiry) || expiry < 1 || expiry > 10080) return null;
  return { apiKey, templateId, otpExpiryMinutes: expiry };
}

/** Fast2SMS Smart OTP keeps the app's own hashed OTP verification and rate limits. */
export class Fast2SmsSender implements SmsSender {
  readonly name = "fast2sms";

  constructor(private readonly config: Fast2SmsConfig, private readonly request: typeof fetch = fetch) {}

  async sendOtp(input: { phone: string; code: string; outletName: string }) {
    const mobile = input.phone.replace(/^\+91/, "");
    if (!/^\d{10}$/.test(mobile) || !/^\d{4,10}$/.test(input.code)) return { ok: false };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7_000);
    try {
      const response = await this.request("https://www.fast2sms.com/dev/otp/send", {
        method: "POST",
        headers: { Authorization: this.config.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          mobile,
          otp_id: this.config.templateId,
          otp: input.code,
          otp_length: input.code.length,
          otp_expiry: this.config.otpExpiryMinutes,
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return { ok: false };
      const result: unknown = await response.json().catch(() => null);
      return { ok: !!result && typeof result === "object" && "return" in result && result.return === true };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timeout);
    }
  }
}

type Msg91Config = {
  authKey: string;
  templateId: string;
  otpExpiryMinutes: number;
};

function msg91Config(): Msg91Config | null {
  const authKey = process.env.MSG91_AUTH_KEY?.trim() ?? "";
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID?.trim() ?? "";
  const expiry = Number(process.env.MSG91_OTP_EXPIRY_MINUTES || 5);
  if (!authKey || !/^[A-Za-z0-9]{8,64}$/.test(templateId) || !Number.isInteger(expiry) || expiry < 1 || expiry > 10080) return null;
  return { authKey, templateId, otpExpiryMinutes: expiry };
}

/**
 * MSG91 OTP API (v5). The app makes its own code and hashes it, so MSG91 only delivers it: the
 * template must carry the ##OTP## variable and be approved on DLT.
 */
export class Msg91Sender implements SmsSender {
  readonly name = "msg91";

  constructor(private readonly config: Msg91Config, private readonly request: typeof fetch = fetch) {}

  async sendOtp(input: { phone: string; code: string; outletName: string }) {
    const mobile = input.phone.replace(/^\+/, "");
    if (!/^91\d{10}$/.test(mobile) || !/^\d{4,10}$/.test(input.code)) return { ok: false };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7_000);
    try {
      const query = new URLSearchParams({
        template_id: this.config.templateId,
        mobile,
        otp: input.code,
        otp_length: String(input.code.length),
        otp_expiry: String(this.config.otpExpiryMinutes),
      });
      const response = await this.request(`https://control.msg91.com/api/v5/otp?${query}`, {
        method: "POST",
        headers: { authkey: this.config.authKey, "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return { ok: false };
      const result: unknown = await response.json().catch(() => null);
      return { ok: !!result && typeof result === "object" && "type" in result && result.type === "success" };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Development and test sender: remembers the last code per number and logs it on the server */
class MockSms implements SmsSender {
  readonly name = "mock";
  private last = new Map<string, string>();
  /** Set to make the next sends fail, as a provider outage would */
  failing = false;

  async sendOtp(input: { phone: string; code: string; outletName: string }) {
    if (this.failing) return { ok: false };
    this.last.set(input.phone, input.code);
    if (process.env.NODE_ENV === "development") console.info(`[sms:mock] ${input.outletName} code ${input.code} to ${input.phone}`);
    return { ok: true };
  }

  lastCode(phone: string) {
    return this.last.get(phone) ?? null;
  }
}

class NotConfigured implements SmsSender {
  readonly name = "none";
  async sendOtp() {
    return { ok: false };
  }
}

export const mockSms = new MockSms();

export function smsMockEnabled() {
  return process.env.NODE_ENV !== "production" && /^(1|true)$/i.test(process.env.SMS_MOCK ?? "");
}

export function smsSender(): SmsSender {
  const provider = process.env.SMS_PROVIDER?.trim().toLowerCase();
  if (provider === "fast2sms") {
    const config = fast2SmsConfig();
    return config ? new Fast2SmsSender(config) : new NotConfigured();
  }
  if (provider === "msg91") {
    const config = msg91Config();
    return config ? new Msg91Sender(config) : new NotConfigured();
  }
  // Never silently fall back to demo OTP in production, including on a provider outage.
  if (process.env.NODE_ENV === "production") return new NotConfigured();
  return provider === "none" ? new NotConfigured() : mockSms;
}

export function smsProviderReadiness() {
  const provider = process.env.SMS_PROVIDER?.trim().toLowerCase() || "";
  if (provider === "fast2sms") return { provider, configured: !!fast2SmsConfig() };
  if (provider === "msg91") return { provider, configured: !!msg91Config() };
  if (provider === "none") return { provider, configured: false };
  return { provider: provider || "unset", configured: process.env.NODE_ENV !== "production" };
}
