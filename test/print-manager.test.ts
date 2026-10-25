import { describe, expect, it, vi } from "vitest";
import { PrintManager, refusal, type DevicePrefs, type JobReport, type ManagerDeps, type PrinterRef, type PrintRequest, type SetupData } from "@/lib/print/manager";
import { canMove, describeJob, roleForKind } from "@/lib/print/jobs";
import { getTransport, type PrintTransport } from "@/lib/print/transports";

// The print manager with no browser and no server: which printer a slip goes to, what is told about
// it, and that a double tap or a retry never prints (or records) twice.

const P = (id: string, over: Partial<PrinterRef> = {}): PrinterRef => ({ id, name: `Printer ${id}`, paperMm: 80, transport: "browser", config: null, ...over });
const setupOf = (over: Partial<SetupData> = {}): SetupData => ({ outletId: "o1", printers: [P("a"), P("b", { paperMm: 58 }), P("k")], receiptPrinterId: "a", kitchenPrinterId: "k", ...over });

function fake(over: Partial<PrintTransport> = {}): PrintTransport & { send: ReturnType<typeof vi.fn> } {
  return {
    id: "browser", label: "Fake", description: "", capabilities: { confirmation: "none", silent: false, runsOn: "this_device", shared: false }, implemented: true,
    availability: () => ({ ok: true }), validateConfig: () => ({ ok: true, config: null }),
    send: vi.fn(async () => ({ status: "sent" as const })), ...over,
  } as never;
}

function rig(o: { setup?: SetupData | null; prefs?: DevicePrefs; browser?: ReturnType<typeof fake>; transports?: Record<string, PrintTransport>; report?: ManagerDeps["report"]; guardMs?: number; stored?: JobReport[] } = {}) {
  let now = 1_000_000;
  let n = 0;
  const browser = o.browser ?? fake();
  const reports: JobReport[] = [];
  const saved: JobReport[][] = [];
  const manager = new PrintManager({
    prefs: () => o.prefs ?? { receiptPrinterId: null, kitchenPrinterId: null },
    paperSaved: () => 80,
    report: o.report ?? (async (r) => { reports.push(r); return { jobId: `job-${r.requestId}`, status: r.status as never, attempts: 1, duplicate: false }; }),
    transport: (id) => (id === "browser" ? browser : o.transports?.[id] ?? getTransport(id)),
    now: () => now,
    uuid: () => `req-${String(++n).padStart(8, "0")}`,
    guardMs: o.guardMs ?? 3000,
    storage: { load: () => o.stored ?? [], save: (r) => { saved.push([...r]); } },
  });
  manager.setSetup(o.setup === undefined ? setupOf() : o.setup);
  return { manager, browser, reports, saved, tick: (ms: number) => { now += ms; } };
}
const bill = (id = "s1", over: Partial<PrintRequest> = {}): PrintRequest => ({ kind: "bill", subject: { type: "session", id }, build: (paper) => `<html>${paper}</html>`, ...over });

describe("which printer a slip goes to", () => {
  it("uses the outlet's receipt printer for bills and its kitchen printer for tickets", async () => {
    const { manager } = rig();
    expect((await manager.print(bill())).printerId).toBe("a");
    expect((await manager.print({ kind: "kot", subject: { type: "ticket", id: "t1" }, build: () => "kot" })).printerId).toBe("k");
    expect(roleForKind("kot")).toBe("kitchen");
    expect(["receipt", "bill", "order_slip", "day_close", "test"].every((k) => roleForKind(k as never) === "receipt")).toBe(true);
  });

  it("lets this device's own choice win, and falls back to the outlet's when that printer is gone", async () => {
    expect((await rig({ prefs: { receiptPrinterId: "b", kitchenPrinterId: null } }).manager.print(bill())).printerId).toBe("b");
    expect((await rig({ prefs: { receiptPrinterId: "removed", kitchenPrinterId: null } }).manager.print(bill())).printerId).toBe("a");
  });

  it("builds the slip for the printer's roll, and for the device's own paper when no printer is set", async () => {
    const built: number[] = [];
    const req = (id: string): PrintRequest => bill(id, { build: (paper) => { built.push(paper); return "x"; } });
    await rig({ prefs: { receiptPrinterId: "b", kitchenPrinterId: null } }).manager.print(req("s1"));
    await rig({ setup: setupOf({ printers: [], receiptPrinterId: null }) }).manager.print(req("s2"));
    await rig({ setup: null }).manager.print(req("s3"));
    expect(built).toEqual([58, 80, 80]);
  });

  it("prints a test on the printer asked for, whatever the settings say", async () => {
    const run = await rig().manager.print({ kind: "test", printerId: "b", build: () => "t" });
    expect(run).toMatchObject({ printerId: "b", paperMm: 58 });
  });

  it("still prints, through the browser, before any printer is set up", async () => {
    const { manager, browser } = rig({ setup: null });
    const run = await manager.print(bill());
    expect(run).toMatchObject({ status: "sent", printerId: null, transport: "browser" });
    expect(browser.send).toHaveBeenCalledOnce();
  });
});

