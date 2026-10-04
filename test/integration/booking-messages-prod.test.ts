import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { processBookingNotifications, queueBookingNotification } from "@/server/booking/notifications";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
beforeAll(async () => {
  env = await resetTestDb();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

const queue = (key: string) => queueBookingNotification({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, type: "booking_confirmation", recipient: "9000000000", channel: "sms", idempotencyKey: key, scheduledAt: new Date(Date.now() - 1000) });
const row = async (id: string) => (await env.db.select().from(s.bookingNotifications).where(eq(s.bookingNotifications.id, id)))[0];

describe("booking messages", () => {
  it("in production a message is never reported sent without a real provider, even with BOOKING_MESSAGE_PROVIDER set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BOOKING_MESSAGE_PROVIDER", "anything");
    const id = (await queue("prod-1"))!;
    const res = await processBookingNotifications();
    expect(res.sent).toBe(0);
    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.providerRef).toBeNull();
    expect(r.sentAt).toBeNull();
    expect(r.lastError).toMatch(/provider/i);
  });

  it("outside production the local stand-in still marks it sent", async () => {
    const id = (await queue("dev-1"))!;
    const res = await processBookingNotifications();
    expect(res.sent).toBeGreaterThan(0);
    expect((await row(id)).status).toBe("sent");
  });
});
