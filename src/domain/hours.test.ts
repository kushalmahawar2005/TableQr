import { describe, expect, it } from "vitest";
import { dayCutoffMinutes, inWindow, isOpenAt, localClock, nextLocalMidnight, openingInfo } from "./hours";

const IST = "Asia/Kolkata";
// 2026-10-03 is a Saturday. 14:30Z is 20:00 IST.
const satEvening = new Date("2026-10-03T14:30:00Z");

describe("localClock", () => {
  it("reads the day and time in the outlet timezone", () => {
    expect(localClock(satEvening, IST)).toEqual({ day: "sat", minutes: 20 * 60 });
    // 20:00Z Friday is 01:30 IST Saturday
    expect(localClock(new Date("2026-10-02T20:00:00Z"), IST)).toEqual({ day: "sat", minutes: 90 });
  });
});

describe("isOpenAt", () => {
  const lunchAndDinner = { sat: [["12:00", "15:00"], ["19:00", "23:30"]] as [string, string][] };

  it("is open inside a window and closed between windows", () => {
    expect(isOpenAt(lunchAndDinner, IST, satEvening)).toBe(true);
    expect(isOpenAt(lunchAndDinner, IST, new Date("2026-10-03T11:30:00Z"))).toBe(false); // 17:00 IST
  });

  it("closes exactly at the closing time", () => {
    expect(isOpenAt(lunchAndDinner, IST, new Date("2026-10-03T17:59:00Z"))).toBe(true); // 23:29
    expect(isOpenAt(lunchAndDinner, IST, new Date("2026-10-03T18:00:00Z"))).toBe(false); // 23:30
  });

  it("keeps a late Friday window open after midnight", () => {
    const lateFriday = { fri: [["18:00", "02:00"]] as [string, string][] };
    expect(isOpenAt(lateFriday, IST, new Date("2026-10-02T20:00:00Z"))).toBe(true); // Sat 01:30
    expect(isOpenAt(lateFriday, IST, new Date("2026-10-02T21:00:00Z"))).toBe(false); // Sat 02:30
  });

  it("treats a day with no hours as closed and no configuration as open", () => {
    expect(isOpenAt({ mon: [["12:00", "23:00"]] }, IST, satEvening)).toBe(false);
    expect(isOpenAt(null, IST, satEvening)).toBe(true);
  });

  it("treats 00:00 to 24:00 as open all day", () => {
    expect(isOpenAt({ sat: [["00:00", "24:00"]] }, IST, new Date("2026-10-03T18:29:00Z"))).toBe(true); // 23:59
  });
});

describe("nextLocalMidnight", () => {
  it("is the end of the outlet's day, not the server's", () => {
    // 20:00 IST Saturday -> 00:00 IST Sunday = 18:30Z Saturday
    expect(nextLocalMidnight(satEvening, IST).toISOString()).toBe("2026-10-03T18:30:00.000Z");
    // 01:30 IST Saturday (still Friday in UTC) -> 00:00 IST Sunday
    expect(nextLocalMidnight(new Date("2026-10-02T20:00:15.500Z"), IST).toISOString()).toBe("2026-10-03T18:30:00.000Z");
  });
});

describe("inWindow", () => {
  it("handles category time windows, including ones that wrap midnight", () => {
    expect(inWindow(8 * 60, "07:00:00", "11:00:00")).toBe(true);
    expect(inWindow(12 * 60, "07:00:00", "11:00:00")).toBe(false);
    expect(inWindow(60, "22:00", "02:00")).toBe(true);
  });
});

describe("openingInfo", () => {
  const lunchAndDinner = { sat: [["12:00", "15:00"], ["19:00", "23:30"]], mon: [["12:00", "23:30"]] } as Record<
    string,
    [string, string][]
  >;

  it("says when the current window closes", () => {
    expect(openingInfo(lunchAndDinner, IST, satEvening)).toEqual({ isOpen: true, closesAt: "23:30", nextOpen: null });
  });

  it("finds the next window later the same day", () => {
    // 17:00 IST Saturday, between lunch and dinner
    expect(openingInfo(lunchAndDinner, IST, new Date("2026-10-03T11:30:00Z")).nextOpen).toEqual({
      day: "sat",
      time: "19:00",
      inDays: 0,
    });
  });

  it("skips closed days to the next opening", () => {
    // 23:45 IST Saturday; Sunday has no hours, Monday opens at noon
    expect(openingInfo(lunchAndDinner, IST, new Date("2026-10-03T18:15:00Z"))).toEqual({
      isOpen: false,
      closesAt: null,
      nextOpen: { day: "mon", time: "12:00", inDays: 2 },
    });
  });

  it("reads a late window that runs past midnight", () => {
    const lateFriday = { fri: [["18:00", "02:00"]] } as Record<string, [string, string][]>;
    // 01:30 IST Saturday
    expect(openingInfo(lateFriday, IST, new Date("2026-10-02T20:00:00Z")).closesAt).toBe("02:00");
  });

  it("treats an outlet with no hours as always open", () => {
    expect(openingInfo(null, IST, satEvening)).toEqual({ isOpen: true, closesAt: null, nextOpen: null });
  });
});

describe("business day cutoff", () => {
  it("is midnight unless a window runs past midnight", () => {
    expect(dayCutoffMinutes(null)).toBe(0);
    expect(dayCutoffMinutes({ mon: [["11:00", "23:30"]] })).toBe(0);
  });

  it("ends an hour after the latest past-midnight closing, rounded up to the hour, at most 6 am", () => {
    expect(dayCutoffMinutes({ fri: [["18:00", "02:00"]], sat: [["18:00", "01:15"]] })).toBe(180);
    expect(dayCutoffMinutes({ sat: [["20:00", "00:00"]] })).toBe(60);
    expect(dayCutoffMinutes({ sat: [["20:00", "07:00"]] })).toBe(360);
  });
});
