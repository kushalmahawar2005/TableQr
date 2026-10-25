import "server-only";
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { localClock } from "@/domain/hours";
import { RECALL_WINDOW_MS, ticketUrgency, urgencyRank, type Urgency } from "@/domain/kitchen";
import { isPlaceholderName } from "@/domain/guest-name";
import type { StaffContext } from "../staff/context";
import { OPEN_TICKET_WINDOW_MS } from "./ticket-window";

// Data for the kitchen display (S2). One card per station ticket. A station screen sees its own
// tickets with other stations' lines on the same order dimmed for context; the expeditor sees
// every ticket. Everything shown is the order-time snapshot, never today's menu.

const OPEN: ("placed" | "accepted" | "preparing")[] = ["placed", "accepted", "preparing"];
export type TicketStage = "placed" | "accepted" | "preparing";

export async function getKitchenDisplay(ctx: StaffContext, opts: { station?: string | null } = {}, now = new Date()) {
  const station = opts.station ?? null;
  const t = ctx.tenantId;

  const since = new Date(now.getTime() - OPEN_TICKET_WINDOW_MS);
  const [open, [stale]] = await Promise.all([
    db
      .select()
      .from(s.tickets)
      .where(and(eq(s.tickets.tenantId, t), eq(s.tickets.outletId, ctx.outletId), inArray(s.tickets.status, ["new", "in_progress"]), gte(s.tickets.createdAt, since))),
    // Open tickets older than the window are not drawn, but never hidden silently: the board says how many
    db
      .select({ n: count() })
      .from(s.tickets)
      .where(and(eq(s.tickets.tenantId, t), eq(s.tickets.outletId, ctx.outletId), inArray(s.tickets.status, ["new", "in_progress"]), lt(s.tickets.createdAt, since))),
  ]);
  const staleOpen = Number(stale?.n ?? 0);

  // Open-ticket counts per station tab; All counts every open ticket
  const counts: Record<string, number> = { All: open.length };
  for (const tk of open) counts[tk.station] = (counts[tk.station] ?? 0) + 1;

  const lastBumped = await recallCandidate(ctx, station, now);
  const shown = station ? open.filter((tk) => tk.station === station) : open;
  const orderIds = [...new Set(shown.map((tk) => tk.orderId))];
  if (orderIds.length === 0) return { counts, cards: [] as KitchenCard[], lastBumped, staleOpen };

  const [orders, lines] = await Promise.all([
    db
      .select({ order: s.orders, session: s.tableSessions, placedByName: s.participants.displayName, waiterName: s.users.name })
      .from(s.orders)
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.orders.tenantId), eq(s.tableSessions.id, s.orders.sessionId)))
      .leftJoin(s.participants, and(eq(s.participants.tenantId, s.orders.tenantId), eq(s.participants.id, s.orders.placedByParticipantId)))
      .leftJoin(s.users, and(eq(s.users.tenantId, s.orders.tenantId), eq(s.users.id, s.orders.placedByUserId)))
      .where(and(eq(s.orders.tenantId, t), eq(s.orders.outletId, ctx.outletId), inArray(s.orders.id, orderIds))),
    db
      .select()
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, t), inArray(s.orderLines.orderId, orderIds)))
      .orderBy(asc(s.orderLines.id)),
  ]);
  const sessionIds = [...new Set(orders.map((o) => o.session.id))];
  const [assigned, people] = await Promise.all([
    // Every table the visit holds now, so a combined party reads T5 + T6
    db
      .select({ sessionId: s.sessionTables.sessionId, isPrimary: s.sessionTables.isPrimary, code: s.diningTables.code })
      .from(s.sessionTables)
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.sessionTables.tenantId), eq(s.diningTables.id, s.sessionTables.tableId)))
      .where(and(eq(s.sessionTables.tenantId, t), inArray(s.sessionTables.sessionId, sessionIds), isNotNull(s.sessionTables.activeKey))),
    db
      .select({ sessionId: s.participants.sessionId })
      .from(s.participants)
      .where(and(eq(s.participants.tenantId, t), inArray(s.participants.sessionId, sessionIds), isNull(s.participants.removedAt))),
  ]);
  const primaryCodes = await db
    .select({ id: s.diningTables.id, code: s.diningTables.code })
    .from(s.diningTables)
    .where(and(eq(s.diningTables.tenantId, t), inArray(s.diningTables.id, [...new Set(orders.map((o) => o.session.tableId))])));

  const byOrder = new Map(orders.map((o) => [o.order.id, o]));
  const cards: KitchenCard[] = shown.map((ticket) => {
    const o = byOrder.get(ticket.orderId)!;
    const orderLines = lines.filter((l) => l.orderId === ticket.orderId && l.status !== "cancelled" && l.status !== "voided");
    const mine = orderLines.filter((l) => l.station === ticket.station);
    const live = mine.filter((l) => OPEN.includes(l.status as TicketStage));
    // Target: the slowest dish on this ticket, from the snapshot taken when it was ordered
    const targetMinutes = Math.max(1, ...(live.length ? live : mine).map((l) => l.prepMinutes));
    const stage: TicketStage = live.some((l) => l.status === "placed") ? "placed" : live.some((l) => l.status === "preparing") || mine.some((l) => l.status === "ready") ? "preparing" : "accepted";
    const elapsedMs = Math.max(0, now.getTime() - o.order.placedAt.getTime());
    const codes = assigned.filter((a) => a.sessionId === o.session.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((a) => a.code);
    const joined = people.filter((p) => p.sessionId === o.session.id).length;
    return {
      ticketId: ticket.id,
      orderId: ticket.orderId,
      station: ticket.station,
      stage,
      isNew: ticket.status === "new" && stage === "placed",
      tableCodes: codes.length ? codes : [primaryCodes.find((p) => p.id === o.session.tableId)?.code ?? "?"],
      roundNo: o.order.roundNo,
      placedAt: o.order.placedAt.getTime(),
      elapsedMs,
      targetMinutes,
      urgency: ticketUrgency(elapsedMs, targetMinutes, stage !== "placed"),
      guests: Math.max(o.session.partySize ?? 0, joined) || null,
      source: o.session.source,
      placedBy: o.waiterName ? { kind: "staff" as const, name: o.waiterName } : o.placedByName && !isPlaceholderName(o.placedByName) ? { kind: "guest" as const, name: o.placedByName } : null,
      orderNote: o.order.note,
      lines: orderLines.map((line) => ({
        id: line.id,
        qty: line.qty,
        nameEn: line.nameEn,
        nameHi: line.nameHi,
        modifiers: (line.modifiers ?? []).map((m) => ({ en: m.nameEn, hi: m.nameHi })),
        note: line.note,
        personalForPickup: line.personalForPickup,
        /** null = unknown (older order or not stated); [] = declared none */
        allergens: line.allergensSnapshot ?? null,
        jain: line.isJainSnapshot ?? null,
        spice: line.spiceLevelSnapshot ?? null,
        station: line.station,
        status: line.status,
        /** Another station's item on this order: dimmed, tagged, not actionable here */
        otherStation: line.station !== ticket.station,
        done: line.status === "ready" || line.status === "served",
      })),
    };
  });

  // Most urgent first; within the same urgency, the ticket that has waited longest
  cards.sort((a, b) => urgencyRank(b.urgency) - urgencyRank(a.urgency) || a.placedAt - b.placedAt);
  return { counts, cards, lastBumped, staleOpen };
}

