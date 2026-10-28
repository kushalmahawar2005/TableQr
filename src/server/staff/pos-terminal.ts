import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { checkFirstName, isPlaceholderName } from "@/domain/guest-name";
import { hasGstin, OPEN_TAX_RATES } from "@/domain/gst";
import { ROOM_CLASS } from "@/domain/rooms";
import { AppError } from "../errors";
import { addItemsAtBilling } from "../billing/counter-items";
import { startTakeaway } from "../floor/takeaway";
import { getActiveLayout } from "../floor/read";
import { seatWalkIn } from "../floor/table-actions";
import { TAKEAWAY_CLASS } from "../floor/takeaway-class";
import { isWithinCategoryWindow, loadItems } from "../guest/menu";
import type { AnyDraftLine } from "../guest/order";
import type { PriceQuote } from "@/domain/pricing";
import type { StaffSession } from "./auth";
import { requireFeature } from "../plan";
import { requireStaffRole } from "./waiter";
import { addPhonelessDiner } from "./waiter-mutations";

// The POS terminal: the cashier picks a table or a takeaway, taps dishes (or types an open item),
// and sends them to the kitchen; the bill is then paid on the Billing screen. Everything here goes
// through the same order and bill code as the waiter app, so the kitchen, floor and reports agree.

const LIVE_LINE = ["cancelled", "voided"] as const;
const stableJson = (value: unknown): string => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}` : JSON.stringify(value);
/** Who may punch orders at the POS: the billing roles except the accountant, who only reads */
export const posTerminalRoles = ["cashier", "manager", "owner", "reception"] as const;

export async function posTerminal(staff: StaffSession, now = new Date()) {
  await requireStaffRole(staff, posTerminalRoles);
  await requireFeature(staff.tenantId, "pos");
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  const [[outlet], layout] = await Promise.all([
    db.select({ brandId: s.outlets.brandId, timezone: s.outlets.timezone, gstin: s.outlets.gstin }).from(s.outlets).where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId))),
    getActiveLayout(scope),
  ]);
  if (!outlet) throw new AppError("not_found", "This outlet was not found.");
  const [items, categories, visits] = await Promise.all([
    loadItems(db, { ...scope, brandId: outlet.brandId }, now),
    db.select({ id: s.menuCategories.id, name: s.menuCategories.nameEn, nameHi: s.menuCategories.nameHi }).from(s.menuCategories)
      .where(and(eq(s.menuCategories.tenantId, scope.tenantId), eq(s.menuCategories.brandId, outlet.brandId), eq(s.menuCategories.isActive, true)))
      .orderBy(asc(s.menuCategories.sortOrder), asc(s.menuCategories.nameEn)),
    db.select({ tableId: s.sessionTables.tableId, isPrimary: s.sessionTables.isPrimary, session: s.tableSessions })
      .from(s.sessionTables)
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId)))
      .where(and(eq(s.sessionTables.tenantId, scope.tenantId), eq(s.sessionTables.outletId, scope.outletId), isNotNull(s.sessionTables.activeKey), ne(s.tableSessions.status, "closed"))),
  ]);
  const sessionIds = [...new Set(visits.map((v) => v.session.id))];
  const totals = sessionIds.length
    ? await db.select({ sessionId: s.orderLines.sessionId, paise: sql<string>`sum(${s.orderLines.unitPricePaise} * ${s.orderLines.qty})`, qty: sql<string>`sum(${s.orderLines.qty})` })
        .from(s.orderLines)
        .where(and(eq(s.orderLines.tenantId, scope.tenantId), inArray(s.orderLines.sessionId, sessionIds), notInArray(s.orderLines.status, [...LIVE_LINE])))
        .groupBy(s.orderLines.sessionId)
    : [];
  const totalOf = new Map(totals.map((t) => [t.sessionId, { paise: Number(t.paise ?? 0), qty: Number(t.qty ?? 0) }]));
  const visitOf = (session: typeof s.tableSessions.$inferSelect) => ({
    id: session.id,
    status: session.status,
    guestName: session.guestName,
    openedAt: session.openedAt.getTime(),
    orderedPaise: totalOf.get(session.id)?.paise ?? 0,
    items: totalOf.get(session.id)?.qty ?? 0,
  });

  const zoneName = new Map(layout.zones.map((z) => [z.id, z.name]));
  const byTable = new Map(visits.map((v) => [v.tableId, v.session]));
  const tables = layout.tables
    .filter((t) => t.tableClass !== TAKEAWAY_CLASS && t.tableClass !== ROOM_CLASS)
    .map((t) => {
      const session = byTable.get(t.id);
      return { id: t.id, code: t.code, zoneId: t.zoneId, zone: zoneName.get(t.zoneId) ?? "", seats: t.maxSeats, state: t.state, visit: session ? visitOf(session) : null };
    });
  // Takeaway counters are hidden from the floor (isActive false), so they come from their visits
  const counterIds = visits.map((v) => v.tableId);
  const counters = counterIds.length
    ? await db.select({ id: s.diningTables.id, code: s.diningTables.code }).from(s.diningTables)
        .where(and(eq(s.diningTables.tenantId, scope.tenantId), inArray(s.diningTables.id, counterIds), eq(s.diningTables.tableClass, TAKEAWAY_CLASS)))
    : [];
  const takeaways = counters
    .map((c) => ({ tableId: c.id, code: c.code, visit: visitOf(byTable.get(c.id)!) }))
    .sort((a, b) => b.visit.openedAt - a.visit.openedAt);

  const menu = items.map((x) => ({
    id: x.item.id,
    categoryId: x.item.categoryId,
    name: x.item.nameEn,
    nameHi: x.item.nameHi,
    isVeg: x.item.isVeg,
    imageUrl: x.item.imageUrl,
    station: x.item.station,
    pricing: { ...x.pricing, isAvailable: x.pricing.isAvailable && isWithinCategoryWindow(x.categoryWindow, outlet.timezone, now) },
  }));
  const used = new Set(menu.map((m) => m.categoryId));
  // Open items: the kitchen station most dishes go to, and the GST most dishes carry
  const count = <T,>(xs: T[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>())].sort((a, b) => b[1] - a[1]).map(([x]) => x);
  const stations = count(items.map((x) => x.item.station));
  const gst = hasGstin(outlet.gstin);
  const commonTax = count(items.map((x) => x.item.taxRateBp)).find((r) => (OPEN_TAX_RATES as readonly number[]).includes(r));
  return {
    loadedAt: now.getTime(),
    tables,
    zones: layout.zones.filter((z) => tables.some((t) => t.zoneId === z.id)),
    takeaways,
    categories: categories.filter((c) => used.has(c.id)),
    menu,
    openItem: { stations: stations.length ? stations : ["kitchen"], gst, taxRateBp: gst ? (commonTax ?? 500) : 0 },
  };
}
export type PosTerminal = Awaited<ReturnType<typeof posTerminal>>;

/** Open a free table for billing at the counter, as a walk-in */
export async function posOpenTable(staff: StaffSession, input: { tableId: string; partySize?: number; guestName?: string | null; clientRequestId?: string }, now = new Date()) {
  await requireStaffRole(staff, posTerminalRoles);
  await requireFeature(staff.tenantId, "pos");
  const [table] = await db.select({ tableClass: s.diningTables.tableClass, maxSeats: s.diningTables.maxSeats }).from(s.diningTables)
    .where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId), eq(s.diningTables.id, String(input.tableId)), eq(s.diningTables.isActive, true)));
  if (!table || table.tableClass === TAKEAWAY_CLASS || table.tableClass === ROOM_CLASS) throw new AppError("not_found", "This table was not found.");
  const partySize = Math.min(table.maxSeats, Math.max(1, Math.floor(Number(input.partySize) || 1)));
  return seatWalkIn(staff, { tableId: String(input.tableId), partySize, guestName: input.guestName?.trim().slice(0, 80) || null }, now, { checkedByPos: true, clientRequestId: input.clientRequestId });
}

/** Recover an unstarted local order only after this manager approved the exact destination/details. */
export async function posRecoverOfflineOrderVisit(staff: StaffSession, input: { requestId: string; current: { sessionId: string | null; tableId: string | null; code: string; takeaway: boolean; seats: number }; guestName: string; partySize: number }, now = new Date()) {
  await requireStaffRole(staff, ["owner", "manager"]);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(input.requestId) || input.current.sessionId || (!input.current.takeaway && !input.current.tableId) || !Number.isSafeInteger(input.partySize) || input.partySize < 1 || input.partySize > 50) {
    throw new AppError("invalid_state", "This saved order needs review by the original staff login.");
  }
  const [approval] = await db.select({ after: s.auditLog.after }).from(s.auditLog)
    .where(and(eq(s.auditLog.tenantId, staff.tenantId), eq(s.auditLog.outletId, staff.outletId), eq(s.auditLog.action, "pos.offline_order_approved"), eq(s.auditLog.entityId, input.requestId)))
    .orderBy(desc(s.auditLog.createdAt), desc(s.auditLog.id)).limit(1);
  const details = approval?.after as { approvedByUserId?: unknown; current?: { sessionId?: unknown; tableId?: unknown; takeaway?: unknown }; guestName?: unknown; partySize?: unknown } | null | undefined;
  if (details?.approvedByUserId !== staff.userId || details.current?.sessionId !== null || details.current?.tableId !== input.current.tableId || details.current?.takeaway !== input.current.takeaway || details.guestName !== (input.guestName.trim() || null) || details.partySize !== input.partySize) {
    throw new AppError("forbidden", "Review this recovery record again before opening a table.");
  }
  if (input.current.takeaway) {
    const opened = await startTakeaway(staff, { name: input.guestName.trim() || null, clientRequestId: input.requestId }, now);
    return { sessionId: opened.sessionId, tableId: opened.tableId, code: opened.code };
  }
  const opened = await posOpenTable(staff, { tableId: input.current.tableId!, partySize: input.partySize, guestName: input.guestName.trim() || null, clientRequestId: input.requestId }, now);
  const fresh = await posTerminal(staff, now);
  const visit = fresh.tables.find((table) => table.visit?.id === opened.sessionId);
  return { sessionId: opened.sessionId, tableId: input.current.tableId!, code: visit?.code ?? input.current.code };
}

/**
 * Send dishes to the kitchen on a table or takeaway. The order is placed for the first named diner;
 * a table nobody scanned gets a diner called Guest (or the name the cashier gave).
 */
export async function posSendOrder(staff: StaffSession, input: { sessionId: string; clientRequestId: string; lines: AnyDraftLine[]; quote?: PriceQuote; guestName?: string | null; managerApprovedOfflineRequestId?: string }, now = new Date()) {
  await requireStaffRole(staff, posTerminalRoles);
  await requireFeature(staff.tenantId, "pos");
  const sessionId = String(input.sessionId);
  const [session] = await db.select({ tableId: s.tableSessions.tableId, status: s.tableSessions.status }).from(s.tableSessions)
    .where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), eq(s.tableSessions.id, sessionId)));
  if (!session || session.status === "closed") throw new AppError("session_expired", "This table is already closed. Open it again.");
  if (input.managerApprovedOfflineRequestId) {
    if (!staff.roles.some((role) => role === "manager" || role === "owner") || input.managerApprovedOfflineRequestId !== input.clientRequestId) throw new AppError("forbidden", "A manager must approve this saved order before it can be replayed.");
    const [approval] = await db.select({ after: s.auditLog.after }).from(s.auditLog)
      .where(and(eq(s.auditLog.tenantId, staff.tenantId), eq(s.auditLog.outletId, staff.outletId), eq(s.auditLog.action, "pos.offline_order_approved"), eq(s.auditLog.entityId, input.clientRequestId)))
      .orderBy(desc(s.auditLog.createdAt), desc(s.auditLog.id)).limit(1);
    const details = approval?.after as { approvedByUserId?: unknown; current?: { sessionId?: unknown; tableId?: unknown }; lines?: unknown; quote?: unknown; guestName?: unknown } | null | undefined;
    if (details?.approvedByUserId !== staff.userId || stableJson(details.lines) !== stableJson(input.lines) || stableJson(details.quote ?? {}) !== stableJson(input.quote ?? {})) throw new AppError("forbidden", "This manager approval does not match the saved order details. Ask the owner to review it again.");
    if (typeof details.current?.sessionId === "string" && details.current.sessionId !== input.sessionId) throw new AppError("forbidden", "This approval is for a different table visit.");
    if (typeof details.current?.tableId === "string" && details.current.tableId !== session.tableId) throw new AppError("forbidden", "This approval is for a different table.");
    if (details.guestName !== (input.guestName?.trim() || null)) throw new AppError("forbidden", "This approval is for different order details.");
  }
  const people = await db.select({ id: s.participants.id, name: s.participants.displayName }).from(s.participants)
    .where(and(eq(s.participants.tenantId, staff.tenantId), eq(s.participants.sessionId, sessionId), isNull(s.participants.removedAt), isNull(s.participants.paidOutAt)))
    .orderBy(asc(s.participants.joinedAt), asc(s.participants.id));
  let participantId = people.find((p) => !isPlaceholderName(p.name) && checkFirstName(p.name).ok)?.id;
  if (!participantId) {
    const typed = checkFirstName(String(input.guestName ?? ""));
    participantId = (await addPhonelessDiner(staff, sessionId, typed.ok ? typed.name : "Guest", now, posTerminalRoles)).id;
  }
  return addItemsAtBilling(staff, { sessionId, tableId: session.tableId, participantId, clientRequestId: String(input.clientRequestId), lines: input.lines, quote: input.quote }, now);
}
