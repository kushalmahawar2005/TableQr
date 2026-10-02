import { describe, expect, it } from "vitest";
import { diningMinutesFor, localTime, overlaps, pacingState, serviceDate } from "./booking-policy";

describe("booking policy maths", () => {
  it("picks dining time by party size", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => diningMinutesFor(n))).toEqual([75, 75, 90, 90, 105, 105, 120, 120]);
  });

  it("converts outlet-local wall time to UTC and back to the service day", () => {
    expect(localTime("2026-10-01", 20 * 60, "Asia/Kolkata").toISOString()).toBe("2026-10-01T14:30:00.000Z");
    expect(serviceDate(new Date("2026-10-01T19:00:00Z"), "Asia/Kolkata")).toBe("2026-10-02");
    expect(localTime("2026-03-29", 9 * 60, "Europe/London").toISOString()).toBe("2026-03-29T08:00:00.000Z");
  });

  it("keeps the turnover gap free between ranges", () => {
    expect(overlaps(0, 60, 60, 120)).toBe(false);
    expect(overlaps(0, 60, 70, 120, 15)).toBe(true);
  });

  it("names pacing states", () => {
    expect([pacingState(10, 40), pacingState(32, 40), pacingState(40, 40), pacingState(0, 0)]).toEqual(["normal", "near", "full", "full"]);
  });
});
