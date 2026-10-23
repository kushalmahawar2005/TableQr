import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderLines } from "@/db/schema";
import { isPlaceholderName } from "@/domain/guest-name";
import { ROOM_CLASS } from "@/domain/rooms";
import { optionsKind, primaryTag, rowPrice } from "@/domain/menu-price";
import { AppError } from "../errors";
import { getCart } from "./cart";
import type { GuestContext } from "./context";
import { getGuestMenu } from "./menu";
import { findMovedSession, findOpenSession, findTableById, findTableByQr } from "./table";

// Everything G3 Menu shows, in one server call: who and where the guest is, the menu as rows,
// and the guest's own cart. Option trees stay out of it; the item sheet (G4) loads those.

/** The guest at this table, found from their phone's device id. Throws session_expired if they are not in it. */
export async function guestContextForDevice(outletCode: string, shortCode: string, deviceId: string | null) {
  let t = await findTableByQr(db, outletCode, shortCode);
  let open = deviceId ? await findOpenSession(db, t.outlet.tenantId, t.table.id) : null;
  let me = open?.people.find((p) => p.deviceId === deviceId);
  if (!me && deviceId) {
    // The host moved this party to another table (S1): the phone keeps its visit, shown at the new table
    const moved = await findMovedSession(db, t.outlet.tenantId, t.table.id, deviceId);
    const mine = moved?.people.find((p) => p.deviceId === deviceId);
    if (moved && mine) {
      open = moved;
      me = mine;
      t = (await findTableById(db, t.outlet.tenantId, outletCode, moved.session.tableId)) ?? t;
    }
  }
  if (!open || !me) throw new AppError("session_expired", "Your table session has ended. Scan the table QR again to continue.");
  const ctx: GuestContext = {
    tenantId: t.outlet.tenantId,
    outletId: t.outlet.id,
    brandId: t.outlet.brandId,
    timezone: t.outlet.timezone,
    sessionId: open.session.id,
    // The visit's primary table: orders, requests and the bill are recorded against it
    tableId: open.session.tableId,
    participantId: me.id,
  };
  return { t, open, ctx };
}

/** Menu categories as G3 rows, plus the generated Popular list. Option trees stay out (G4 loads them). */
export function toMenuRows(categories: Awaited<ReturnType<typeof getGuestMenu>>) {
  const menu = categories.map((c) => ({
    id: c.id,
    nameEn: c.nameEn,
    nameHi: c.nameHi,
    items: c.items.map((i) => ({
      id: i.id,
      nameEn: i.nameEn,
      nameHi: i.nameHi,
      descriptionEn: i.descriptionEn,
      descriptionHi: i.descriptionHi,
      price: rowPrice(i.pricePaise, i.groups),
      options: optionsKind(i.groups),
      available: i.isAvailable,
      isVeg: i.isVeg,
      isJain: i.isJain,
      spice: i.spice,
      allergens: i.allergens,
      tag: primaryTag(i.tags),
      imageUrl: i.imageUrl,
      searchTerms: i.searchTerms,
    })),
  }));
  // "Popular" is generated from the restaurant's Bestseller tags, in menu order (G3 decision 1)
  const popularIds = menu.flatMap((c) => c.items.filter((i) => i.tag === "bestseller").map((i) => i.id));
  return { menu, popularIds };
}

export async function getMenuScreen(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()) {
  // Taken before any read: a cart write stamped later than this may be missing from the data
  const renderedAt = Date.now();
  const { t, open, ctx } = await guestContextForDevice(outletCode, shortCode, deviceId);

  const [categories, cart, [progress]] = await Promise.all([
    getGuestMenu({ ...ctx, soldOutDisplay: t.outlet.soldOutDisplay }, now),
    getCart(ctx, now),
    db.select({ count: sql<number>`coalesce(sum(${orderLines.qty}), 0)`.mapWith(Number) })
      .from(orderLines)
      .where(and(eq(orderLines.tenantId, ctx.tenantId), eq(orderLines.sessionId, ctx.sessionId), inArray(orderLines.status, ["placed", "accepted", "preparing", "ready"]))),
  ]);

  const { menu, popularIds } = toMenuRows(categories);

  // My cart only: plain lines drive the stepper; lines with options, notes or sharing show as "N in cart"
  const byItem: Record<string, { plain: number; custom: number }> = {};
  for (const l of cart.mine) {
    const entry = (byItem[l.itemId] ??= { plain: 0, custom: 0 });
    if (!l.modifiers.length && !l.note && !l.sharedWith.length) entry.plain += l.qty;
    else entry.custom += l.qty;
  }

  const host = open.people.find((p) => p.id === open.session.hostParticipantId);
  return {
    outlet: { code: t.outlet.code, name: t.outlet.name, logoUrl: t.logoUrl, accentColor: t.outlet.accentColor },
    table: { code: t.table.code, isRoom: t.table.tableClass === ROOM_CLASS },
    renderedAt,
    inProgress: progress.count,
    session: {
      /** Keys this visit's filters on the phone */
      key: open.session.id,
      people: open.people.length,
      status: open.session.status,
      orderingLocked: open.session.orderingLocked,
      /** Only a real name; a stand-in like "Guest 1" is shown as "the host" */
      hostName: host && !isPlaceholderName(host.displayName) ? host.displayName : null,
    },
    menu,
    popularIds,
    cart: {
      byItem,
      count: cart.mine.reduce((n, l) => n + l.qty, 0),
      subtotalPaise: cart.mySubtotalPaise,
    },
  };
}

export type MenuScreenData = Awaited<ReturnType<typeof getMenuScreen>>;
export type MenuRowItem = MenuScreenData["menu"][number]["items"][number];
