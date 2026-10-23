import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { addItemsAtBilling } from "@/server/billing/counter-items";
import { requestBill, setSplitMode } from "@/server/billing/payments";
import { getKitchenDisplay } from "@/server/kitchen/display";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { getTableScreen } from "@/server/guest/table-screen";
import { sendCode, verifyCode } from "@/server/guest/verify";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { posBillDetail } from "@/server/staff/pos-read";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let guests: { name: string; phone: string; guestId: string; deviceId: string; ctx: GuestContext }[];

beforeAll(async () => {
  env = await resetTestDb();
  await env.db.update(s.outlets).set({ sessionMode: "verified" }).where(eq(s.outlets.id, env.demo.outletId));
  owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
  guests = [];

  for (const [i, name] of ["Hitesh", "Jayendra", "Mitarth"].entries()) {
    const deviceId = `group-guest-${i}`;
    const phone = `98765001${String(i).padStart(2, "0")}`;
    const shortCode = env.demo.tableQr.T10;
    const joined = await startOrJoinTable({ outletCode: "SRJ01", shortCode, deviceId });
    const sent = await sendCode({ outletCode: "SRJ01", shortCode, deviceId, country: "IN", phone });
    if (!sent.ok || !sent.devCode) throw new Error(`Could not send test OTP: ${sent.ok ? "missing mock code" : sent.error}`);
    const verified = await verifyCode({ outletCode: "SRJ01", shortCode, deviceId, challengeId: sent.challengeId, code: sent.devCode, name, consent: false });
    if (!verified.ok) throw new Error(`Could not verify ${name}: ${verified.error}`);
    const refreshed = await startOrJoinTable({ outletCode: "SRJ01", shortCode, deviceId });
    expect(refreshed.participantId).toBe(joined.participantId);
    const ctx = await getGuestContext("SRJ01", shortCode, joined.participantId, deviceId);
    await addCartLine(ctx, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    await placeOrder(ctx);
    guests.push({ name, phone, guestId: verified.guestId, deviceId, ctx });
  }
  await requestBill({ tenantId: guests[0].ctx.tenantId, outletId: guests[0].ctx.outletId, sessionId: guests[0].ctx.sessionId });
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("verified group guest billing", () => {
  it("keeps three phone-verified identities on one visit, lists every name, and charges a parcel item only to its selected guest", async () => {
    const [host, selected] = guests;
    expect(new Set(guests.map((g) => g.guestId)).size).toBe(3);
    expect(new Set(guests.map((g) => g.phone)).size).toBe(3);
    expect(new Set(guests.map((g) => g.ctx.sessionId)).size).toBe(1);
    expect(new Set(guests.map((g) => g.ctx.participantId)).size).toBe(3);
    const persisted = await env.db.select({ id: s.participants.id, guestId: s.participants.guestId, displayName: s.participants.displayName, sessionId: s.participants.sessionId })
      .from(s.participants)
      .where(inArray(s.participants.id, guests.map((g) => g.ctx.participantId)));
    expect(persisted).toHaveLength(3);
    expect(persisted.map((p) => p.guestId).sort()).toEqual(guests.map((g) => g.guestId).sort());
    expect(persisted.map((p) => p.displayName).sort()).toEqual(guests.map((g) => g.name).sort());
    expect(new Set(persisted.map((p) => p.sessionId)).size).toBe(1);

    const detail = await posBillDetail(owner, host.ctx.sessionId);
    expect(detail.people.map((p) => p.name).sort()).toEqual(["Hitesh", "Jayendra", "Mitarth"].sort());
    const table = await getTableScreen("SRJ01", env.demo.tableQr.T10, host.deviceId);
    expect(table.people.map((p) => p.name).sort()).toEqual(["Hitesh", "Jayendra", "Mitarth"].sort());

    await setSplitMode(host.ctx, "equal");
    const share = async (participantId: string) => {
      const rows = await env.db.select({ amountPaise: s.billShares.amountPaise }).from(s.billShares)
        .innerJoin(s.bills, and(eq(s.bills.tenantId, s.billShares.tenantId), eq(s.bills.id, s.billShares.billId)))
        .where(and(eq(s.bills.sessionId, host.ctx.sessionId), eq(s.billShares.participantId, participantId)));
      return rows[0]?.amountPaise ?? 0;
    };
    const before = await Promise.all(guests.map((g) => share(g.ctx.participantId)));
    const placed = await addItemsAtBilling(owner, {
      sessionId: host.ctx.sessionId,
      tableId: env.demo.tableIds.T10,
      participantId: selected.ctx.participantId,
      clientRequestId: `verified-group-parcel-${Date.now()}`,
      lines: [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [], personalForPickup: true }],
    });
    const after = await Promise.all(guests.map((g) => share(g.ctx.participantId)));
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBeGreaterThan(before[1]);
    expect(after[2]).toBe(before[2]);

    const [line] = await env.db.select().from(s.orderLines).where(and(eq(s.orderLines.orderId, placed.orderId), eq(s.orderLines.personalForPickup, true)));
    expect(line.participantId).toBe(selected.ctx.participantId);
    const kitchen = await getKitchenDisplay({ tenantId: owner.tenantId, outletId: owner.outletId, userId: owner.userId });
    expect(kitchen.cards.flatMap((card) => card.lines).some((entry) => entry.id === line.id && entry.personalForPickup)).toBe(true);
  });
});
