import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { createServiceRequest } from "@/server/guest/service-requests";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff } from "@/server/staff/auth";
import { getConsoleNotices, getLiveOrderCounts } from "@/server/staff/notifications";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// Console bell: what happened at this outlet since a moment, and nothing from another restaurant.

let env: Awaited<ReturnType<typeof resetTestDb>>;

beforeAll(async () => {
  env = await resetTestDb();
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("console notices", () => {
  it("lists new orders and table requests after the given time, newest first", async () => {
    const owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
    const before = new Date(Date.now() - 1000);
    expect(await getConsoleNotices(owner, before)).toEqual([]);

    const qr = env.demo.tableQr.T1;
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "bell-a", displayName: "Aarav" });
    const ctx = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, "bell-a"), "Aarav");
    await addCartLine(ctx, { itemId: env.demo.itemIds.Cola, qty: 2 });
    await placeOrder(ctx);
    await createServiceRequest(ctx, "water", "bell-water-1");

    // Another restaurant's order never shows here
    const { participantId: otherP } = await startOrJoinTable({ outletCode: "CNJ01", shortCode: env.other.tableQr, deviceId: "bell-b" });
    const other = await attachVerifiedTestGuest(appDb, await getGuestContext("CNJ01", env.other.tableQr, otherP, "bell-b"), "Isha");
    await addCartLine(other, { itemId: env.other.itemId, qty: 1 });
    await placeOrder(other, { name: "Isha" });

    const notices = await getConsoleNotices(owner, before);
    expect(notices.map((n) => n.kind).sort()).toEqual(["order", "request"]);
    expect(notices.find((n) => n.kind === "order")).toMatchObject({ title: "New order · Table T1", body: "Round 1 · 1 dish", href: "/console/orders" });
    expect(notices.find((n) => n.kind === "request")?.title).toBe("Table T1 asks for water");
    expect(notices[0].at).toBeGreaterThanOrEqual(notices[1].at);

    // Asking again from now finds nothing new
    expect(await getConsoleNotices(owner, new Date(Date.now() + 1000))).toEqual([]);
  });

  it("counts orders waiting for the kitchen, table and guest app apart, for this restaurant only", async () => {
    const owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
    expect(await getLiveOrderCounts(owner)).toEqual({ table: 1, guest: 0 });

    const [order] = await env.db.select().from(s.orders).where(eq(s.orders.outletId, owner.outletId));
    await env.db.insert(s.deliveryCheckouts).values({ id: uuidv7(), tenantId: owner.tenantId, outletId: owner.outletId, sessionId: order.sessionId, tokenHash: "a".repeat(64), deviceId: "live-count", lines: [], address: { line: "Street", locality: "City", pincode: "302001", instructions: "" }, status: "placed", paymentStatus: "paid", totalPaise: 100, expiresAt: new Date(Date.now() + 86_400_000) });
    expect(await getLiveOrderCounts(owner)).toEqual({ table: 0, guest: 1 });

    await env.db.update(s.orders).set({ status: "preparing" }).where(eq(s.orders.id, order.id));
    expect(await getLiveOrderCounts(owner)).toEqual({ table: 0, guest: 0 });
  });
});