describe("honest statuses", () => {
  it("says sent, never printed, for a transport that cannot confirm", async () => {
    const run = await rig().manager.print(bill());
    expect(run).toMatchObject({ status: "sent", confirmable: false });
    expect(run.message).toMatch(/cannot confirm that paper came out/);
  });

  it("does not let a transport claim confirmation it cannot give", async () => {
    const run = await rig({ browser: fake({ send: vi.fn(async () => ({ status: "confirmed" as const })) as never }) }).manager.print(bill());
    expect(run.status).toBe("sent");
  });

  it("reaches confirmed only through a transport whose printer can say so", async () => {
    const net = fake({ id: "network", capabilities: { confirmation: "printer", silent: true, runsOn: "server", shared: true }, send: vi.fn(async () => ({ status: "confirmed" as const })) as never });
    const { manager } = rig({ setup: setupOf({ printers: [P("n", { transport: "network" })], receiptPrinterId: "n" }), transports: { network: net } });
    const run = await manager.print(bill());
    expect(run).toMatchObject({ status: "confirmed", confirmable: true });
    expect(run.message).toMatch(/printer confirmed/);
  });

  it("reports a failure with its reason and whether trying again is worth it", async () => {
    const browser = fake({ send: vi.fn(async () => ({ status: "failed" as const, code: "browser_print_failed", message: "Window blocked.", retryable: true })) as never });
    const run = await rig({ browser }).manager.print(bill());
    expect(run).toMatchObject({ status: "failed", retryable: true, code: "browser_print_failed" });
    expect(run.message).toContain("Window blocked.");
  });

  it("turns a slip that cannot be built into a failure, never a thrown error", async () => {
    const run = await rig().manager.print(bill("s1", { build: () => { throw new Error("bad data"); } }));
    expect(run).toMatchObject({ status: "failed", code: "build_failed", retryable: false });
  });

  it("falls back to the browser when the printer's own connection is not built or not available", async () => {
    const { manager, browser } = rig({ setup: setupOf({ printers: [P("n", { transport: "bluetooth_ble" })], receiptPrinterId: "n" }) });
    const run = await manager.print(bill());
    expect(run).toMatchObject({ status: "sent", transport: "browser", usedFallback: true, printerId: "n" });
    expect(browser.send).toHaveBeenCalledOnce();
  });
});

