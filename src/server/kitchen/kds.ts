import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { staffRealtimeToken, topics } from "../realtime/token";
import { verifyStaffPin, type StaffSession } from "../staff/auth";
import { changeWaiterLine } from "../staff/waiter-mutations";
import type { StaffContext } from "../staff/context";
import { acceptTicket, bumpLine, bumpTicket, recallTicket, setOutOfStock, startTicket } from "./actions";
import { kitchenStations, type KdsDevice } from "./device";
import { averageTicketMinutes, getKitchenDisplay, getOlderPendingTickets, getUnavailableItems, searchKitchenItems } from "./display";

// Everything a kitchen screen may do, decided from its device row on the server. The client never
// says which station or role it is: a station screen sees and changes only its own station; the
// All view and other stations need a screen a manager pinned as expeditor.

/** Acting context for audit and scoping: no signed-in user, the screen is the actor */
export function kdsActor(device: KdsDevice): StaffContext {
  if (device.staff) return { tenantId: device.tenantId, outletId: device.outletId, userId: device.staff.userId, actorLabel: `staff:${device.staff.name}` };
  return {
    tenantId: device.tenantId,
    outletId: device.outletId,
    userId: null,
    actorLabel: `kds:${device.expeditor ? "expeditor" : device.station}:${device.deviceId.slice(-8)}`,
  };
}

/**
 * The kitchen board inside the console, for every plan: the signed-in staff member sees all
 * stations (like an expeditor screen) and every change is recorded against them.
 */
export async function consoleKitchen(staff: StaffSession): Promise<KdsDevice> {
  const [outlet] = await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  if (!outlet) throw new AppError("not_found", "Outlet not found.");
  return {
    tenantId: staff.tenantId,
    outletId: staff.outletId,
    deviceId: `console:${staff.sessionId}`,
    station: null,
    expeditor: true,
    lang: "en",
    outlet: { code: staff.outlet.code, name: staff.outlet.name, timezone: staff.outlet.timezone, brandId: outlet.brandId },
    expiresAt: staff.expiresAt,
    staff: { userId: staff.userId, name: staff.name },
  };
}

/** Which station this request may look at: its own pin, or any (null = All) for an expeditor */
export function viewStation(device: KdsDevice, requested: string | null | undefined): string | null {
  if (!device.expeditor) {
    if (!device.station) throw new AppError("forbidden", "This screen has no station. Ask a manager to set it up.");
    if (requested && requested !== device.station) throw new AppError("forbidden", "This screen shows its own station only.", { reason: "station" });
    return device.station;
  }
  return requested ? String(requested).slice(0, 30) : null;
}

/** The ticket must belong to this outlet and, on a station screen, to its station */
async function guardTicket(device: KdsDevice, ticketId: string) {
  const [ticket] = await db
    .select({ station: s.tickets.station })
    .from(s.tickets)
    .where(and(eq(s.tickets.tenantId, device.tenantId), eq(s.tickets.outletId, device.outletId), eq(s.tickets.id, String(ticketId))));
  if (!ticket) throw new AppError("not_found", "This ticket no longer exists.");
  if (!device.expeditor && ticket.station !== device.station) {
    throw new AppError("forbidden", `This ticket belongs to ${ticket.station}.`, { reason: "station" });
  }
}

export async function kdsBoard(device: KdsDevice, requested: string | null | undefined, now = new Date()) {
  const station = viewStation(device, requested);
  const ctx = kdsActor(device);
  const [display, stations, unavailable, avgMinutes] = await Promise.all([
    getKitchenDisplay(ctx, { station }, now),
    kitchenStations(device),
    getUnavailableItems(ctx, now),
    averageTicketMinutes({ ...ctx, timezone: device.outlet.timezone }, now),
  ]);
  return {
    station,
    stations,
    counts: display.counts,
    /** Open tickets older than a day: not drawn, but the board says so */
    staleOpen: display.staleOpen,
    cards: display.cards,
    lastBumped: display.lastBumped,
    unavailable: unavailable.map((u) => ({ ...u, until: u.until?.getTime() ?? null })),
    avgMinutes,
    renderedAt: now.getTime(),
  };
}

