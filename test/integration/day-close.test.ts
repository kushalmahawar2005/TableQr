import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { requestBill, settleAtCounter } from "@/server/billing/payments";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getDayClose, istToday } from "@/server/staff/day-close";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// Day close adds up one IST day at this outlet: sales, money by method, open tables.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;

beforeAll(async () => {
  env = await resetTestDb();
  owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("day close", () => {
  it("counts today's paid bills and cash, and lists tables still open", async () => {
    const empty = await getDayClose(owner, istToday());
    expect(empty).toMatchObject({ isToday: true, collectedPaise: 0, bills: { count: 0 } });

    const qr = env.demo.tableQr.T1;
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "dc-a", displayName: "Aarav" });
    const g = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, "dc-a"), "Aarav");
    await addCartLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    await placeOrder(g);
    let open = await getDayClose(owner, istToday());
    expect(open.openTables.map((t) => t.table)).toContain("T1");

    await requestBill({ tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId });
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, g.sessionId));
    await settleAtCounter(owner, { sessionId: g.sessionId, method: "cash", receivedPaise: bill.totalPaise });

    open = await getDayClose(owner, istToday());
    expect(open.bills).toMatchObject({ count: 1, totalPaise: bill.totalPaise });
    expect(open.methods).toEqual([{ method: "cash", paise: bill.totalPaise, count: 1 }]);
    expect(open.netPaise).toBe(bill.totalPaise);
    expect(open.orders).toBe(1);
    expect(open.topItems[0]).toMatchObject({ name: "Dal Makhani", qty: 1 });
    expect(open.openTables.map((t) => t.table)).not.toContain("T1");

    // Another day knows nothing about today
    expect((await getDayClose(owner, "2020-01-01")).bills.count).toBe(0);
  });
});
