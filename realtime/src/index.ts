import { DurableObject } from "cloudflare:workers";

// Tableeqr realtime (PS 9.3). The Next.js server publishes small events after it commits a change;
// this Worker fans them out to the phones and screens of that outlet within milliseconds.
//
// Isolation: each outlet has its own Durable Object, addressed by tenant and outlet ids taken
// from a token the Next.js server signed. A socket only receives the topics in its token, so a
// guest hears their own table and nothing else. Events carry ids only; screens reload real data
// from the server, which stays the single source of truth.

export interface Env {
  OUTLET_HUB: DurableObjectNamespace<OutletHub>;
  TOKEN_SECRET: string;
  PUBLISH_SECRET: string;
  TABLEEQR_API_URL?: string;
  /** Existing deployed secret remains supported during the rename. */
  TABLEQR_API_URL?: string;
  SERVICE_TASK_SECRET?: string;
}

type Claims = { t: string; o: string; topics: string[]; exp: number; sub?: string };
export type RealtimeEvent = { topic: string; type: string; data?: Record<string, unknown> };

const MAX_TOPICS = 10; // Durable Object sockets carry at most 10 tags
const MAX_EVENTS = 100;
const enc = new TextEncoder();

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** Token = base64url(JSON claims) + "." + base64url(HMAC-SHA256(claims part)) */
async function verifyToken(token: string, secret: string): Promise<Claims | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", key, fromB64url(sig), enc.encode(payload));
  } catch {
    return null;
  }
  if (!valid) return null;
  let claims: Claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  } catch {
    return null;
  }
  if (!isId(claims.t) || !isId(claims.o) || typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
  if (!Array.isArray(claims.topics) || claims.topics.length === 0 || claims.topics.length > MAX_TOPICS) return null;
  if (!claims.topics.every((t) => typeof t === "string" && t.length <= 100)) return null;
  return claims;
}

function authorised(request: Request, secret: string): boolean {
  const given = enc.encode(request.headers.get("Authorization") ?? "");
  const expected = enc.encode(`Bearer ${secret}`);
  return given.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(given, expected);
}

const hubFor = (env: Env, tenantId: string, outletId: string) =>
  env.OUTLET_HUB.get(env.OUTLET_HUB.idFromName(`${tenantId}:${outletId}`));

export default {
  /** Minute cron: escalation happens even when all guest phones are asleep. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const apiUrl = env.TABLEEQR_API_URL || env.TABLEQR_API_URL;
    if (!apiUrl || !env.SERVICE_TASK_SECRET) return;
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/internal/service-tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SERVICE_TASK_SECRET}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Service escalation failed: ${res.status}`);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket upgrade", { status: 426 });
      const claims = await verifyToken(url.searchParams.get("token") ?? "", env.TOKEN_SECRET);
      if (!claims) return new Response("Unauthorized", { status: 401 });
      const forward = new Request(request);
      forward.headers.set("x-claims", JSON.stringify(claims));
      return hubFor(env, claims.t, claims.o).fetch(forward);
    }

    if (url.pathname === "/publish" && request.method === "POST") {
      if (!authorised(request, env.PUBLISH_SECRET)) return new Response("Unauthorized", { status: 401 });
      const body = (await request.json().catch(() => null)) as { tenantId?: unknown; outletId?: unknown; events?: unknown } | null;
      if (!body || !isId(body.tenantId) || !isId(body.outletId) || !Array.isArray(body.events) || body.events.length > MAX_EVENTS) {
        return new Response("Bad request", { status: 400 });
      }
      const events = (body.events as RealtimeEvent[]).filter((e) => typeof e?.topic === "string" && typeof e?.type === "string");
      const delivered = await hubFor(env, body.tenantId, body.outletId).broadcast(events);
      return Response.json({ delivered });
    }

    if (url.pathname === "/health") return new Response("ok");
    return new Response("Not found", { status: 404 });
  },
};

/** One per outlet. Sockets hibernate between events, so idle connections cost nothing. */
export class OutletHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const claims = JSON.parse(request.headers.get("x-claims") ?? "null") as Claims | null;
    if (!claims) return new Response("Unauthorized", { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Tags let broadcast find a topic's sockets without scanning every connection
    this.ctx.acceptWebSocket(server, claims.topics.map((t) => `topic:${t}`));
    server.serializeAttachment({ exp: claims.exp, sub: claims.sub ?? null });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Sends each socket one frame holding every event it subscribes to */
  async broadcast(events: RealtimeEvent[]): Promise<number> {
    const perSocket = new Map<WebSocket, RealtimeEvent[]>();
    for (const event of events) {
      for (const ws of this.ctx.getWebSockets(`topic:${event.topic}`)) {
        const list = perSocket.get(ws) ?? [];
        list.push(event);
        perSocket.set(ws, list);
      }
    }
    let delivered = 0;
    const now = Date.now();
    for (const [ws, list] of perSocket) {
      const { exp } = ws.deserializeAttachment() as { exp: number };
      if (exp * 1000 < now) {
        // Tell the client in-band first (a close frame alone is not always surfaced), then close.
        // The client fetches a fresh token, reconnects and reloads its data.
        try {
          ws.send(JSON.stringify({ control: "token_expired" }));
          ws.close(4001, "Token expired");
        } catch {
          // Already closing
        }
        continue;
      }
      try {
        ws.send(JSON.stringify({ events: list }));
        delivered++;
      } catch {
        // Socket already closing; the client will reconnect and resync
      }
    }
    return delivered;
  }

  async webSocketMessage(): Promise<void> {
    // Clients only listen. "ping" is answered by the auto-response above.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Finish the close handshake. 1005/1006/1015 are "no code" markers that may not be sent back.
    const sendable = code === 1000 || (code >= 3000 && code <= 4999) || (code >= 1001 && code <= 1014 && ![1004, 1005, 1006].includes(code));
    try {
      ws.close(sendable ? code : 1000, sendable ? reason : "");
    } catch {
      // Already closed
    }
  }
}
