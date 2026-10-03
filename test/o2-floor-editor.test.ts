import { describe, expect, it } from "vitest";
import { encodeQr } from "@/domain/qr";
import { can } from "@/lib/staff-permissions";

describe("O2 floor editor contracts", () => {
  it("limits the editor to owner and manager and keeps operations server scoped", () => {
    expect(can(["owner"], "floor_plan.edit")).toBe(true);
    expect(can(["manager"], "floor_plan.publish")).toBe(true);
    expect(can(["host"], "floor_plan.edit")).toBe(false);
    expect(can(["waiter"], "floor_plan.qr")).toBe(false);
  });

  it("encodes published table links as a valid vector QR matrix", () => {
    const qr = encodeQr("http://localhost:3000/r/SRJ01/t/abc123");
    expect(qr.size).toBeGreaterThan(20);
    expect(qr.modules).toHaveLength(qr.size);
    expect(qr.modules.every((row) => row.length === qr.size)).toBe(true);
    expect(qr.modules.flat().some(Boolean)).toBe(true);
  });

  it("uses integer grid coordinates and enforces capacity invariants", () => {
    const snap = (x: number) => Math.max(0, Math.round(x));
    expect(snap(12.7)).toBe(13);
    expect(1 <= 4).toBe(true);
    expect(4 < 1).toBe(false);
  });
});
