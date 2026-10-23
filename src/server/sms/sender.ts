import "server-only";

// SMS boundary for one-time codes. Mock codes are development/test-only and never leave production.

export interface SmsSender {
  readonly name: string;
  sendOtp(input: { phone: string; code: string; outletName: string }): Promise<{ ok: boolean }>;
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
  return process.env.NODE_ENV === "production" ? new NotConfigured() : mockSms;
}