describe("a double tap prints once", () => {
  it("answers a second tap on the same slip with the first print, and sends once", async () => {
    const { manager, browser, reports, tick } = rig();
    const first = await manager.print(bill());
    const second = await manager.print(bill());
    expect(browser.send).toHaveBeenCalledOnce();
    expect(second).toMatchObject({ duplicate: true, requestId: first.requestId });
    expect(second.message).toMatch(/not printed twice/);
    expect(reports).toHaveLength(1);
    tick(3500);
    await manager.print(bill());
    expect(browser.send).toHaveBeenCalledTimes(2);
  });

  it("treats two taps arriving together as one", async () => {
    const { manager, browser } = rig();
    await Promise.all([manager.print(bill()), manager.print(bill()), manager.print(bill())]);
    expect(browser.send).toHaveBeenCalledOnce();
  });

  it("does not hold back a different slip, or a retry after a failure", async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: "failed", code: "browser_print_failed", message: "no", retryable: true }).mockResolvedValue({ status: "sent" });
    const { manager } = rig({ browser: fake({ send: send as never }) });
    expect((await manager.print(bill("s1"))).status).toBe("failed");
    expect((await manager.print(bill("s1"))).status).toBe("sent");
    expect((await manager.print(bill("s2"))).status).toBe("sent");
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe("retry and reprint", () => {
  it("retries a failed print as the same job, one attempt later", async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: "failed", code: "browser_print_failed", message: "no", retryable: true }).mockResolvedValue({ status: "sent" });
    const { manager, reports } = rig({ browser: fake({ send: send as never }) });
    const failed = await manager.print(bill());
    const again = await manager.retry();
    expect(again).toMatchObject({ requestId: failed.requestId, status: "sent", attempts: 2 });
    expect(reports.map((r) => [r.requestId, r.status])).toEqual([[failed.requestId, "failed"], [failed.requestId, "sent"]]);
    expect(await manager.retry()).toBeNull();
  });

  it("reprints as a new job linked to the one before, with the slip rebuilt from current data", async () => {
    const { manager, reports } = rig();
    let total = 100;
    const req = bill("s1", { build: () => `total ${total}` });
    const first = await manager.print(req);
    await manager.flush();
    total = 250;
    const again = await manager.printAgain();
    expect(again!.requestId).not.toBe(first.requestId);
    expect(reports[1]).toMatchObject({ requestId: again!.requestId, reprintOf: `job-${first.requestId}` });
  });

  it("offers the browser when the printer's own way failed, as a new linked job", async () => {
    const dead = fake({ id: "network", capabilities: { confirmation: "printer", silent: true, runsOn: "server", shared: true }, send: vi.fn(async () => ({ status: "failed" as const, code: "offline", message: "Printer offline.", retryable: true })) as never });
    const { manager, browser } = rig({ setup: setupOf({ printers: [P("n", { transport: "network" })], receiptPrinterId: "n" }), transports: { network: dead } });
    const failed = await manager.print(bill());
    expect(failed.status).toBe("failed");
    const viaBrowser = await manager.useBrowser();
    expect(viaBrowser).toMatchObject({ status: "sent", transport: "browser" });
    expect(viaBrowser!.requestId).not.toBe(failed.requestId);
    expect(browser.send).toHaveBeenCalledOnce();
  });
});

describe("recording prints without losing any", () => {
  it("keeps a record the server could not take, and sends it when the connection is back", async () => {
    let up = false;
    const sent: JobReport[] = [];
    const { manager, saved } = rig({ report: async (r) => { if (!up) throw new Error("offline"); sent.push(r); return { jobId: "j", status: "sent", attempts: 1, duplicate: false }; } });
    await manager.print(bill("s1"));
    expect(manager.getSnapshot().unsent).toBe(1);
    expect(saved.at(-1)).toHaveLength(1);
    await manager.print(bill("s2", { kind: "receipt" }));
    expect(manager.getSnapshot().unsent).toBe(2);
    up = true;
    await manager.flush();
    expect(sent.map((r) => r.kind)).toEqual(["bill", "receipt"]);
    expect(manager.getSnapshot().unsent).toBe(0);
    expect(saved.at(-1)).toEqual([]);
  });

  it("picks up records saved before a reload", async () => {
    const stored: JobReport[] = [{ requestId: "old-request-1", kind: "bill", transport: "browser", paperMm: 80, status: "sent" }];
    const { manager, reports } = rig({ stored });
    expect(manager.getSnapshot().unsent).toBe(1);
    await manager.flush();
    expect(reports.map((r) => r.requestId)).toEqual(["old-request-1"]);
  });

  it("drops a record the server refuses instead of sending it for ever", async () => {
    const { manager } = rig({ report: async () => { throw refusal("Your role can't print this."); } });
    await manager.print(bill());
    expect(manager.getSnapshot().unsent).toBe(0);
  });

  it("never lets a record failure change the print's result", async () => {
    const { manager } = rig({ report: async () => { throw new Error("down"); } });
    expect((await manager.print(bill())).status).toBe("sent");
  });
});

describe("job statuses", () => {
  it("moves forward only, and confirms only when the transport can", () => {
    expect(canMove("queued", "sent", false)).toBe(true);
    expect(canMove("sent", "confirmed", false)).toBe(false);
    expect(canMove("sent", "confirmed", true)).toBe(true);
    expect(canMove("sent", "queued", false)).toBe(false);
    expect(canMove("confirmed", "failed", true)).toBe(false);
    expect(canMove("failed", "sent", false)).toBe(true);
    expect(canMove("cancelled", "sent", false)).toBe(false);
  });

  it("describes each status without claiming more than is known", () => {
    expect(describeJob("sent", { confirmable: false })).toMatch(/cannot confirm/);
    expect(describeJob("sent", { confirmable: true })).toMatch(/Waiting for the printer/);
    expect(describeJob("confirmed", { confirmable: true, printerName: "Counter" })).toBe("Printed for Counter. The printer confirmed it.");
    expect(describeJob("failed", { confirmable: false, detail: "Out of paper." })).toBe("Could not print. Out of paper.");
  });
});
