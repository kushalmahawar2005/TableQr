import "server-only";
import { createHmac } from "node:crypto";

// Connect tokens for the realtime Worker (realtime/src/index.ts verifies them). The token names
// the outlet hub and the topics a socket may hear, so isolation is decided here on the server.

export const topics = {
  floor: "floor",
  kitchen: "kitchen",
  tasks: "tasks",
  menu: "menu",
  session: (sessionId: string) => `session:${sessionId}`,
  waitlist: (tokenHash: string) => `waitlist:${tokenHash}`,
};

export function signRealtimeToken(
  claims: { tenantId: string; outletId: string; topics: string[]; sub?: string },
  ttlSeconds: number,
  secret = process.env.REALTIME_TOKEN_SECRET,
  now = Date.now(),
): string | null {
  if (!secret) return null; // realtime not configured: screens fall back to polling
  const payload = Buffer.from(
    JSON.stringify({
      t: claims.tenantId,
      o: claims.outletId,
      topics: claims.topics,
      exp: Math.floor(now / 1000) + ttlSeconds,
      ...(claims.sub ? { sub: claims.sub } : {}),
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** A guest hears their own table and menu availability, nothing else */
export function guestRealtimeToken(ctx: { tenantId: string; outletId: string; sessionId: string; participantId: string }) {
  return signRealtimeToken(
    { tenantId: ctx.tenantId, outletId: ctx.outletId, topics: [topics.session(ctx.sessionId), topics.menu], sub: ctx.participantId },
    6 * 60 * 60,
  );
}

/** Staff screens pick the topics their screen needs; the role check happens before this is called */
export function staffRealtimeToken(ctx: { tenantId: string; outletId: string; userId: string | null }, screenTopics: string[]) {
  return signRealtimeToken(
    { tenantId: ctx.tenantId, outletId: ctx.outletId, topics: screenTopics, sub: ctx.userId ?? undefined },
    12 * 60 * 60,
  );
}

export function waitlistRealtimeToken(ctx: { tenantId: string; outletId: string; tokenHash: string }) {
  return signRealtimeToken({ tenantId: ctx.tenantId, outletId: ctx.outletId, topics: [topics.waitlist(ctx.tokenHash)], sub: ctx.tokenHash }, 24 * 60 * 60);
}
