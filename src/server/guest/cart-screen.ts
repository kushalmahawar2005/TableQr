import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { isPlaceholderName } from "@/domain/guest-name";
import { ROOM_CLASS } from "@/domain/rooms";
import { getCart } from "./cart";
import { guestContextForDevice } from "./menu-screen";

// Everything G5 (Your order) shows: who and where the guest is, their own unplaced cart, and
// everyone else's unplaced cart as read-only groups. Placed orders are not here; they are G6.

export async function getCartScreen(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()) {
  // Taken before any read: a write stamped later than this may be missing from the data
  const renderedAt = Date.now();
  const { t, open, ctx } = await guestContextForDevice(outletCode, shortCode, deviceId);
  const cart = await getCart(ctx, now);

  const me = open.people.find((p) => p.id === ctx.participantId)!;
  const [[roomStay], [mine0]] = await Promise.all([
    t.table.tableClass === ROOM_CLASS
      ? db.select({ guestName: s.roomStays.guestName, guestPhone: s.roomStays.guestPhone }).from(s.rooms)
          .innerJoin(s.roomStays, and(eq(s.roomStays.tenantId, s.rooms.tenantId), eq(s.roomStays.roomId, s.rooms.id), eq(s.roomStays.openKey, s.rooms.id), eq(s.roomStays.status, "open")))
          .where(and(eq(s.rooms.tenantId, ctx.tenantId), eq(s.rooms.tableId, t.table.id), eq(s.rooms.isActive, true))).limit(1)
      : Promise.resolve([] as { guestName: string; guestPhone: string | null }[]),
    db.select({ contactPhone: s.participants.contactPhone }).from(s.participants).where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.id, ctx.participantId))),
  ]);
  const contactPhone = mine0?.contactPhone ?? null;
  const host = open.people.find((p) => p.id === open.session.hostParticipantId);

  const line = (l: (typeof cart.table)[number]) => ({
    id: l.id,
    itemId: l.itemId,
    nameEn: l.nameEn,
    nameHi: l.nameHi,
    isVeg: l.isVeg,
    qty: l.qty,
    options: l.modifiers,
    note: l.note,
    shared: l.sharedWith.length > 0,
    personalForPickup: l.personalForPickup,
    unitPricePaise: l.unitPricePaise,
    linePaise: l.linePaise,
    reason: l.reason,
    kind: l.kind,
  });

  // Other people's carts, grouped by person in the order they joined; names only when real
  const others = open.people
    .filter((p) => p.id !== ctx.participantId)
    .map((p) => {
      const lines = cart.table.filter((l) => l.ownerId === p.id).map(line);
      return {
        id: p.id,
        name: isPlaceholderName(p.displayName) ? null : p.displayName,
        count: lines.reduce((n, l) => n + l.qty, 0),
        // Read-only, and no prices: this is not a bill
        lines: lines.map((l) => ({ id: l.id, nameEn: l.nameEn, nameHi: l.nameHi, isVeg: l.isVeg, qty: l.qty, options: l.options, note: l.note, shared: l.shared, personalForPickup: l.personalForPickup, reason: l.reason })),
      };
    })
    .filter((g) => g.lines.length > 0);

  const mine = cart.mine.map(line);
  return {
    renderedAt,
    outlet: { code: t.outlet.code, name: t.outlet.name, logoUrl: t.logoUrl, accentColor: t.outlet.accentColor },
    table: { code: t.table.code },
    session: {
      key: open.session.id,
      people: open.people.length,
      status: open.session.status,
      orderingLocked: open.session.orderingLocked,
      hostName: host && !isPlaceholderName(host.displayName) ? host.displayName : null,
      // A checked-in room guest orders with a name and phone, no OTP
      verified: !!me.guestId || !!roomStay || (open.session.mode === "open" && open.people.some((person) => !!person.guestId)),
      /** Open mode asks for a first name at the first order */
      needsName: open.session.mode === "open" && isPlaceholderName(me.displayName),
      /** Room guest without a saved name and phone yet: asked in the cart, prefilled from check-in */
      roomContact: roomStay && !me.guestId && (isPlaceholderName(me.displayName) || !contactPhone) ? { name: isPlaceholderName(me.displayName) ? roomStay.guestName : me.displayName, phone: contactPhone ?? roomStay.guestPhone ?? "" } : null,
    },
    mine,
    myCount: mine.reduce((n, l) => n + l.qty, 0),
    subtotalPaise: cart.mySubtotalPaise,
    /** Prices the guest is reviewing now; sent back with Place order (comparison only) */
    quote: cart.quote,
    others,
  };
}

export type CartScreenData = Awaited<ReturnType<typeof getCartScreen>>;
export type CartLineView = CartScreenData["mine"][number];
export type OtherLineView = CartScreenData["others"][number]["lines"][number];
