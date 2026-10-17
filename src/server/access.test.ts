import { describe, expect, it } from "vitest";
import { accessFrom } from "./access";

const DAY = 86_400_000;
const now = new Date("2026-10-17T06:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe("access after a trial or paid period", () => {
  it("trial: works, warns in the last 3 days, then 3 grace days, then stops", () => {
    expect(accessFrom({ status: "trial", trialEndsAt: at(10), paidUntil: null }, now)).toMatchObject({ state: "ok", warn: false });
    expect(accessFrom({ status: "trial", trialEndsAt: at(2), paidUntil: null }, now)).toMatchObject({ state: "ok", warn: true });
    expect(accessFrom({ status: "trial", trialEndsAt: at(-1), paidUntil: null }, now)).toMatchObject({ state: "grace", reason: "trial" });
    expect(accessFrom({ status: "trial", trialEndsAt: at(-4), paidUntil: null }, now)).toMatchObject({ state: "blocked", reason: "trial" });
  });

  it("paid: follows the latest paid period, and an active tenant with none on record stays open", () => {
    expect(accessFrom({ status: "active", trialEndsAt: at(-100), paidUntil: at(20) }, now)).toMatchObject({ state: "ok", reason: "paid" });
    expect(accessFrom({ status: "active", trialEndsAt: null, paidUntil: at(-5) }, now)).toMatchObject({ state: "blocked", reason: "paid" });
    expect(accessFrom({ status: "active", trialEndsAt: null, paidUntil: null }, now)).toMatchObject({ state: "ok", reason: "open" });
  });

  it("suspended or cancelled stops at once", () => {
    expect(accessFrom({ status: "suspended", trialEndsAt: null, paidUntil: at(100) }, now)).toMatchObject({ state: "blocked", reason: "suspended" });
    expect(accessFrom({ status: "cancelled", trialEndsAt: at(5), paidUntil: null }, now)).toMatchObject({ state: "blocked", reason: "cancelled" });
  });
});
