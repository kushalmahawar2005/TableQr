import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveKdsDevice, setupKdsDevice, type KdsDevice } from "@/server/kitchen/device";
import { kdsAccept, kdsCancelLine } from "@/server/kitchen/kds";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// Cancelling an item from the kitchen screen after it was accepted: a reason and a manager's PIN

let env: Awaited<ReturnType<typeof resetTestDb>>;
let expo: KdsDevice;
let orderId: string;
const MANAGER = { outletCode: "SRJ01", phone: "9000000002", pin: "2222" };

beforeAll(async () => {
  env = await resetTestDb();
  await env.db.insert(s.outletItemOverrides).values({
    tenantId: env.demo.tenantId,
    outletId: env.demo.outletId,
    itemId: env.demo.itemIds["Paneer Tikka"],
    portionsLeft: 5,
  }).onDuplicateKeyUpdate({ set: { portionsLeft: 5 } });
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: "cancel-guest", displayName: "Aarav" });
  const guest = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", "k7Qm", participantId, "cancel-guest"), "Aarav");
  await addCartLine(guest, { itemId: env.demo.itemIds["Paneer Tikka"], qty: 2 });
  await addCartLine(guest, { itemId: env.demo.itemIds["Cola"], qty: 1 });
  ({ orderId } = await placeOrder(guest));
  const { token } = await setupKdsDevice({ ...MANAGER, station: null, expeditor: true });
  expo = (await resolveKdsDevice(token))!;
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("cancel from the kitchen", () => {
  it("cancels an accepted item with a reason and a manager PIN, and the bill drops it", async () => {
    const tickets = await env.db.select().from(s.tickets).where(eq(s.tickets.orderId, orderId));
    for (const t of tickets) await kdsAccept(expo, t.id);
    const lines = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, orderId));
    const paneer = lines.find((l) => l.nameEn === "Paneer Tikka")!;
    const portionCount = async () => {
      const [row] = await env.db.select({ left: s.outletItemOverrides.portionsLeft }).from(s.outletItemOverrides)
        .where(eq(s.outletItemOverrides.itemId, env.demo.itemIds["Paneer Tikka"]));
      return row.left;
    };
    expect(await portionCount()).toBe(3);

    // A waiter's PIN is not enough, and a reason is required
    const refused = await kdsCancelLine(expo, { lineId: paneer.id, reason: "Guest left", phone: "9000000005", pin: "5555" }).then(() => null, (e: unknown) => e);
    expect((refused as AppError).code).toBe("forbidden");
    const noReason = await kdsCancelLine(expo, { lineId: paneer.id, reason: "", phone: MANAGER.phone, pin: MANAGER.pin }).then(() => null, (e: unknown) => e);
    expect((noReason as AppError).code).toBe("invalid_state");

    await kdsCancelLine(expo, { lineId: paneer.id, reason: "Guest left", phone: MANAGER.phone, pin: MANAGER.pin });
    const [after] = await env.db.select().from(s.orderLines).where(eq(s.orderLines.id, paneer.id));
    expect(after.status).toBe("voided");
    expect(after.voidReason).toBe("Kitchen: Guest left");
    expect(await portionCount()).toBe(5);
    await kdsCancelLine(expo, { lineId: paneer.id, reason: "Guest left", phone: MANAGER.phone, pin: MANAGER.pin });
    expect(await portionCount()).toBe(5);
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, paneer.sessionId));
    const cola = lines.find((l) => l.nameEn === "Cola")!;
    expect(bill.subtotalPaise).toBe(cola.unitPricePaise * cola.qty);
  });
});
