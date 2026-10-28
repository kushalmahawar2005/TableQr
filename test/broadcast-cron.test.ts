import { afterEach, describe, expect, it, vi } from "vitest";
const { process } = vi.hoisted(() => ({ process: vi.fn().mockResolvedValue({ accepted: 1, rejected: 0, unknown: 0, skipped: 0, errors: 0 }) }));
vi.mock("@/server/whatsapp/worker", () => ({ processBroadcastBatch: process }));
import { POST } from "@/app/api/internal/broadcasts/route";
afterEach(() => { vi.unstubAllEnvs(); process.mockClear(); });
describe("broadcast cron authentication", () => {
  it("never invokes sending without a configured strong secret or a matching bearer token", async () => {
    vi.stubEnv("SERVICE_TASK_SECRET", "");
    expect((await POST(new Request("https://app.example/api/internal/broadcasts", { method: "POST" }))).status).toBe(503);
    vi.stubEnv("SERVICE_TASK_SECRET", "a".repeat(32));
    expect((await POST(new Request("https://app.example/api/internal/broadcasts", { method: "POST", headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(process).not.toHaveBeenCalled();
    expect((await POST(new Request("https://app.example/api/internal/broadcasts", { method: "POST", headers: { authorization: `Bearer ${"a".repeat(32)}` } }))).status).toBe(200);
    expect(process).toHaveBeenCalledTimes(1);
  });
});
