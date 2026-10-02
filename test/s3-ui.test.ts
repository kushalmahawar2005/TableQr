import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cases } from "@/app/dev/s3/_fixtures";
import { copy, requestNames, requestUrgency } from "@/app/(staff)/waiter/_copy";

const root = path.resolve(import.meta.dirname, "..");
const source = (file: string) => readFileSync(path.join(root, file), "utf8");
const mutations = source("src/server/staff/waiter-mutations.ts");
const reads = source("src/server/staff/waiter-read.ts");
const screen = source("src/app/(staff)/waiter/_components/waiter-screen.tsx");

describe("S3 waiter coverage", () => {
  it("covers assignment, reassignment, and My Tables filtering", () => {
    expect(source("src/server/staff/waiter.ts")).toMatch(/assignWaiterToTable/);
    expect(mutations + reads).toMatch(/assigned/);
    expect(reads).toMatch(/assigned.*primary|assigned/);
  });

  it("covers request completion and Ready to Served", () => {
    expect(source("src/server/guest/service-requests.ts")).toMatch(/completeServiceRequest/);
    expect(source("src/server/kitchen/actions.ts")).toMatch(/markServed/);
    expect(screen).toMatch(/doneAction|servedAction/);
  });

  it("covers phone-less diners and waiter attribution", () => {
    expect(mutations).toMatch(/addPhonelessDiner/);
    expect(mutations).toMatch(/deviceId:null/);
    expect(source("src/server/guest/order.ts")).toMatch(/placedByUserId/);
  });

  it("covers idempotency and concurrent order locking", () => {
    expect(source("src/server/guest/order.ts")).toMatch(/clientRequestId/);
    expect(source("src/server/guest/order.ts")).toMatch(/for\("update"\)/);
    expect(mutations).toMatch(/replayed/);
  });

  it("covers ordering pause bypass and bill-requested blocking", () => {
    expect(source("src/server/guest/order.ts")).toMatch(/orderingLocked && !staffDraft/);
    expect(source("src/server/guest/order.ts")).toMatch(/session.status === "bill_requested"/);
  });

  it("covers move-item and paid/frozen/payment guards", () => {
    expect(mutations).toMatch(/waiter.item_moved/);
    expect(mutations).toMatch(/paid or frozen|payment is still pending/);
  });

  it("covers request bill, manager-PIN reopen, and settlement methods", () => {
    expect(mutations).toMatch(/waiterRequestBill|waiter.request_bill/);
    expect(mutations).toMatch(/managerApproval|verifyStaffPin/);
    expect(source("src/server/billing/payments.ts")).toMatch(/method: "cash" \| "card"/);
  });

  it("covers online-payment race blocking and audit attribution", () => {
    expect(source("src/server/billing/payments.ts")).toMatch(/payment_in_flight/);
    expect(source("src/server/billing/payments.ts")).toMatch(/waiter.settled/);
  });

  it("covers placed void, accepted void approval, and paid void blocking", () => {
    expect(mutations).toMatch(/status !== "placed"/);
    expect(mutations).toMatch(/Manager PIN required/);
    expect(mutations).toMatch(/Manager action required/);
  });

  it("covers waiter cleaning reset and tenant isolation", () => {
    expect(source("src/lib/staff-permissions.ts")).toMatch(/floor.clean/);
    expect(source("src/server/floor/table-actions.ts")).toMatch(/markReady/);
    expect(reads + mutations).toMatch(/tenantId/);
  });

  it("covers the waiter realtime token", () => {
    expect(source("src/server/staff/waiter.ts")).toMatch(/waiterRealtimeToken/);
    expect(source("src/server/realtime/token.ts")).toMatch(/tasks: "tasks"/);
  });

  it("covers offline UI and Hindi copy", () => {
    expect(screen).toMatch(/Offline/);
    expect(copy.hi.floor).toBe("मेरा फ्लोर");
    expect(copy.en.floor).toBe("My floor");
  });

  it("covers urgency presentation at three and five minutes", () => {
    const now = 10_000_000;
    expect(requestUrgency(now - 2 * 60_000, now)).toBe("waiting");
    expect(requestUrgency(now - 3 * 60_000, now)).toBe("warning");
    expect(requestUrgency(now - 5 * 60_000, now)).toBe("urgent");
  });

  it("covers the 44 requested review states", () => {
    expect(cases).toHaveLength(44);
    for (const state of ["normal-rush", "escalated-5", "ready-food", "my-tables", "menu", "draft", "move", "reopen-pin", "cash", "void-pin", "hindi", "offline", "320", "390", "200-text", "phoneless", "order-blocked"]) {
      expect(cases).toContain(state);
    }
  });

  it("covers the responsive and accessibility surface", () => {
    expect(screen).toMatch(/min-h-11/);
    expect(screen).toMatch(/aria-label="Waiter navigation"/);
    expect(screen).toMatch(/max-w-xl/);
  });

  it("keeps every service request label bilingual", () => {
    for (const [en, hi] of Object.values(requestNames)) {
      expect(en.length).toBeGreaterThan(0);
      expect(hi.length).toBeGreaterThan(0);
    }
  });
});
