import { describe, expect, it } from "vitest";
import { financialYear, formatInvoiceNumber } from "./invoice";
import { formatINR, roundToRupee } from "./money";

describe("financialYear", () => {
  it("runs April to March in India time", () => {
    expect(financialYear(new Date("2026-10-01T10:00:00Z"))).toBe("26-27");
    expect(financialYear(new Date("2027-01-15T10:00:00Z"))).toBe("26-27");
    // 31 March 23:30 IST is still the old year; 1 April 01:30 IST is the new one
    expect(financialYear(new Date("2026-03-31T18:00:00Z"))).toBe("25-26");
    expect(financialYear(new Date("2026-03-31T20:00:00Z"))).toBe("26-27");
    expect(financialYear(new Date("2099-06-01T00:00:00Z"))).toBe("99-00");
  });
});

describe("formatInvoiceNumber", () => {
  it("matches the spec format", () => {
    expect(formatInvoiceNumber("MUM01", "25-26", 123)).toBe("MUM01/25-26/000123");
  });
});

describe("money", () => {
  it("formats with Indian grouping", () => {
    expect(formatINR(18420000)).toBe("INR 1,84,200");
    expect(formatINR(199000, { paise: true })).toBe("INR 1,990.00");
    expect(formatINR(54100, { prefix: false })).toBe("541");
  });

  it("rounds half up to the rupee", () => {
    expect(roundToRupee(54075)).toBe(54100);
    expect(roundToRupee(46725)).toBe(46700);
    expect(roundToRupee(61950)).toBe(62000);
    expect(roundToRupee(208950)).toBe(209000);
  });
});
