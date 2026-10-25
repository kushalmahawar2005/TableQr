import "server-only";
import { signRealtimeToken } from "./token";

// A real round trip through the realtime Worker, run from the server with its own settings: the
// Worker answers, a screen's socket connects with a signed token, an event is published, and the
// socket receives it. Settings alone prove nothing; this proves the path. It uses a made-up outlet,
// so no restaurant's screen sees the test event, and it never returns a secret or an address.

export type RealtimeStep = { name: "settings" | "worker" | "connect" | "publish" | "delivery"; ok: boolean; ms?: number };
export type RealtimeCheck = { ok: boolean; configured: boolean; steps: RealtimeStep[] };

type Deps = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; WebSocketImpl?: typeof WebSocket; timeoutMs?: number };

export async function checkRealtime(deps: Deps = {}): Promise<RealtimeCheck> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetchImpl ?? fetch;
  const WS = deps.WebSocketImpl ?? WebSocket;
  const timeoutMs = deps.timeoutMs ?? 4000;
  const base = env.REALTIME_URL?.replace(/\/+$/, "");
  const steps: RealtimeStep[] = [];
  const done = () => ({ ok: steps.every((s) => s.ok), configured: !!base, steps });
  const timed = async <T>(name: RealtimeStep["name"], work: () => Promise<T>) => {
    const t0 = performance.now();
    try {
      const value = await work();
      steps.push({ name, ok: true, ms: Math.round(performance.now() - t0) });
      return value;
    } catch {
      steps.push({ name, ok: false });
      return null;
    }
  };

  const ready = !!base && !!env.REALTIME_PUBLISH_SECRET && !!env.REALTIME_TOKEN_SECRET;
  steps.push({ name: "settings", ok: ready });
  if (!ready) return done();

  const worker = await timed("worker", async () => {
    const res = await doFetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) throw new Error("not ok");
  });
  if (worker === null) return done();

  const scope = { tenantId: "realtime-check", outletId: "realtime-check" };
  const nonce = `check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const token = signRealtimeToken({ ...scope, topics: ["check"] }, 60, env.REALTIME_TOKEN_SECRET);
  if (!token) { steps.push({ name: "connect", ok: false }); return done(); }

  let socket: WebSocket | null = null;
  let received: Promise<void> | null = null;
  const connected = await timed("connect", () => new Promise<void>((resolve, reject) => {
    socket = new WS(`${base!.replace(/^http/, "ws")}/connect?token=${encodeURIComponent(token)}`);
    received = new Promise<void>((got, fail) => {
      const timer = setTimeout(() => fail(new Error("no event")), timeoutMs);
      socket!.addEventListener("message", (e) => { if (String(e.data).includes(nonce)) { clearTimeout(timer); got(); } });
    });
    received.catch(() => undefined);
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("refused")));
    setTimeout(() => reject(new Error("timeout")), timeoutMs);
  }));

  if (connected !== null) {
    const published = await timed("publish", async () => {
      const res = await doFetch(`${base}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.REALTIME_PUBLISH_SECRET}` },
        body: JSON.stringify({ ...scope, events: [{ topic: "check", type: "check", data: { nonce } }] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error("not ok");
    });
    if (published !== null && received) await timed("delivery", () => received!);
  }
  try { (socket as WebSocket | null)?.close(); } catch { /* already closed */ }
  return done();
}
