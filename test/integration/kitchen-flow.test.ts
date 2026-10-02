import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { addCartLine, getCart } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { getGuestMenu } from "@/server/guest/menu";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { cancelOrderLine, getOrderTracker } from "@/server/guest/tracker";
import { acceptOrder, bumpLine, bumpTicket, markServed, recallTicket, setOutOfStock, startTicket } from "@/server/kitchen/actions";
import { getKitchenDisplay } from "@/server/kitchen/display";
import type { StaffContext } from "@/server/staff/context";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let kitchen: StaffContext;
let guest: GuestContext;
let orderId: string;
const T0 = new Date();
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

async function failsWith(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

const lineOf = async (name: string) =>
  (await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, orderId))).find((l) => l.nameEn === name)!;
const ticketOf = async (station: string) =>
  (await env.db.select().from(s.tickets).where(eq(s.tickets.orderId, orderId))).find((t) => t.station === station)!;

beforeAll(async () => {
  env = await resetTestDb();
  kitchen = { tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: null };

  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: "k-aarav", displayName: "Aarav" });
  guest = await getGuestContext("SRJ01", "k7Qm", participantId, "k-aarav");
  await addCartLine(guest, { itemId: env.demo.itemIds["Butter Chicken"], qty: 1, modifierIds: [env.demo.modifierIds.butterNaan], note: "less spicy" });
  await addCartLine(guest, { itemId: env.demo.itemIds["Paneer Tikka"], qty: 1 });
  await addCartLine(guest, { itemId: env.demo.itemIds["Cola"], qty: 1 });
  ({ orderId } = await placeOrder(guest, {}, T0));
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("kitchen display (S2)", () => {
  it("shows the expeditor one card per station ticket, every line visible, oldest first", async () => {
    const kds = await getKitchenDisplay(kitchen, {}, later(2));
    expect(kds.counts).toEqual({ All: 3, Main: 1, Tandoor: 1, Bar: 1 });
    expect(kds.cards).toHaveLength(3);
    const card = kds.cards.find((c) => c.station === "Main")!;
    expect(card).toMatchObject({ tableCodes: ["T12"], roundNo: 1, guests: 1, placedBy: { kind: "guest", name: "Aarav" }, urgency: "new" });
    expect(card.lines.map((l) => l.nameEn)).toEqual(["Butter Chicken", "Paneer Tikka", "Cola"]);
    expect(card.lines[0]).toMatchObject({ modifiers: [{ en: "Butter naan" }], note: "less spicy", allergens: ["dairy", "tree_nuts"] });
  });

  it("gives a station its own ticket and dims other stations' lines", async () => {
    const kds = await getKitchenDisplay(kitchen, { station: "Tandoor" }, later(2));
    expect(kds.cards).toHaveLength(1);
    const dimmed = Object.fromEntries(kds.cards[0].lines.map((l) => [l.nameEn, l.otherStation]));
    expect(dimmed).toEqual({ "Butter Chicken": true, "Paneer Tikka": false, Cola: true });
  });

  it("turns amber at the prep time and red at 1.5 times it", async () => {
    // Main's only dish is Butter Chicken at 18 minutes
    const main = async (m: number) => (await getKitchenDisplay(kitchen, { station: "Main" }, later(m))).cards[0].urgency;
    expect(await main(18)).toBe("getting_late");
    expect(await main(27)).toBe("late");
  });
});

describe("guest cancels before the kitchen accepts", () => {
  it("lets the guest cancel an item that is still only placed, closing that station's ticket", async () => {
    const cola = await lineOf("Cola");
    expect(await cancelOrderLine(guest, cola.id, later(1))).toBe("placed");
    expect((await ticketOf("Bar")).status).toBe("done");
    const tracker = await getOrderTracker(guest, later(1));
    expect(tracker.rounds[0].lines.find((l) => l.nameEn === "Cola")?.status).toBe("cancelled");
  });
});

