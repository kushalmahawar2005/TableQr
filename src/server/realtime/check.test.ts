import { describe, expect, it } from "vitest";
import { checkRealtime } from "./check";

const env = { REALTIME_URL: "https://rt.example", REALTIME_PUBLISH_SECRET: "p".repeat(32), REALTIME_TOKEN_SECRET: "t".repeat(32) };

/** A fake Worker: health, publish and a socket that hands the published event back */
function fakeWorker(over: { health?: number; publish?: number; deliver?: boolean; connect?: boolean } = {}) {
  let listener: ((e: { data: string }) => void) | null = null;
  class FakeSocket {
    constructor() { setTimeout(() => (over.connect === false ? this.err() : this.open()), 1); }
    private handlers: Record<string, (() => void)[]> = {};
    addEventListener(type: string, fn: (e: { data: string }) => void) { if (type === "message") listener = fn; else (this.handlers[type] ??= []).push(fn as () => void); }
    private open() { this.handlers.open?.forEach((f) => f()); }
    private err() { this.handlers.error?.forEach((f) => f()); }
    close() {}
  }
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/health")) return new Response("ok", { status: over.health ?? 200 });
    if (over.deliver !== false) setTimeout(() => listener?.({ data: String(init?.body) }), 1);
    return new Response("{}", { status: over.publish ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, WebSocketImpl: FakeSocket as unknown as typeof WebSocket };
}

describe("realtime check", () => {
  it("passes only when the event published comes back over the socket", async () => {
    const r = await checkRealtime({ env, timeoutMs: 200, ...fakeWorker() });
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.name)).toEqual(["settings", "worker", "connect", "publish", "delivery"]);
  });

  it("fails with the step that broke: not set up, worker down, socket refused, publish refused, nothing delivered", async () => {
    expect((await checkRealtime({ env: {} })).steps).toEqual([{ name: "settings", ok: false }]);
    expect((await checkRealtime({ env, timeoutMs: 100, ...fakeWorker({ health: 503 }) })).steps.at(-1)).toEqual({ name: "worker", ok: false });
    expect((await checkRealtime({ env, timeoutMs: 100, ...fakeWorker({ connect: false }) })).steps.at(-1)).toEqual({ name: "connect", ok: false });
    expect((await checkRealtime({ env, timeoutMs: 100, ...fakeWorker({ publish: 401 }) })).steps.at(-1)).toEqual({ name: "publish", ok: false });
    const silent = await checkRealtime({ env, timeoutMs: 100, ...fakeWorker({ deliver: false }) });
    expect(silent.ok).toBe(false);
    expect(silent.steps.at(-1)).toEqual({ name: "delivery", ok: false });
  });

  it("never returns a secret or the worker address", async () => {
    const text = JSON.stringify(await checkRealtime({ env, timeoutMs: 200, ...fakeWorker() }));
    expect(text).not.toMatch(/rt\.example|pppp|tttt/);
  });
});
