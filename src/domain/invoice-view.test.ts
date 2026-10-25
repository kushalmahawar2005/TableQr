import { describe, expect, it } from "vitest";
import { addressLine, dishKey, mergeLines, taxRows } from "./invoice-view";

describe("invoice view", () => {
  it("adds the city only when the address does not already name it", () => {
    expect(addressLine("SP-40 RIICO Area, Kukas, Jaipur, Rajasthan", "Jaipur")).toBe("SP-40 RIICO Area, Kukas, Jaipur, Rajasthan");
    expect(addressLine("MI Road", "Jaipur")).toBe("MI Road, Jaipur");
    expect(addressLine("", "Jaipur")).toBe("Jaipur");
  });

  it("joins the same dish at the same price across rounds, keeping different prices apart", () => {
    const lines = [{ nameEn: "Paneer", qty: 1, amountPaise: 10000 }, { nameEn: "Naan", qty: 2, amountPaise: 6000 }, { nameEn: "Paneer", qty: 2, amountPaise: 20000 }, { nameEn: "Paneer", qty: 1, amountPaise: 12000 }];
    expect(mergeLines(lines, dishKey)).toEqual([{ nameEn: "Paneer", qty: 3, amountPaise: 30000 }, { nameEn: "Naan", qty: 2, amountPaise: 6000 }, { nameEn: "Paneer", qty: 1, amountPaise: 12000 }]);
  });

  it("splits GST into CGST and SGST halves per rate for a registered seller", () => {
    expect(taxRows({ "1800": 1801, "500": 1000 }, "08AABCS1234F1Z5")).toEqual([
      { label: "CGST 2.5%", paise: 500 }, { label: "SGST 2.5%", paise: 500 },
      { label: "CGST 9%", paise: 900 }, { label: "SGST 9%", paise: 901 },
    ]);
    expect(taxRows({ "500": 1000 }, null)).toEqual([{ label: "GST 5%", paise: 1000 }]);
    expect(taxRows(null, "08AABCS1234F1Z5", 1001)).toEqual([{ label: "CGST", paise: 500 }, { label: "SGST", paise: 501 }]);
    expect(taxRows(null, null, 0)).toEqual([]);
  });
});