describe("order lifecycle", () => {
  it("accepting shows Kitchen confirmed and stops guest cancellation", async () => {
    expect(await acceptOrder(kitchen, orderId, later(1))).toBe("accepted");
    const round = (await getOrderTracker(guest, later(1))).rounds[0];
    expect(round).toMatchObject({ status: "accepted", statusText: "Kitchen confirmed", step: 1 });
    expect(round.lines.every((l) => !l.canCancel)).toBe(true);
    await failsWith(cancelOrderLine(guest, (await lineOf("Paneer Tikka")).id), "invalid_state");
  });

  it("starting one station makes the whole order Being prepared", async () => {
    await startTicket(kitchen, (await ticketOf("Main")).id, later(3));
    const round = (await getOrderTracker(guest, later(3))).rounds[0];
    expect(round).toMatchObject({ status: "preparing", statusText: "Being prepared", step: 2 });
    expect((await lineOf("Butter Chicken")).status).toBe("preparing");
    expect((await lineOf("Paneer Tikka")).status).toBe("accepted");
  });

  it("bumping the last item of a station closes its ticket; the order waits for the slowest station", async () => {
    await bumpLine(kitchen, (await lineOf("Butter Chicken")).id, later(15));
    expect((await ticketOf("Main")).status).toBe("done");
    const [order] = await env.db.select().from(s.orders).where(eq(s.orders.id, orderId));
    expect(order.status).toBe("preparing");
  });

  it("bumping the last ticket makes the order Ready", async () => {
    expect(await bumpTicket(kitchen, (await ticketOf("Tandoor")).id, later(16))).toBe("ready");
    const round = (await getOrderTracker(guest, later(16))).rounds[0];
    expect(round).toMatchObject({ statusText: "Ready, coming to your table", step: 3 });
    const [order] = await env.db.select().from(s.orders).where(eq(s.orders.id, orderId));
    expect(order.readyAt?.getTime()).toBe(later(16).getTime());
    expect((await getKitchenDisplay(kitchen, {}, later(16))).cards).toHaveLength(0);
  });

  it("recalls a ticket bumped by mistake within 10 minutes, and not after", async () => {
    const tandoor = await ticketOf("Tandoor");
    const kds = await getKitchenDisplay(kitchen, {}, later(17));
    expect(kds.lastBumped?.ticketId).toBe(tandoor.id);

    expect(await recallTicket(kitchen, tandoor.id, later(20))).toBe("preparing");
    const [order] = await env.db.select().from(s.orders).where(eq(s.orders.id, orderId));
    expect(order.readyAt).toBeNull();
    expect((await getKitchenDisplay(kitchen, { station: "Tandoor" }, later(20))).cards).toHaveLength(1);

    await bumpTicket(kitchen, tandoor.id, later(21));
    await failsWith(recallTicket(kitchen, tandoor.id, later(32)), "recall_expired");
  });

  it("serving every plate makes the order Served", async () => {
    const lines = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, orderId));
    await markServed(kitchen, lines.map((l) => l.id), later(23));
    const [order] = await env.db.select().from(s.orders).where(eq(s.orders.id, orderId));
    expect(order.status).toBe("served");
  });
});

describe("out of stock from the KDS", () => {
  const menuCtx = () => ({
    tenantId: env.demo.tenantId,
    brandId: env.demo.brandId,
    outletId: env.demo.outletId,
    timezone: "Asia/Kolkata",
    soldOutDisplay: "grey" as const,
  });
  const dalOn = async (now: Date) =>
    (await getGuestMenu(menuCtx(), now)).flatMap((c) => c.items).find((i) => i.nameEn === "Dal Makhani")!.isAvailable;

  it("hides the dish from guests at once, flags carts holding it, and brings it back tomorrow", async () => {
    await addCartLine(guest, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    const res = await setOutOfStock(kitchen, env.demo.itemIds["Dal Makhani"], true, T0);
    expect(res.cartsAffected).toBe(1);
    expect(await dalOn(T0)).toBe(false);
    expect((await getCart(guest, T0)).mine.find((l) => l.nameEn === "Dal Makhani")?.isAvailable).toBe(false);
    expect(await dalOn(new Date(res.soldOutUntil!.getTime() + 1000))).toBe(true);

    await setOutOfStock(kitchen, env.demo.itemIds["Dal Makhani"], false, T0);
    expect(await dalOn(T0)).toBe(true);
  });
});

describe("kitchen isolation", () => {
  it("another restaurant's kitchen sees nothing and can change nothing here", async () => {
    const nukkad: StaffContext = { tenantId: env.other.tenantId, outletId: env.other.outletId, userId: null };
    const tandoor = await ticketOf("Tandoor");
    const line = await lineOf("Paneer Tikka");

    expect((await getKitchenDisplay(nukkad, {}, later(1))).cards).toHaveLength(0);
    await failsWith(acceptOrder(nukkad, orderId), "not_found");
    await failsWith(bumpTicket(nukkad, tandoor.id), "not_found");
    await failsWith(bumpLine(nukkad, line.id), "not_found");
    await failsWith(setOutOfStock(nukkad, env.demo.itemIds["Paneer Tikka"], true), "not_found");

    // Right restaurant, wrong outlet: an outlet id from the same tenant still has to match
    const otherOutlet: StaffContext = { ...kitchen, outletId: env.other.outletId };
    await failsWith(acceptOrder(otherOutlet, orderId), "not_found");
  });
});
