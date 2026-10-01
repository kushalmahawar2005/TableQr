import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { RECALL_WINDOW_MS, ticketUrgency } from "@/domain/kitchen";
import type { StaffContext } from "../staff/context";

// Data for the kitchen display (S2). With no station the expeditor sees one card per order;
// with a station each card is that station's ticket, and other stations' lines are dimmed.

export async function getKitchenDisplay(ctx: StaffContext, opts: { station?: string | null } = {}, now = new Date()) {
  const station = opts.station ?? null;

  const open = await db
    .select()
    .from(s.tickets)
    .where(
      and(
        eq(s.tickets.tenantId, ctx.tenantId),
        eq(s.tickets.outletId, ctx.outletId),
        inArray(s.tickets.status, ["new", "in_progress"]),
      ),
    );

  const recallable = await db
    .select({ id: s.tickets.id, orderId: s.tickets.orderId, station: s.tickets.station, bumpedAt: s.tickets.bumpedAt })
    .from(s.tickets)
    .where(
      and(
        eq(s.tickets.tenantId, ctx.tenantId),
        eq(s.tickets.outletId, ctx.outletId),
        eq(s.tickets.status, "done"),
        gte(s.tickets.bumpedAt, new Date(now.getTime() - RECALL_WINDOW_MS)),
        station ? eq(s.tickets.station, station) : undefined,
      ),
    )
    .orderBy(desc(s.tickets.bumpedAt))
    .limit(1);

  // Station tab counts (All counts orders, each station counts its tickets)
  const counts: Record<string, number> = { All: new Set(open.map((t) => t.orderId)).size };
  for (const t of open) counts[t.station] = (counts[t.station] ?? 0) + 1;

  const shown = station ? open.filter((t) => t.station === station) : open;
  const orderIds = [...new Set(shown.map((t) => t.orderId))];
  if (orderIds.length === 0) return { counts, cards: [], lastBumped: recallable[0] ?? null };

  const [orders, lines] = await Promise.all([
    db
      .select({
        order: s.orders,
        tableCode: s.diningTables.code,
        placedByName: s.participants.displayName,
        waiterName: s.users.name,
      })
      .from(s.orders)
      .innerJoin(s.tableSessions, eq(s.tableSessions.id, s.orders.sessionId))
      .innerJoin(s.diningTables, eq(s.diningTables.id, s.tableSessions.tableId))
      .leftJoin(s.participants, eq(s.participants.id, s.orders.placedByParticipantId))
      .leftJoin(s.users, eq(s.users.id, s.orders.placedByUserId))
      .where(and(eq(s.orders.tenantId, ctx.tenantId), inArray(s.orders.id, orderIds))),
    db
      .select({ line: s.orderLines, allergens: s.menuItems.allergens, prepMinutes: s.menuItems.prepMinutes })
      .from(s.orderLines)
      .innerJoin(s.menuItems, eq(s.menuItems.id, s.orderLines.itemId))
      .where(and(eq(s.orderLines.tenantId, ctx.tenantId), inArray(s.orderLines.orderId, orderIds)))
      .orderBy(asc(s.orderLines.id)),
  ]);

  const guestCounts = await db
    .select({ sessionId: s.participants.sessionId })
    .from(s.participants)
    .where(
      and(
        eq(s.participants.tenantId, ctx.tenantId),
        inArray(s.participants.sessionId, [...new Set(orders.map((o) => o.order.sessionId))]),
        isNull(s.participants.removedAt),
      ),
    );

  const byOrder = new Map(orders.map((o) => [o.order.id, o]));
  const cardKeys = station ? shown.map((t) => ({ orderId: t.orderId, ticket: t })) : orderIds.map((orderId) => ({ orderId, ticket: null }));

  const cards = cardKeys.map(({ orderId, ticket }) => {
    const o = byOrder.get(orderId)!;
    const orderLines = lines.filter((l) => l.line.orderId === orderId && !["cancelled", "voided"].includes(l.line.status));
    const mine = orderLines.filter((l) => !station || l.line.station === station);
    const targetMinutes = Math.max(...mine.map((l) => l.prepMinutes), 1);
    const started = mine.some((l) => ["preparing", "ready", "served"].includes(l.line.status)) || ticket?.status === "in_progress";
    const elapsedMs = now.getTime() - o.order.placedAt.getTime();

    return {
      orderId,
      ticketId: ticket?.id ?? null,
      tickets: shown.filter((t) => t.orderId === orderId).map((t) => ({ id: t.id, station: t.station, status: t.status })),
      tableCode: o.tableCode,
      roundNo: o.order.roundNo,
      placedAt: o.order.placedAt,
      elapsedMs,
      urgency: ticketUrgency(elapsedMs, targetMinutes, started),
      guests: guestCounts.filter((g) => g.sessionId === o.order.sessionId).length,
      placedBy: o.waiterName ? `${o.waiterName} (waiter)` : (o.placedByName ?? null),
      orderStatus: o.order.status,
      note: o.order.note,
      lines: orderLines.map(({ line, allergens }) => ({
        id: line.id,
        qty: line.qty,
        nameEn: line.nameEn,
        modifiers: (line.modifiers ?? []).map((m) => m.nameEn),
        note: line.note,
        allergens: allergens ?? [],
        station: line.station,
        status: line.status,
        /** Another station's item on this order: shown dimmed with a tag */
        otherStation: station !== null && line.station !== station,
        /** Bumped items stay on the card, struck through */
        done: ["ready", "served"].includes(line.status),
      })),
    };
  });

  // Oldest first, so the ticket that has waited longest is always top left
  cards.sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());
  return { counts, cards, lastBumped: recallable[0] ?? null };
}
