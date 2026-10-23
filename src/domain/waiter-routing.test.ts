import { describe, expect, it } from "vitest";
import { chooseWaiter, type WaiterLoad } from "./waiter-routing";
const w = (id: string, overrides: Partial<WaiterLoad> = {}): WaiterLoad => ({ id, duty: "on", activeTables: 0, pendingRequests: 0, readyOrders: 0, ...overrides });

describe("waiter workload routing", () => {
  it("sends new work to a free waiter instead of a busy preferred waiter", () => {
    expect(chooseWaiter([w("busy", { pendingRequests: 3 }), w("free")], "busy")?.id).toBe("free");
  });
  it("keeps shift continuity when workloads differ by at most one table", () => {
    expect(chooseWaiter([w("preferred", { activeTables: 1 }), w("free")], "preferred")?.id).toBe("preferred");
  });
  it("excludes staff on break, off duty, and the waiter being handed over", () => {
    expect(chooseWaiter([w("a", { duty: "break" }), w("b", { duty: "off" })])).toBeNull();
    expect(chooseWaiter([w("a"), w("b")], "a", "a")?.id).toBe("b");
  });
  it("counts ready food and produces the same result regardless of input order", () => {
    const rows = [w("a", { readyOrders: 2 }), w("c"), w("b")];
    expect(chooseWaiter(rows)?.id).toBe("b");
    expect(chooseWaiter([...rows].reverse())?.id).toBe("b");
  });
});
