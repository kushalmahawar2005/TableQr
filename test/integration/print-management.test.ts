import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { actorOf, MAX_NEW_JOBS_PER_MINUTE, prunePrintJobs, recentPrintJobs, recordPrintJob, type JobReport, type PrintActor } from "@/server/print/jobs";
import { archivePrinter, assignPrinters, printSetup, savePrinter } from "@/server/print/printers";
import { hashPin } from "@/server/staff/pin";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { resetTestDb } from "./setup-db";

// Printer management on the server: who may set printers up, that an outlet's printers stay its own,
// and that a print's record is idempotent, honest about its status, and never crosses restaurants.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession, manager: StaffSession, cashier: StaffSession, waiter: StaffSession, kitchen: StaffSession, otherManager: StaffSession;

const as = async (outletCode: string, phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode, phone, pin })).token))!;
const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AppError ? e.code : `other:${String(e)}`));
let n = 0;
const rid = () => `print-req-${++n}-${Math.random().toString(36).slice(2, 8)}`;
const report = (over: Partial<JobReport> = {}): JobReport => ({ requestId: rid(), kind: "bill", transport: "browser", paperMm: 80, status: "sent", subject: { type: "session", id: "sess-1" }, ...over });
const jobs = () => appDb.select().from(s.printJobs);

