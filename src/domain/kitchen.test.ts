import { describe, expect, it } from "vitest";
import { deriveOrderStatus, ticketUrgency } from "./kitchen";

describe("deriveOrderStatus", () => {
  it("follows the slowest live line", () => {
    expect(deriveOrderStatus(["placed", "placed"])).toBe("placed");
    expect(deriveOrderStatus(["accepted", "accepted"])).toBe("accepted");
    expect(deriveOrderStatus(["ready", "ready"])).toBe("ready");
    expect(deriveOrderStatus(["served", "served"])).toBe("served");
  });

  it("shows preparing as soon as any station starts or finishes", () => {
    expect(deriveOrderStatus(["accepted", "preparing"])).toBe("preparing");
    expect(deriveOrderStatus(["accepted", "ready"])).toBe("preparing");
    expect(deriveOrderStatus(["ready", "served"])).toBe("ready");
  });

  it("ignores voided and cancelled lines, and is cancelled when nothing is left", () => {
    expect(deriveOrderStatus(["ready", "voided"])).toBe("ready");
    expect(deriveOrderStatus(["cancelled", "voided"])).toBe("cancelled");
  });
});

describe("ticketUrgency", () => {
  const min = 60_000;
  it("turns amber at the target time and red at 1.5 times it", () => {
    expect(ticketUrgency(2 * min, 15, false)).toBe("new");
    expect(ticketUrgency(2 * min, 15, true)).toBe("on_time");
    expect(ticketUrgency(15 * min, 15, true)).toBe("getting_late");
    expect(ticketUrgency(22.4 * min, 15, true)).toBe("getting_late");
    expect(ticketUrgency(22.5 * min, 15, false)).toBe("late");
  });
});
