import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { requestBill } from "@/server/billing/payments";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// Only a GST-registered outlet may charge GST. Without a GSTIN, dishes sell at 0% and bills carry
// no tax, including dishes ordered before the GSTIN was removed.

let env: Awaited<ReturnType<typeof resetTestDb>>;

beforeAll(async () => {
  env = await resetTestDb();
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

async function guestAt(table: "T1" | "T2", device: string) {
  const qr = env.demo.tableQr[table];
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: device, displayName: "Aarav" });
  return attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, device), "Aarav");
}

const billOf = async (sessionId: string) => (await env.db.select().from(s.bills).where(eq(s.bills.sessionId, sessionId)))[0];

describe("GST needs a GSTIN", () => {
  it("charges GST while the outlet has a GSTIN", async () => {
    const g = await guestAt("T1", "gst-a");
    await addCartLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    await placeOrder(g);
    await requestBill({ tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId });
    expect((await billOf(g.sessionId)).taxPaise).toBeGreaterThan(0);
  });

  it("sells at 0% and bills no tax once the GSTIN is removed, even for dishes already ordered", async () => {
    const g = await guestAt("T2", "gst-b");
    await addCartLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    await placeOrder(g);
    await env.db.update(s.outlets).set({ gstin: null }).where(eq(s.outlets.id, g.outletId));

    await addCartLine(g, { itemId: env.demo.itemIds["Butter Naan"], qty: 2 });
    await placeOrder(g);
    const naan = await env.db.select({ taxRateBp: s.orderLines.taxRateBp }).from(s.orderLines)
      .where(and(eq(s.orderLines.sessionId, g.sessionId), eq(s.orderLines.itemId, env.demo.itemIds["Butter Naan"])));
    expect(naan.map((l) => l.taxRateBp)).toEqual([0]);

    await requestBill({ tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId });
    const bill = await billOf(g.sessionId);
    expect(bill.taxPaise).toBe(0);
    expect(bill.totalPaise).toBe(Math.round(bill.subtotalPaise / 100) * 100);
  });
});
