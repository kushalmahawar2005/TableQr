import { describe, expect, it } from "vitest";
import { billMessage, whatsappLink, whatsappNumber } from "./bill-message";

describe("bill on WhatsApp", () => {
  it("writes the bill as a short message with only the lines that apply", () => {
    const text = billMessage({ outlet: "Spice Route", table: "T4", kind: "bill", lines: [{ name: "Dal Makhani", qty: 2, amountPaise: 52000 }], subtotalPaise: 52000, discountPaise: 5200, taxPaise: 2340, totalPaise: 49140 });
    expect(text).toContain("*Spice Route*");
    expect(text).toContain("2 × Dal Makhani — ₹520");
    expect(text).toContain("Discount: −₹52");
    expect(text).toContain("*Total: ₹491.40*");
    expect(text).not.toContain("Service charge");
    expect(text).not.toMatch(/\n\n\n/);
  });

  it("accepts Indian mobile numbers in any common shape and builds the link", () => {
    expect(whatsappNumber("98765 43210")).toBe("919876543210");
    expect(whatsappNumber("+91-9876543210")).toBe("919876543210");
    expect(whatsappNumber("09876543210")).toBe("919876543210");
    expect(whatsappNumber("12345")).toBeNull();
    expect(whatsappLink("Hi there", "9876543210")).toBe("https://wa.me/919876543210?text=Hi%20there");
    expect(whatsappLink("Hi")).toBe("https://wa.me/?text=Hi");
  });
});
