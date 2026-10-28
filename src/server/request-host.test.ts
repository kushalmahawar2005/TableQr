import { describe, expect, it } from "vitest";
import { requestHostname, requestOrigin } from "./request-host";

describe("requestHostname", () => {
  it("prefers the public host forwarded by the reverse proxy", () => {
    const headers = new Headers({
      host: "internal-host:3000",
      "x-forwarded-host": "tableeqr.example",
    });

    expect(requestHostname(headers, "internal-host")).toBe("tableeqr.example");
  });

  it("uses the Host header when no forwarded host is present", () => {
    expect(requestHostname(new Headers({ host: "TABLEEQR.EXAMPLE:443" }), "internal-host"))
      .toBe("tableeqr.example");
  });

  it("falls back to the request URL host", () => {
    expect(requestHostname(new Headers(), "LocalHost")).toBe("localhost");
  });

  it("returns an empty host for malformed forwarded hosts", () => {
    expect(requestHostname(new Headers({ "x-forwarded-host": "not a host" }), "internal-host")).toBe("");
  });
});

describe("requestOrigin", () => {
  it("returns the guest to the restaurant domain they are on, over https", () => {
    expect(requestOrigin(new Headers({ host: "internal:3000", "x-forwarded-host": "menu.spiceroute.in", "x-forwarded-proto": "http" }))).toBe("https://menu.spiceroute.in");
    expect(requestOrigin(new Headers({ host: "tableeqr.example" }))).toBe("https://tableeqr.example");
  });

  it("keeps plain http for a local server and turns 0.0.0.0 into localhost", () => {
    expect(requestOrigin(new Headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(requestOrigin(new Headers({ host: "0.0.0.0:3000" }))).toBe("http://localhost:3000");
    expect(requestOrigin(new Headers())).toBe("http://localhost:3000");
  });
});
