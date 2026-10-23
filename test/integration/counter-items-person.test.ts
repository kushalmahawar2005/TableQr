import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { addItemsAtBilling } from "@/server/billing/counter-items";
import { requestBill, setSplitMode } from "@/server/billing/payments";
import { addCartLine, addConfiguredLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { resetTestDb } from "./setup-db";
import { uuidv7 } from "@/db/id";

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

async function table(code: "T6" | "T7" | "T8", pickupFor?: "host" | "other") {
  const qr = env.demo.tableQr[code];
  const a = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: `${code}-a`, displayName: "Hitesh" });
  const host = await getGuestContext("SRJ01", qr, a.participantId, `${code}-a`);
  const b = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: `${code}-b`, displayName: "Jayendra" });
  const other = await getGuestContext("SRJ01", qr, b.participantId, `${code}-b`);
  for (const [ctx, phone] of [[host, `+91990000${String(++n).padStart(4, "0")}`], [other, `+91990000${String(++n).padStart(4, "0")}`]] as const) {
    const guestId = uuidv7();
    await env.db.insert(s.guests).values({ id: guestId, tenantId: ctx.tenantId, phone, name: "Table guest" });
    await env.db.update(s.participants).set({ guestId }).where(eq(s.participants.id, ctx.participantId));
  }
  for (const [person, g] of [["host", host], ["other", other]] as const) {
    await addCartLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    if (pickupFor === person) {
      await addConfiguredLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1, personalForPickup: true });
    }
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

  it("equal split keeps an online takeaway item on the person who ordered it", async () => {
    const { host, other } = await table("T8", "other");
    await setSplitMode(host, "equal");
    const [hostShare, otherShare] = [await shareOf(host), await shareOf(other)];
    expect(hostShare).toBeGreaterThan(0);
    expect(otherShare).toBeGreaterThan(hostShare);
    const pickupLines = await env.db.select().from(s.orderLines).where(and(eq(s.orderLines.sessionId, other.sessionId), eq(s.orderLines.personalForPickup, true)));
    expect(pickupLines).toHaveLength(1);
    expect(pickupLines[0].participantId).toBe(other.participantId);
  });
});
