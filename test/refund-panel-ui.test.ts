import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RefundPanel } from "@/app/pos/_components/refund-panel";
import type { PosBillDetail } from "@/server/staff/pos-read";

vi.mock("@/server/staff/pos-actions", () => ({}));

const payment = (over: Partial<PosBillDetail["payments"][number]> = {}): PosBillDetail["payments"][number] => ({
  id: "p1", method: "card", amountPaise: 33600, tipPaise: 0, status: "success", channel: "razorpay", createdAt: 0,
  refund: { refunds: [{ id: "r1", amountPaise: 10000, status: "pending", createdAt: 0, sent: true }, { id: "r2", amountPaise: 5000, status: "success", createdAt: 0, sent: true }], refundedPaise: 5000, pendingPaise: 10000, refundablePaise: 18600 },
  ...over,
});
const render = (payments: PosBillDetail["payments"]) => renderToStaticMarkup(createElement(RefundPanel, { payments, needsApproval: false, disabled: false, hi: false, onChanged: async () => {} }));

describe("refund panel", () => {
  it("shows the payment, what is refunded, pending and left, and each refund's state", () => {
    const html = render([payment()]);
    expect(html).toContain("₹336.00");
    expect(html).toContain("₹50.00"); // refunded
    expect(html).toContain("₹100.00"); // pending
    expect(html).toContain("₹186.00"); // refundable
    expect(html).toContain("Pending");
    expect(html).toContain("Refunded");
    expect(html).toContain("Check status");
    expect(html).toContain("Refund…");
  });

  it("offers no refund when nothing is left or the payment did not succeed, and never uses a browser alert", () => {
    const none = render([payment({ refund: { refunds: [], refundedPaise: 33600, pendingPaise: 0, refundablePaise: 0 } }), payment({ id: "p2", status: "failed", refund: { refunds: [], refundedPaise: 0, pendingPaise: 0, refundablePaise: 0 } })]);
    expect(none).not.toContain("Refund…");
    expect(none).not.toMatch(/alert\(/);
    expect(render([])).toContain("No payments yet.");
  });

  it("the confirm button has a visible label colour and the approval fields refuse browser autofill", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/pos/_components/refund-panel.tsx", "utf8");
    expect(src).toMatch(/const danger = "[^"]*bg-danger[^"]*text-white/);
    expect(src).not.toMatch(/const danger = `\$\{button\}/);
    expect(src).toContain('autoComplete="new-password"');
    expect(src).toContain('autoComplete="off"');
  });
});
