import { afterEach, describe, expect, it, vi } from "vitest";
import { createHealthCheck } from "./health";

describe("health check", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is healthy when the database answers", async () => {
    const ping = vi.fn(async () => [{ 1: 1 }]);
    expect(await createHealthCheck(ping)()).toEqual({ status: "healthy", database: "connected" });
    expect(ping).toHaveBeenCalledOnce();
  });

  it("is unhealthy, and logs only a short code, when the database fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = Object.assign(new Error("Access denied for user 'u892494227'@'srv1' (password: YES) near select"), { code: "ER_ACCESS_DENIED_ERROR" });
    const result = await createHealthCheck(async () => { throw secret; })();
    expect(result).toEqual({ status: "unhealthy", database: "unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/u892494227|password|select/i);
    expect(log).toHaveBeenCalledWith("[health] database check failed (ER_ACCESS_DENIED_ERROR)");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/u892494227|password/i);
  });

  it("calls a database that does not answer in time unhealthy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const check = createHealthCheck(() => new Promise(() => undefined), { timeoutMs: 20 });
    expect(await check()).toEqual({ status: "unhealthy", database: "unavailable" });
  });

  it("shares one ping between simultaneous checks and reuses a fresh answer", async () => {
    let clock = 1_000;
    const ping = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const check = createHealthCheck(ping, { cacheMs: 5_000, now: () => clock });
    await Promise.all([check(), check(), check()]);
    expect(ping).toHaveBeenCalledTimes(1);
    clock += 4_000;
    await check();
    expect(ping).toHaveBeenCalledTimes(1);
    clock += 2_000;
    await check();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("notices recovery within seconds after a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let clock = 0, up = false;
    const check = createHealthCheck(async () => { if (!up) throw new Error("down"); }, { failureCacheMs: 2_000, now: () => clock });
    expect((await check()).status).toBe("unhealthy");
    up = true;
    clock += 1_000;
    expect((await check()).status).toBe("unhealthy");
    clock += 1_500;
    expect((await check()).status).toBe("healthy");
  });
});