beforeAll(async () => {
  env = await resetTestDb();
  await env.db.insert(s.users).values({ id: uuidv7(), tenantId: env.other.tenantId, phone: "9000000098", name: "Other Manager", pinHash: await hashPin("9898") });
  const [u] = await env.db.select().from(s.users).where(eq(s.users.phone, "9000000098"));
  await env.db.insert(s.staffRoles).values({ tenantId: env.other.tenantId, userId: u.id, outletId: env.other.outletId, role: "manager" });
  owner = await as("SRJ01", "9000000001", "1111");
  manager = await as("SRJ01", "9000000002", "2222");
  cashier = await as("SRJ01", "9000000003", "3333");
  waiter = await as("SRJ01", "9000000005", "5555");
  kitchen = await as("SRJ01", "9000000006", "6666");
  otherManager = await as("CNJ01", "9000000098", "9898");
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("setting printers up", () => {
  it("lets a manager add printers with a roll width, and refuses anyone else", async () => {
    const counter = await savePrinter(manager, { name: "Counter printer", paperMm: 80, transport: "browser" });
    await savePrinter(owner, { name: "Kitchen printer", paperMm: 58, transport: "browser" });
    const setup = await printSetup(manager);
    expect(setup.printers.map((p) => [p.name, p.paperMm])).toEqual([["Counter printer", 80], ["Kitchen printer", 58]]);
    expect(setup.printers.find((p) => p.id === counter)).toMatchObject({ transport: "browser", config: null });
    for (const who of [cashier, waiter, kitchen]) expect(await code(savePrinter(who, { name: "Sneaky", paperMm: 80, transport: "browser" }))).toBe("forbidden");
  });

  it("refuses a bad name, a duplicate, a bad roll width and a connection that is not built", async () => {
    expect(await code(savePrinter(manager, { name: "  ", paperMm: 80, transport: "browser" }))).toBe("invalid_state");
    expect(await code(savePrinter(manager, { name: "x".repeat(61), paperMm: 80, transport: "browser" }))).toBe("invalid_state");
    expect(await code(savePrinter(manager, { name: "Counter printer", paperMm: 80, transport: "browser" }))).toBe("conflict");
    expect(await code(savePrinter(manager, { name: "Odd roll", paperMm: 70, transport: "browser" }))).toBe("invalid_state");
    for (const transport of ["bluetooth_ble", "bluetooth_spp", "network", "cloud", "made_up"]) {
      expect(await code(savePrinter(manager, { name: `Via ${transport}`, paperMm: 80, transport }))).toBe("invalid_state");
    }
    expect((await printSetup(manager)).printers).toHaveLength(2);
  });

  it("changes a printer in place and keeps names unique", async () => {
    const id = (await printSetup(manager)).printers.find((p) => p.name === "Kitchen printer")!.id;
    await savePrinter(manager, { id, name: "Kitchen printer", paperMm: 80, transport: "browser" });
    expect((await printSetup(manager)).printers.find((p) => p.id === id)!.paperMm).toBe(80);
    expect(await code(savePrinter(manager, { id, name: "Counter printer", paperMm: 80, transport: "browser" }))).toBe("conflict");
    await savePrinter(manager, { id, name: "Kitchen printer", paperMm: 58, transport: "browser" });
  });

  it("assigns a receipt and a kitchen printer, and clears an assignment when its printer is removed", async () => {
    const [counter, kitchenP] = (await printSetup(manager)).printers;
    await assignPrinters(manager, { receiptPrinterId: counter.id, kitchenPrinterId: kitchenP.id });
    expect(await printSetup(cashier)).toMatchObject({ receiptPrinterId: counter.id, kitchenPrinterId: kitchenP.id });
    const extra = await savePrinter(manager, { name: "Spare", paperMm: 58, transport: "browser" });
    await assignPrinters(manager, { receiptPrinterId: extra, kitchenPrinterId: kitchenP.id });
    await archivePrinter(manager, extra);
    const after = await printSetup(manager);
    expect(after.receiptPrinterId).toBeNull();
    expect(after.kitchenPrinterId).toBe(kitchenP.id);
    expect(after.printers.map((p) => p.name)).not.toContain("Spare");
    await assignPrinters(manager, { receiptPrinterId: counter.id, kitchenPrinterId: kitchenP.id });
    expect(await code(assignPrinters(cashier, { receiptPrinterId: counter.id, kitchenPrinterId: null }))).toBe("forbidden");
    expect(await code(assignPrinters(manager, { receiptPrinterId: extra, kitchenPrinterId: null }))).toBe("not_found");
  });

  it("writes who set printers up to the audit trail", async () => {
    const entries = await env.db.select().from(s.auditLog).where(eq(s.auditLog.entity, "printer"));
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(["printer.added", "printer.updated", "printer.removed"]));
  });
});

describe("one restaurant's printers are not another's", () => {
  it("never shows, changes, removes or assigns another restaurant's printer", async () => {
    const theirs = await savePrinter(otherManager, { name: "Counter printer", paperMm: 80, transport: "browser" });
    const mine = (await printSetup(manager)).printers.map((p) => p.id);
    expect(mine).not.toContain(theirs);
    expect((await printSetup(otherManager)).printers.map((p) => p.id)).toEqual([theirs]);
    expect(await code(savePrinter(manager, { id: theirs, name: "Taken over", paperMm: 58, transport: "browser" }))).toBe("not_found");
    expect(await code(archivePrinter(manager, theirs))).toBe("not_found");
    expect(await code(assignPrinters(manager, { receiptPrinterId: theirs, kitchenPrinterId: null }))).toBe("not_found");
    expect((await printSetup(otherManager)).printers[0]).toMatchObject({ id: theirs, name: "Counter printer", paperMm: 80 });
  });

  it("is enforced by the database too: a job cannot name another restaurant's printer", async () => {
    const [theirs] = await env.db.select().from(s.printers).where(eq(s.printers.tenantId, env.other.tenantId));
    await expect(env.db.insert(s.printJobs).values({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, printerId: theirs.id, kind: "bill", requestId: rid(), transport: "browser", paperMm: 80, status: "sent" })).rejects.toThrow();
  });
});

describe("recording a print", () => {
  it("records one job for 20 simultaneous reports of the same request", async () => {
    const r = report();
    const results = await Promise.all(Array.from({ length: 20 }, () => recordPrintJob(actorOf(cashier), r)));
    expect(new Set(results.map((x) => x.jobId)).size).toBe(1);
    expect(results.filter((x) => !x.duplicate)).toHaveLength(1);
    expect((await jobs()).filter((j) => j.requestId === r.requestId)).toHaveLength(1);
  });

  it("never records 'confirmed' for a transport that cannot confirm", async () => {
    const r = report();
    await recordPrintJob(actorOf(cashier), { ...r, status: "queued" });
    expect(await code(recordPrintJob(actorOf(cashier), { ...r, status: "confirmed" }))).toBe("invalid_state");
    expect(await code(recordPrintJob(actorOf(cashier), report({ status: "confirmed" })))).toBe("invalid_state");
    expect((await jobs()).find((j) => j.requestId === r.requestId)!.status).toBe("queued");
  });

  it("moves forward, counts a retry after a failure, and ignores a late report that would go backwards", async () => {
    const r = report({ status: "failed", failureCode: "browser_print_failed", failureDetail: "Window blocked" });
    const first = await recordPrintJob(actorOf(cashier), r);
    expect(first).toMatchObject({ status: "failed", attempts: 1 });
    const retry = await recordPrintJob(actorOf(cashier), { ...r, status: "sent" });
    expect(retry).toMatchObject({ status: "sent", attempts: 2, duplicate: false });
    const late = await recordPrintJob(actorOf(cashier), { ...r, status: "queued" });
    expect(late).toMatchObject({ status: "sent", duplicate: true });
    const row = (await jobs()).find((j) => j.requestId === r.requestId)!;
    expect(row).toMatchObject({ status: "sent", attempts: 2, failureCode: null, failureDetail: null });
  });

  it("links a reprint to its original and keeps what was printed", async () => {
    const original = await recordPrintJob(actorOf(cashier), report({ kind: "receipt", subject: { type: "session", id: "sess-9" } }));
    const again = await recordPrintJob(actorOf(waiter), report({ kind: "receipt", subject: { type: "session", id: "sess-9" }, reprintOf: original.jobId }));
    const row = (await jobs()).find((j) => j.id === again.jobId)!;
    expect(row).toMatchObject({ reprintOf: original.jobId, subjectType: "session", subjectId: "sess-9", kind: "receipt" });
  });

  it("checks who may print which slip", async () => {
    expect(await code(recordPrintJob(actorOf(waiter), report({ kind: "bill" })))).toBeNull();
    expect(await code(recordPrintJob(actorOf(waiter), report({ kind: "kot" })))).toBeNull();
    expect(await code(recordPrintJob(actorOf(kitchen), report({ kind: "kot" })))).toBeNull();
    expect(await code(recordPrintJob(actorOf(kitchen), report({ kind: "bill" })))).toBe("forbidden");
    expect(await code(recordPrintJob(actorOf(kitchen), report({ kind: "day_close" })))).toBe("forbidden");
    expect(await code(recordPrintJob(actorOf(cashier), report({ kind: "day_close" })))).toBe("forbidden");
    expect(await code(recordPrintJob(actorOf(cashier), report({ kind: "test" })))).toBe("forbidden");
    expect(await code(recordPrintJob(actorOf(manager), report({ kind: "day_close" })))).toBeNull();
    expect(await code(recordPrintJob(actorOf(manager), report({ kind: "test" })))).toBeNull();
  });

  it("lets a kitchen wall screen report kitchen tickets and nothing else", async () => {
    const wall: PrintActor = { tenantId: env.demo.tenantId, outletId: env.demo.outletId, roles: [], userId: null, deviceId: uuidv7() };
    const ok = await recordPrintJob(wall, report({ kind: "kot", subject: { type: "ticket", id: "t-1" } }));
    expect((await jobs()).find((j) => j.id === ok.jobId)).toMatchObject({ deviceId: wall.deviceId, actorUserId: null });
    for (const kind of ["bill", "receipt", "day_close", "test", "order_slip"]) expect(await code(recordPrintJob(wall, report({ kind })))).toBe("forbidden");
  });

  it("refuses malformed reports", async () => {
    const bad: Partial<JobReport>[] = [{ kind: "nonsense" }, { requestId: "short" }, { requestId: "has spaces in it!!" }, { transport: "carrier_pigeon" }, { paperMm: 72 }, { status: "done" }, { subject: { type: "Bad Type", id: "x" } }];
    for (const over of bad) expect(await code(recordPrintJob(actorOf(manager), report(over))), JSON.stringify(over)).toBe("invalid_state");
  });
});

describe("a shared printer used from several devices", () => {
  it("records each staff member's prints on it, and keeps the other restaurant's out", async () => {
    const printerId = (await printSetup(manager)).printers[0].id;
    const a = await recordPrintJob(actorOf(cashier), report({ printerId, subject: { type: "session", id: "shared-1" } }));
    const b = await recordPrintJob(actorOf(waiter), report({ printerId, subject: { type: "session", id: "shared-2" } }));
    const rows = await jobs();
    expect(rows.find((j) => j.id === a.jobId)).toMatchObject({ printerId, actorUserId: cashier.userId });
    expect(rows.find((j) => j.id === b.jobId)).toMatchObject({ printerId, actorUserId: waiter.userId });
    expect(await code(recordPrintJob(actorOf(otherManager), report({ printerId })))).toBe("not_found");
    const theirs = await recordPrintJob(actorOf(otherManager), report({ kind: "bill" }));
    expect((await recentPrintJobs(manager, 50)).map((j) => j.id)).not.toContain(theirs.jobId);
    expect((await recentPrintJobs(otherManager, 50)).map((j) => j.id)).toEqual([theirs.jobId]);
  });

  it("lets two restaurants use the same request id without meeting", async () => {
    const r = report();
    const mine = await recordPrintJob(actorOf(manager), r);
    const theirs = await recordPrintJob(actorOf(otherManager), r);
    expect(mine.jobId).not.toBe(theirs.jobId);
    expect(mine.duplicate || theirs.duplicate).toBe(false);
  });
});

describe("print history", () => {
  it("is for managers and owners, newest first, with the printer's name", async () => {
    expect(await code(recentPrintJobs(cashier))).toBe("forbidden");
    const rows = await recentPrintJobs(manager, 5);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.at)).toEqual([...rows.map((r) => r.at)].sort((x, y) => y - x));
    expect(rows.find((r) => r.printerName)).toMatchObject({ printerName: "Counter printer" });
  });

  it("is cleared after 60 days, only the old, a batch at a time", async () => {
    const old = await recordPrintJob(actorOf(manager), report({ subject: { type: "session", id: "old-1" } }));
    await env.db.update(s.printJobs).set({ createdAt: new Date(Date.now() - 61 * 86_400_000) }).where(eq(s.printJobs.id, old.jobId));
    const before = (await jobs()).length;
    expect(await prunePrintJobs(new Date(), 60, 500)).toBe(1);
    expect((await jobs()).length).toBe(before - 1);
    expect((await jobs()).find((j) => j.id === old.jobId)).toBeUndefined();
  });
});

