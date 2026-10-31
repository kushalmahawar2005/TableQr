import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ currentStaff: vi.fn(), currentRider: vi.fn() }));
vi.mock("@/server/staff/request", () => ({ currentStaff: auth.currentStaff }));
vi.mock("@/server/staff/rider-request", () => ({ currentRider: auth.currentRider }));

import { GET } from "@/app/api/staff/push-session/route";

const request = (sessionId: string) => new Request(`https://tableeqr.example/api/staff/push-session?sessionId=${encodeURIComponent(sessionId)}`);

describe("GET /api/staff/push-session", () => {
  beforeEach(() => {
    auth.currentStaff.mockReset().mockResolvedValue(null);
    auth.currentRider.mockReset().mockResolvedValue(null);
  });

  it("allows only the active staff session", async () => {
    auth.currentStaff.mockResolvedValue({ sessionId: "session-a" });
    const active = await GET(request("session-a"));
    const stale = await GET(request("session-b"));

    expect(await active.json()).toEqual({ active: true });
    expect(await stale.json()).toEqual({ active: false });
    expect(active.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("accepts the active Rider session and rejects malformed ids", async () => {
    auth.currentRider.mockResolvedValue({ sessionId: "rider-session" });
    expect(await (await GET(request("rider-session"))).json()).toEqual({ active: true });
    expect(await (await GET(request("x".repeat(37)))).json()).toEqual({ active: false });
  });
});
