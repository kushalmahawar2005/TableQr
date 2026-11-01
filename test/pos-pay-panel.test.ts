import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const panel = read("src/app/(console)/console/(app)/pos/_components/pos-pay-panel.tsx");
const screen = read("src/app/(console)/console/(app)/pos/_components/pos-terminal-screen.tsx");

describe("paying inside the POS", () => {
  it("offers cash and UPI and records UPI as UPI", () => {
    expect(panel).toMatch(/id: "cash"/);
    expect(panel).toMatch(/id: "upi"/);
    expect(panel).not.toMatch(/id: "card"/);
    expect(read("src/server/staff/pos-actions.ts")).toMatch(/method: "cash" \| "card" \| "upi"/);
  });

  it("uses one request id per payment so a retry cannot charge twice", () => {
    expect(panel).toMatch(/settleKey\.current \?\?= crypto\.randomUUID\(\)/);
  });

  it("blocks short cash, offline taps and a payment still being checked", () => {
    expect(panel).toMatch(/disabled=\{busy \|\| offline \|\| pendingOnline \|\| dueNow <= 0 \|\| short\}/);
  });

  it("opens the panel on this screen and only falls back to Billing when the bill cannot load", () => {
    expect(screen).toMatch(/setPaying\(ready\.data\)/);
    expect(screen).toMatch(/else router\.push\(`\/console\/billing\?session=/);
  });
});