describe("a stuck screen cannot fill the table", () => {
  it("refuses new records past the per-minute limit, but still answers one already recorded", async () => {
    const known = await recordPrintJob(actorOf(manager), report({ subject: { type: "session", id: "flood-known" } }));
    const rows = Array.from({ length: MAX_NEW_JOBS_PER_MINUTE }, (_, i) => ({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, kind: "bill", subjectType: "flood", subjectId: `f-${i}`, requestId: `flood-request-${i}`, transport: "browser", paperMm: 80, status: "sent" as const }));
    await env.db.insert(s.printJobs).values(rows);
    try {
      expect(await code(recordPrintJob(actorOf(manager), report()))).toBe("rate_limited");
      expect(await recordPrintJob(actorOf(manager), { ...report({ kind: "bill" }), requestId: (await jobs()).find((j) => j.id === known.jobId)!.requestId, status: "sent" })).toMatchObject({ jobId: known.jobId });
      // Another restaurant is not held back by this one
      expect(await code(recordPrintJob(actorOf(otherManager), report()))).toBeNull();
    } finally {
      await env.db.delete(s.printJobs).where(eq(s.printJobs.subjectType, "flood"));
    }
    expect(await code(recordPrintJob(actorOf(manager), report()))).toBeNull();
  });
});

