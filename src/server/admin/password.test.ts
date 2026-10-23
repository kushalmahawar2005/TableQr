import { describe, expect, it } from "vitest";
import { hashAdminPassword, verifyAdminPassword } from "./password";

describe("platform admin password hashing", () => {
  it("accepts only the password used to create the scrypt hash", async () => {
    const hash = await hashAdminPassword("a-long-and-unique-password");
    await expect(verifyAdminPassword("a-long-and-unique-password", hash)).resolves.toBe(true);
    await expect(verifyAdminPassword("a-different-password", hash)).resolves.toBe(false);
  });

  it("rejects malformed or attacker-controlled scrypt parameters without expensive work", async () => {
    await expect(verifyAdminPassword("anything", "scrypt$999999999$AA$AA")).resolves.toBe(false);
    await expect(verifyAdminPassword("anything", "scrypt$16384$AA$AA")).resolves.toBe(false);
    await expect(verifyAdminPassword("anything", null)).resolves.toBe(false);
  });
});