export type KitchenCard = {
  ticketId: string;
  orderId: string;
  station: string;
  stage: TicketStage;
  isNew: boolean;
  tableCodes: string[];
  roundNo: number;
  placedAt: number;
  elapsedMs: number;
  targetMinutes: number;
  urgency: Urgency;
  guests: number | null;
  source: "qr" | "walk_in" | "reservation" | "waitlist";
  placedBy: { kind: "staff" | "guest"; name: string } | null;
  orderNote: string | null;
  lines: {
    id: string;
    qty: number;
    nameEn: string;
    nameHi: string | null;
    modifiers: { en: string; hi: string | null }[];
    note: string | null;
    personalForPickup: boolean;
    allergens: string[] | null;
    jain: boolean | null;
    spice: number | null;
    station: string;
    status: string;
    otherStation: boolean;
    done: boolean;
  }[];
};

/** The station's most recently bumped ticket, if still inside the recall window, and whether it can come back */
async function recallCandidate(ctx: StaffContext, station: string | null, now: Date) {
  const [last] = await db
    .select({ id: s.tickets.id, orderId: s.tickets.orderId, station: s.tickets.station, bumpedAt: s.tickets.bumpedAt })
    .from(s.tickets)
    .where(
      and(
        eq(s.tickets.tenantId, ctx.tenantId),
        eq(s.tickets.outletId, ctx.outletId),
        eq(s.tickets.status, "done"),
        isNotNull(s.tickets.bumpedAt),
        station ? eq(s.tickets.station, station) : undefined,
      ),
    )
    .orderBy(desc(s.tickets.bumpedAt))
    .limit(1);
  if (!last?.bumpedAt) return null;
  const [ready] = await db
    .select({ id: s.orderLines.id })
    .from(s.orderLines)
    .where(and(eq(s.orderLines.tenantId, ctx.tenantId), eq(s.orderLines.orderId, last.orderId), eq(s.orderLines.station, last.station), eq(s.orderLines.status, "ready")))
    .limit(1);
  const [code] = await db
    .select({ code: s.diningTables.code, roundNo: s.orders.roundNo })
    .from(s.orders)
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.orders.tenantId), eq(s.tableSessions.id, s.orders.sessionId)))
    .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.orders.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
    .where(and(eq(s.orders.tenantId, ctx.tenantId), eq(s.orders.id, last.orderId)));
  const expired = now.getTime() - last.bumpedAt.getTime() > RECALL_WINDOW_MS;
  return {
    ticketId: last.id,
    station: last.station,
    tableCode: code?.code ?? "?",
    roundNo: code?.roundNo ?? 0,
    bumpedAt: last.bumpedAt.getTime(),
    recallUntil: last.bumpedAt.getTime() + RECALL_WINDOW_MS,
    /** expired: past 10 minutes; served: nothing left at the pass to bring back */
    blocked: expired ? ("expired" as const) : !ready ? ("served" as const) : null,
  };
}