export type KdsBoard = Awaited<ReturnType<typeof kdsBoard>>;

/** One page of "Older pending tickets" for this screen's station (or every station on the expeditor screen) */
export async function kdsOlder(device: KdsDevice, requested: string | null | undefined, offset: number, limit: number, now = new Date()) {
  const station = viewStation(device, requested);
  return getOlderPendingTickets(kdsActor(device), { station, offset, limit }, now);
}

export async function kdsAccept(device: KdsDevice, ticketId: string, now = new Date()) {
  await guardTicket(device, ticketId);
  return acceptTicket(kdsActor(device), String(ticketId), now);
}

export async function kdsStart(device: KdsDevice, ticketId: string, now = new Date()) {
  await guardTicket(device, ticketId);
  return startTicket(kdsActor(device), String(ticketId), now);
}

export async function kdsBumpTicket(device: KdsDevice, ticketId: string, now = new Date()) {
  await guardTicket(device, ticketId);
  return bumpTicket(kdsActor(device), String(ticketId), now);
}

export async function kdsRecall(device: KdsDevice, ticketId: string, now = new Date()) {
  await guardTicket(device, ticketId);
  return recallTicket(kdsActor(device), String(ticketId), now);
}

/** A station screen can only bump its own lines; bumpLine re-checks inside the transaction */
export async function kdsBumpLine(device: KdsDevice, lineId: string, now = new Date()) {
  return bumpLine(kdsActor(device), String(lineId), now, { station: device.expeditor ? null : device.station });
}

export async function kdsStock(device: KdsDevice, itemId: string, outOfStock: boolean, now = new Date()) {
  return setOutOfStock(kdsActor(device), String(itemId), outOfStock === true, now);
}

export async function kdsSearch(device: KdsDevice, q: string) {
  return searchKitchenItems({ ...kdsActor(device), brandId: device.outlet.brandId }, q);
}

/** Realtime for a kitchen screen: kitchen tickets and menu availability only */
export function kdsRealtimeToken(device: KdsDevice) {
  return staffRealtimeToken({ tenantId: device.tenantId, outletId: device.outletId, userId: device.deviceId }, [topics.kitchen, topics.menu]);
}

/**
 * Cancel an item from the kitchen screen, even after it was accepted (guest left, wrong order, ran
 * out mid-cook). The screen is a shared device, so a manager or owner confirms with their PIN each
 * time; the reason goes on the void, the ticket and the bill update like any other void.
 */
export async function kdsCancelLine(device: KdsDevice, input: { lineId: string; reason: string; phone: string; pin: string }, now = new Date()) {
  const reason = String(input.reason ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (reason.length < 3) throw new AppError("invalid_state", "Choose or write why it is cancelled.");
  const who = await verifyStaffPin({ outletCode: device.outlet.code, phone: String(input.phone ?? ""), pin: String(input.pin ?? ""), now });
  if (who.scope.tenantId !== device.tenantId || who.scope.outletId !== device.outletId || !who.roles.some((r) => r === "manager" || r === "owner")) {
    throw new AppError("forbidden", "A manager or the owner of this outlet must approve a cancel.");
  }
  const [line] = await db.select({ sessionId: s.orderLines.sessionId }).from(s.orderLines)
    .innerJoin(s.orders, and(eq(s.orders.tenantId, s.orderLines.tenantId), eq(s.orders.id, s.orderLines.orderId)))
    .where(and(eq(s.orderLines.tenantId, device.tenantId), eq(s.orders.outletId, device.outletId), eq(s.orderLines.id, String(input.lineId))));
  if (!line) throw new AppError("not_found", "This item is not on this outlet's orders.");
  const approver: StaffSession = { tenantId: device.tenantId, outletId: device.outletId, userId: who.user.id, sessionId: "kds", name: who.user.name, roles: who.roles, outlet: { code: device.outlet.code, name: device.outlet.name, timezone: device.outlet.timezone }, expiresAt: now.getTime() + 60_000 };
  await changeWaiterLine(approver, { sessionId: line.sessionId, lineId: String(input.lineId), reason: `Kitchen: ${reason}` }, now, ["manager", "owner"]);
}
