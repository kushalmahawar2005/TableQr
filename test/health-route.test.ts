import { afterEach, describe, expect, it, vi } from "vitest";

// The real route against the test database, then with the database unreachable.

describe("GET /api/health", () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock("@/db"); vi.restoreAllMocks(); });

  it("answers 200 with a bare status, never cached, when the database is up", async () => {
    const { GET, HEAD, dynamic } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "healthy", database: "connected" });
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(dynamic).toBe("force-dynamic");
    const head = await HEAD();
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const { db } = await import("@/db");
    await db.$client.end();
  });

  it("answers 503 without any detail when the database cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.resetModules();
    vi.doMock("@/db", () => ({ db: { $client: { query: async () => { throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3306 user=tableqr"), { code: "ECONNREFUSED" }); } } } }));
    const { GET, HEAD } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "unhealthy", database: "unavailable" });
    expect(text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|tableqr|3306/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect((await HEAD()).status).toBe(503);
  });

  it("answers 503, not a server error, when the database is not configured at all", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.resetModules();
    vi.doMock("@/db", () => { throw new Error("Database is not configured. Set DB_HOST, DB_NAME, DB_USER and DB_PASSWORD in .env.local"); });
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unhealthy", database: "unavailable" });
  });
});
