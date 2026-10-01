import { describe, expect, it } from "vitest";
import { uuidv7 } from "./id";

describe("uuidv7", () => {
  it("is a valid version 7 UUID", () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("sorts in creation order even when thousands are made in the same millisecond", () => {
    const ids = Array.from({ length: 20_000 }, () => uuidv7());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the current time", () => {
    const hex = uuidv7().replace(/-/g, "").slice(0, 12);
    expect(Math.abs(parseInt(hex, 16) - Date.now())).toBeLessThan(2000);
  });
});
