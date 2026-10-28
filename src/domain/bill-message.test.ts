import { describe, expect, it } from "vitest";
import { billMessage, whatsappLink, whatsappNumber } from "./bill-message";

describe("bill on WhatsApp", () => {
  it("formats a concise bill and due message with a share link", () => {
    const text = billMessage({ outlet: "BMW", table: "T4", kind: "bill", phone: "6367828788", date: "2026-10-20T10:00:00.000Z", totalPaise: 100000, paidPaise: 50000, link: "https://x.test/b/abc.def" });
    expect(text).toContain("*BMW · 6367828788*");
    expect(text).toContain("Bill: ₹1,000");
    expect(text).toContain("Due: ₹500");
    expect(text).toContain("Date: 20 Oct 2026");
    expect(text).toContain("*View bill*\nhttps://x.test/b/abc.def");
    expect(text).toContain("Sent via Tableeqr");
    expect(text).not.toContain("Tomato Soup");
  });

  it("accepts Indian mobile numbers in any common shape and builds the link", () => {
    expect(whatsappNumber("98765 43210")).toBe("919876543210");
    expect(whatsappNumber("+91-9876543210")).toBe("919876543210");
    expect(whatsappNumber("09876543210")).toBe("919876543210");
    expect(whatsappNumber("12345")).toBeNull();
    expect(whatsappLink("Hi there", "9876543210")).toBe("https://wa.me/919876543210?text=Hi%20there");
    expect(whatsappLink("Hi")).toBe("https://wa.me/?text=Hi");
  });

  it("keeps a receipt's paid amount distinct from a bill's due amount", () => {
    const text = billMessage({ outlet: "Spice Route", table: "T4", kind: "receipt", totalPaise: 49140, paidPaise: 49140 });
    expect(text).toContain("Receipt: ₹491.40");
    expect(text).toContain("Paid: ₹491.40");
  });
});
