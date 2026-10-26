import { afterEach, describe, expect, it } from "vitest";
import { sealDocument, unsealDocument } from "@/server/delivery/rider-docs";

const KEY = "PAYMENT_CREDENTIALS_KEY";
const before = process.env[KEY];
afterEach(() => { if (before === undefined) delete process.env[KEY]; else process.env[KEY] = before; });

describe("rider document encryption", () => {
  it("round-trips and never stores the plain bytes", () => {
    process.env[KEY] = "ab".repeat(32);
    const plain = Buffer.from("aadhaar photo bytes");
    const sealed = sealDocument(plain);
    expect(sealed.includes(plain)).toBe(false);
    expect(unsealDocument(sealed).equals(plain)).toBe(true);
    // A fresh IV each time
    expect(sealDocument(plain).equals(sealed)).toBe(false);
  });

  it("refuses a tampered file or a different key", () => {
    process.env[KEY] = "ab".repeat(32);
    const sealed = sealDocument(Buffer.from("photo"));
    const bad = Buffer.from(sealed); bad[bad.length - 1] ^= 1;
    expect(() => unsealDocument(bad)).toThrow();
    process.env[KEY] = "cd".repeat(32);
    expect(() => unsealDocument(sealed)).toThrow();
  });

  it("needs the server key", () => {
    delete process.env[KEY];
    expect(() => sealDocument(Buffer.from("x"))).toThrow(/not set up/);
  });
});
