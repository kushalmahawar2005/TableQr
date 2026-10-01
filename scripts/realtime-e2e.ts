// End-to-end check of the realtime Worker running locally (cd realtime && npm run dev).
// Run: npm run realtime:e2e
// Uses the Next.js server's own token signer and publisher against the real Worker runtime.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connectRealtime } from "../src/lib/realtime-client";
import { publish } from "../src/server/realtime/publish";
import { signRealtimeToken, topics } from "../src/server/realtime/token";

const URL_HTTP = process.env.REALTIME_URL ?? "http://127.0.0.1:8787";
const URL_WS = URL_HTTP.replace(/^http/, "ws");

// Same secrets the Worker loaded from realtime/.dev.vars
const vars = Object.fromEntries(
  readFileSync(path.resolve(import.meta.dirname, "../realtime/.dev.vars"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("=") as [string, string]),
);
process.env.REALTIME_URL = URL_HTTP;
process.env.REALTIME_PUBLISH_SECRET = vars.PUBLISH_SECRET;
process.env.REALTIME_TOKEN_SECRET = vars.TOKEN_SECRET;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Frame = { events: { topic: string; type: string; data?: Record<string, unknown> }[]; at: number };

/** Opens a socket and records frames; resolves once open or rejects if refused */
function connect(token: string | null): Promise<{ ws: WebSocket; frames: Frame[]; raw: string[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${URL_WS}/connect?token=${encodeURIComponent(token ?? "")}`);
    const frames: Frame[] = [];
    const raw: string[] = [];
    ws.addEventListener("message", (e) => {
      const text = String(e.data);
      raw.push(text);
      const parsed = text === "pong" ? null : (JSON.parse(text) as Partial<Omit<Frame, "at">>);
      if (parsed?.events) frames.push({ events: parsed.events, at: performance.now() });
    });
    ws.addEventListener("open", () => resolve({ ws, frames, raw }));
    ws.addEventListener("error", () => reject(new Error("refused")));
  });
}

const refused = (token: string | null) => connect(token).then((c) => (c.ws.close(), false), () => true);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const health = await fetch(`${URL_HTTP}/health`).then((r) => r.status).catch(() => 0);
  check("worker is up", health === 200);
  if (health !== 200) process.exit(1);

  const O1 = { tenantId: "tenant-sr", outletId: "outlet-jaipur" };
  const O2 = { tenantId: "tenant-nk", outletId: "outlet-nukkad" };
  const S1 = "session-t12";
  const sign = (scope: typeof O1, t: string[], ttl = 3600) => signRealtimeToken({ ...scope, topics: t }, ttl)!;

  // Who may connect
  const guestToken = sign(O1, [topics.session(S1), topics.menu]);
  check("rejects a missing token", await refused(null));
  check("rejects an expired token", await refused(sign(O1, [topics.kitchen], -10)));
  const [payload, sig] = guestToken.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), topics: [topics.kitchen] })).toString("base64url");
  check("rejects a guest token edited to add the kitchen topic", await refused(`${forged}.${sig}`));
  check("rejects a token signed with the wrong secret", await refused(signRealtimeToken({ ...O1, topics: [topics.floor] }, 3600, "wrong-secret")));

  const guest = await connect(guestToken);
  const kitchen = await connect(sign(O1, [topics.kitchen]));
  const otherTable = await connect(sign(O1, [topics.session("session-t4")]));
  // Same topic name, different restaurant: lives in a different hub and must hear nothing
  const otherRestaurant = await connect(sign(O2, [topics.session(S1), topics.kitchen, topics.menu]));
  check("guest, kitchen and others connect", true);

  // Publishing
  const t0 = performance.now();
  await publish(O1, [
    { topic: topics.session(S1), type: "order.status", data: { orderId: "o1", status: "preparing" } },
    { topic: topics.kitchen, type: "ticket.created", data: { orderId: "o2" } },
    { topic: topics.menu, type: "item.availability", data: { itemId: "dal", available: false } },
  ]);
  await sleep(300);

  check(
    "guest gets its table and menu events in one frame",
    guest.frames.length === 1 && guest.frames[0].events.map((e) => e.type).join() === "order.status,item.availability",
    `${guest.frames.length} frame(s)`,
  );
  check("kitchen gets only the kitchen event", kitchen.frames.length === 1 && kitchen.frames[0].events[0].type === "ticket.created");
  check("another table hears nothing", otherTable.frames.length === 0);
  check("another restaurant hears nothing", otherRestaurant.frames.length === 0);
  if (guest.frames[0]) check("publish to delivery is fast", guest.frames[0].at - t0 < 200, `${(guest.frames[0].at - t0).toFixed(1)} ms locally`);

  const bad = await fetch(`${URL_HTTP}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer nope" },
    body: JSON.stringify({ ...O1, events: [{ topic: topics.kitchen, type: "x" }] }),
  });
  check("rejects publishing without the secret", bad.status === 401);
  await sleep(200);
  check("nothing was delivered by the rejected publish", kitchen.frames.length === 1);

  guest.ws.send("ping");
  await sleep(200);
  check("heartbeat ping gets pong without waking the hub", guest.raw.includes("pong"));

  // A burst like a Saturday rush: 200 events to one outlet
  const burstStart = performance.now();
  await Promise.all(
    Array.from({ length: 200 }, (_, i) => publish(O1, [{ topic: topics.kitchen, type: "ticket.created", data: { orderId: `b${i}` } }])),
  );
  await sleep(500);
  const got = kitchen.frames.reduce((n, f) => n + f.events.length, 0) - 1;
  check("burst of 200 publishes all delivered", got === 200, `${got}/200 in ${(performance.now() - burstStart).toFixed(0)} ms`);

  for (const c of [guest, kitchen, otherTable, otherRestaurant]) c.ws.close();

  // The browser client: token expiry mid-service, reconnect, resync, keep receiving
  let tokensIssued = 0;
  let resyncs = 0;
  const received: string[] = [];
  const statuses: string[] = [];
  const stop = connectRealtime({
    url: URL_WS,
    getToken: async () => {
      tokensIssued++;
      return sign(O1, [topics.floor], 2); // expires in 2 seconds
    },
    onEvents: (events) => received.push(...events.map((e) => String(e.data?.n))),
    onResync: () => resyncs++,
    onStatus: (s) => statuses.push(s),
    pollMs: 60_000,
  });
  await sleep(300);
  await publish(O1, [{ topic: topics.floor, type: "table.state_changed", data: { n: 1 } }]);
  await sleep(2500); // the 2-second token would have expired by now
  await publish(O1, [{ topic: topics.floor, type: "table.state_changed", data: { n: 2 } }]);
  await sleep(300);
  await publish(O1, [{ topic: topics.floor, type: "table.state_changed", data: { n: 3 } }]);
  await sleep(300);
  stop();
  check("client swaps to a fresh token before the old one expires", tokensIssued >= 2, `${tokensIssued} tokens`);
  check("client reloads data after reconnecting", resyncs >= 1, `${resyncs} resync(s)`);
  check("client receives every event across the token swap", ["1", "2", "3"].every((n) => received.includes(n)), `got ${received.join(",")}`);
  check("client went live again after the swap", statuses.filter((st) => st === "live").length >= 2, statuses.join(">"));

  // Hub side: a socket still holding an expired token is told to reconnect, not left deaf
  const stale = await connect(sign(O1, [topics.floor], 1));
  await sleep(1800);
  await publish(O1, [{ topic: topics.floor, type: "table.state_changed", data: { n: 4 } }]);
  await sleep(300);
  check(
    "hub tells an expired socket to reconnect instead of sending it data",
    stale.raw.some((r) => r.includes("token_expired")) && stale.frames.every((f) => !f.events),
    stale.raw.join(" | "),
  );
  stale.ws.close();

  let polled = 0;
  const stopPoll = connectRealtime({ url: null, getToken: async () => null, onEvents: () => {}, onResync: () => polled++, pollMs: 200 });
  await sleep(700);
  stopPoll();
  check("without realtime configured the client falls back to polling", polled >= 3, `${polled} polls`);

  console.log(failures === 0 ? "\nAll realtime checks passed" : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
