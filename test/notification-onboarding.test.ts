import { describe, expect, it } from "vitest";
import { notificationSetupMode } from "@/lib/notification-onboarding";

describe("staff notification onboarding", () => {
  it("asks only from the first-launch explainer and respects a dismissed prompt", () => {
    expect(notificationSetupMode("default", false, false)).toBe("request-permission");
    expect(notificationSetupMode("default", true, false)).toBe("hidden");
    expect(notificationSetupMode("denied", false, false)).toBe("hidden");
  });

  it("never asks for permission again after it was granted", () => {
    expect(notificationSetupMode("granted", false, false)).toBe("finish-setup");
    expect(notificationSetupMode("granted", true, false)).toBe("hidden");
    expect(notificationSetupMode("granted", false, true)).toBe("hidden");
  });
});
