import { describe, expect, it } from "vitest";
import { readRequestBodyLimited, readRequestTextLimited } from "./http-body";

describe("bounded request bodies", () => {
  it("reads bodies up to the configured byte limit", async () => {
    const request = new Request("https://tableeqr.test/webhook", { method: "POST", body: "signed payload" });
    await expect(readRequestTextLimited(request, 14)).resolves.toBe("signed payload");
  });

  it("rejects a body over the limit, including when Content-Length is missing", async () => {
    const request = new Request("https://tableeqr.test/webhook", { method: "POST", body: "payload too large" });
    await expect(readRequestBodyLimited(request, 4)).resolves.toBeNull();
  });

  it("rejects an oversized declared body before reading it", async () => {
    const request = new Request("https://tableeqr.test/webhook", {
      method: "POST",
      headers: { "content-length": "1024" },
      body: "payload",
    });
    await expect(readRequestBodyLimited(request, 16)).resolves.toBeNull();
  });
});