/** Dishes switched off at this outlet right now, for the KDS stock panel */
export async function getUnavailableItems(ctx: StaffContext, now = new Date()) {
  return db
    .select({ id: s.menuItems.id, nameEn: s.menuItems.nameEn, nameHi: s.menuItems.nameHi, station: s.menuItems.station, until: s.outletItemOverrides.soldOutUntil })
    .from(s.outletItemOverrides)
    .innerJoin(s.menuItems, and(eq(s.menuItems.tenantId, s.outletItemOverrides.tenantId), eq(s.menuItems.id, s.outletItemOverrides.itemId)))
    .where(
      and(
        eq(s.outletItemOverrides.tenantId, ctx.tenantId),
        eq(s.outletItemOverrides.outletId, ctx.outletId),
        eq(s.outletItemOverrides.isAvailable, false),
        or(isNull(s.outletItemOverrides.soldOutUntil), gt(s.outletItemOverrides.soldOutUntil, now)),
      ),
    )
    .orderBy(s.menuItems.nameEn);
}

/** Menu search for the stock panel, limited to this outlet's brand menu */
export async function searchKitchenItems(ctx: StaffContext & { brandId: string }, q: string) {
  const term = String(q ?? "").trim().slice(0, 40);
  if (term.length < 2) return [];
  return db
    .select({ id: s.menuItems.id, nameEn: s.menuItems.nameEn, nameHi: s.menuItems.nameHi, station: s.menuItems.station })
    .from(s.menuItems)
    .where(and(eq(s.menuItems.tenantId, ctx.tenantId), eq(s.menuItems.brandId, ctx.brandId), eq(s.menuItems.isActive, true), or(like(s.menuItems.nameEn, `%${term.replace(/[%_\\]/g, "")}%`), like(s.menuItems.nameHi, `%${term.replace(/[%_\\]/g, "")}%`))))
    .orderBy(s.menuItems.nameEn)
    .limit(12);
}

/** Average order-to-bump time today, only once enough tickets have finished to mean something */
export async function averageTicketMinutes(ctx: StaffContext & { timezone: string }, now = new Date()) {
  const minutesToday = localClock(now, ctx.timezone).minutes;
  const since = new Date(now.getTime() - minutesToday * 60_000);
  const rows = await db
    .select({ bumpedAt: s.tickets.bumpedAt, placedAt: s.orders.placedAt })
    .from(s.tickets)
    .innerJoin(s.orders, and(eq(s.orders.tenantId, s.tickets.tenantId), eq(s.orders.id, s.tickets.orderId)))
    .where(and(eq(s.tickets.tenantId, ctx.tenantId), eq(s.tickets.outletId, ctx.outletId), eq(s.tickets.status, "done"), gte(s.tickets.bumpedAt, since), gte(s.orders.placedAt, since)));
  // A ticket left on the screen for hours and cleared later was forgotten, not cooked that long.
  const mins = rows.map((r) => (r.bumpedAt!.getTime() - r.placedAt.getTime()) / 60_000).filter((m) => m <= 180);
  if (mins.length < 3) return null;
  return Math.round(mins.reduce((n, m) => n + m, 0) / mins.length);
}
