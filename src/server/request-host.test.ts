import { describe, expect, it } from "vitest";
import { requestHostname } from "./request-host";

describe("requestHostname", () => {
  it("prefers the public host forwarded by the reverse proxy", () => {
    const headers = new Headers({
      host: "internal-host:3000",
      "x-forwarded-host": "tableqr.craftoryinnovation.com",
    });

    expect(requestHostname(headers, "internal-host")).toBe("tableqr.craftoryinnovation.com");
  });

  it("uses the Host header when no forwarded host is present", () => {
    expect(requestHostname(new Headers({ host: "TABLEQR.CRAFTORYINNOVATION.COM:443" }), "internal-host"))
      .toBe("tableqr.craftoryinnovation.com");
  });

  it("falls back to the request URL host", () => {
    expect(requestHostname(new Headers(), "LocalHost")).toBe("localhost");
  });

  it("returns an empty host for malformed forwarded hosts", () => {
    expect(requestHostname(new Headers({ "x-forwarded-host": "not a host" }), "internal-host")).toBe("");
  });
});
