import { afterEach, describe, expect, it, vi } from "vitest";

describe("server startup schema readiness", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("@/db");
    vi.doUnmock("@/server/ensure-schema");
    vi.restoreAllMocks();
  });

  it("refuses to start serving and logs only safe error metadata if schema setup fails", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new Error("mysql://user:secret@private-host/query-with-sensitive-values"), { code: "ER_ACCESS_DENIED_ERROR" });
    vi.doMock("@/db", () => ({ db: { $client: {} }, poolSize: 10 }));
    vi.doMock("@/server/ensure-schema", () => ({ ensureSchema: vi.fn().mockRejectedValue(failure) }));

    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow("Database schema initialization failed; server cannot accept traffic");
    expect(log).toHaveBeenCalledWith("[schema] startup migration failed; server is not ready", {
      errorName: "Error",
      errorCode: "ER_ACCESS_DENIED_ERROR",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-host");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});
