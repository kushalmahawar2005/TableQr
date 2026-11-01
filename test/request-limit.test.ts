import { describe, expect, it } from "vitest";
import { limitByClient, overLimit } from "@/server/request-limit";

describe("per-address request limit", () => {
  it("stops an address over the limit and lets it back after the window", () => {
    expect(overLimit("login:1.1.1.1", 2, 1000, 0)).toBe(false);
    expect(overLimit("login:1.1.1.1", 2, 1000, 1)).toBe(false);
    expect(overLimit("login:1.1.1.1", 2, 1000, 2)).toBe(true);
    expect(overLimit("login:2.2.2.2", 2, 1000, 2)).toBe(false);
    expect(overLimit("login:1.1.1.1", 2, 1000, 1000)).toBe(false);
  });

  it("does not block work outside a request, where no address is known", async () => {
    await expect(limitByClient("sms", 0)).resolves.toBeUndefined();
  });
});
