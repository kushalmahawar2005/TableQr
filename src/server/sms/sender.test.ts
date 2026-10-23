import { afterEach, describe, expect, it } from "vitest";
import { smsMockEnabled, smsSender } from "./sender";

const previous = { nodeEnv: process.env.NODE_ENV, smsMock: process.env.SMS_MOCK };
const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  if (previous.nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = previous.nodeEnv;
  if (previous.smsMock === undefined) delete env.SMS_MOCK;
  else env.SMS_MOCK = previous.smsMock;
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
});
