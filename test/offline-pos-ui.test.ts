import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const screen = readFileSync(path.join(root, "src/app/(console)/console/(app)/pos/_components/pos-terminal-screen.tsx"), "utf8");
const actions = readFileSync(path.join(root, "src/app/(console)/console/(app)/pos/actions.ts"), "utf8");
const posServer = readFileSync(path.join(root, "src/server/staff/pos-terminal.ts"), "utf8");
const permissions = readFileSync(path.join(root, "src/lib/staff-permissions.ts"), "utf8");

describe("offline POS recovery guidance", () => {
  it("keeps a queued KOT bound to its original staff identity and gives a safe recovery path", () => {
    expect(screen).toMatch(/order\.staffUserId !== staffUserId/);
    expect(screen).toMatch(/Sign back into that account on this device to sync it/);
    expect(screen).toMatch(/do not enter the order again/);
    expect(screen).toMatch(/ask the owner to review it/);
  });

  it("warns against collecting cash twice when another staff account owns the local record", () => {
    expect(screen).toMatch(/cash\.staffUserId !== staffUserId/);
    expect(screen).toMatch(/do not collect cash for this bill again until it is checked/);
  });

  it("shows the saved order for explicit manager review and records the approval before retry", () => {
    expect(screen).toMatch(/Review & approve replay/);
    expect(screen).toMatch(/reviewOrder\.lines\.map/);
    expect(screen).toMatch(/approveOfflineOrderAction/);
    expect(actions).toMatch(/pos\.offline_order_approved/);
    expect(posServer).toMatch(/managerApprovedOfflineRequestId/);
    expect(posServer).toMatch(/This manager approval does not match the saved order details/);
  });

  it("offers a clearly marked local kitchen print and permits POS roles to print KOTs", () => {
    expect(screen).toMatch(/Print local kitchen copy/);
    expect(screen).toMatch(/not a server KOT/);
    expect(permissions).toMatch(/kot: \["cashier", "reception", "kitchen", "waiter", "manager", "owner"\]/);
  });
});
