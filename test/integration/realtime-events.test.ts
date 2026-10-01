import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { requestBill, settleAtCounter } from "@/server/billing/payments";
import { AppError } from "@/server/errors";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { acceptOrder, setOutOfStock } from "@/server/kitchen/actions";
import { onPublish, type RealtimeEvent } from "@/server/realtime/publish";
import type { StaffContext } from "@/server/staff/context";
import { resetTestDb } from "./setup-db";

// Every change announces itself to exactly the screens that show it, and only after it commits.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let sent: { outletId: string; events: RealtimeEvent[] }[] = [];
let stop: () => void;
let guest: GuestContext;
let staff: StaffContext;

const flat = () => sent.flatMap((x) => x.events.map((e) => `${e.topic.startsWith("session:") ? "session" : e.topic} ${e.type}`));

beforeAll(async () => {
  env = await resetTestDb();
  staff = { tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: null };
  stop = onPublish((scope, events) => sent.push({ outletId: scope.outletId, events }));
});
beforeEach(() => {
  sent = [];
});
afterAll(async () => {
  stop();
  await env.conn.end();
  await appDb.$client.end();
});

describe("realtime events", () => {
  it("seating a new table tells the floor map and the table", async () => {
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: "rt-a", displayName: "Kiran" });
    guest = await getGuestContext("SRJ01", "k7Qm", participantId, "rt-a");
    expect(flat()).toEqual(["session participant.joined", "floor table.state_changed", "floor floor.session_updated"]);
    expect(sent[0].outletId).toBe(env.demo.outletId);
  });

  it("a returning phone announces nothing", async () => {
    await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: "rt-a" });
    expect(flat()).toEqual([]);
  });

  it("cart edits reach the whole table; placing an order reaches the kitchen", async () => {
    await addCartLine(guest, { itemId: env.demo.itemIds["Cola"], qty: 1 });
    expect(flat()).toEqual(["session cart.updated"]);
    sent = [];
    await placeOrder(guest);
    expect(flat()).toEqual(["kitchen ticket.created", "session order.status", "session cart.updated", "floor floor.session_updated"]);
  });

  it("a failed action announces nothing", async () => {
    await placeOrder(guest).catch((e: AppError) => expect(e.code).toBe("cart_empty"));
    expect(flat()).toEqual([]);
  });

  it("kitchen changes reach the KDS and the guest's tracker", async () => {
    const orderId = await placeLatest();
    await acceptOrder(staff, orderId);
    expect(flat()).toEqual(["kitchen ticket.updated", "session order.status"]);
  });

  it("out of stock reaches every guest menu and the kitchen", async () => {
    await setOutOfStock(staff, env.demo.itemIds["Gulab Jamun"], true);
    expect(flat()).toEqual(["menu item.availability", "kitchen item.availability"]);
  });

  it("request bill and settling recolour the table on the floor map", async () => {
    const scope = { tenantId: guest.tenantId, outletId: guest.outletId, sessionId: guest.sessionId };
    await requestBill(scope);
    expect(flat()).toEqual(["session bill.updated", "floor table.state_changed", "floor floor.session_updated"]);
    sent = [];
    await settleAtCounter(staff, { sessionId: guest.sessionId, method: "cash" });
    // G8/G9 phones also hear that a payment landed and that the table closed
    expect(flat()).toEqual(["session bill.updated", "session payment.updated", "session session.closed", "floor table.state_changed", "floor floor.session_updated"]);
    expect(sent[0].events[3].data).toMatchObject({ state: "paid" });
  });
});

async function placeLatest() {
  await addCartLine(guest, { itemId: env.demo.itemIds["Masala Lassi"], qty: 1 });
  const { orderId } = await placeOrder(guest);
  sent = [];
  return orderId;
}
