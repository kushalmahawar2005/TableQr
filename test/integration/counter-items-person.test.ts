import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { addItemsAtBilling } from "@/server/billing/counter-items";
import { requestBill, setSplitMode } from "@/server/billing/payments";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { resetTestDb } from "./setup-db";

// Two people at a table; the counter adds a water bottle for one of them. Only that person's
// share goes up, whichever way the table split the bill.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let n = 0;

beforeAll(async () => {
  env = await resetTestDb();
  owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

async function table(code: "T6" | "T7") {
  const qr = env.demo.tableQr[code];
  const a = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: `${code}-a`, displayName: "Hitesh" });
  const host = await getGuestContext("SRJ01", qr, a.participantId, `${code}-a`);
  const b = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: `${code}-b`, displayName: "Jayendra" });
  const other = await getGuestContext("SRJ01", qr, b.participantId, `${code}-b`);
  for (const g of [host, other]) {
    await addCartLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    await placeOrder(g);
  }
  await requestBill({ tenantId: host.tenantId, outletId: host.outletId, sessionId: host.sessionId });
  return { host, other, tableId: env.demo.tableIds[code] };
}

const shareOf = async (g: GuestContext) => {
  const rows = await env.db.select().from(s.billShares).where(eq(s.billShares.participantId, g.participantId));
  return rows[0]?.amountPaise ?? 0;
};

const addFor = (g: GuestContext, tableId: string) =>
  addItemsAtBilling(owner, { sessionId: g.sessionId, tableId, participantId: g.participantId, clientRequestId: `person-${++n}-${Date.now()}`, lines: [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [] }] });

describe("counter items for one person", () => {
  it("my items: only that person's share goes up", async () => {
    const { host, other, tableId } = await table("T6");
    const [hostBefore, otherBefore] = [await shareOf(host), await shareOf(other)];
    await addFor(other, tableId);
    expect(await shareOf(host)).toBe(hostBefore);
    expect(await shareOf(other)).toBeGreaterThan(otherBefore);
  });

  it("equal split: only that person's share goes up", async () => {
    const { host, other, tableId } = await table("T7");
    await setSplitMode(host, "equal");
    const [hostBefore, otherBefore] = [await shareOf(host), await shareOf(other)];
    await addFor(other, tableId);
    expect(await shareOf(host)).toBe(hostBefore);
    expect(await shareOf(other)).toBeGreaterThan(otherBefore);
  });
});
