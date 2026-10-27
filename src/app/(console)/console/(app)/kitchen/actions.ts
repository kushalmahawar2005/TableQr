"use server";

import { AppError } from "@/server/errors";
import { consoleKitchen, kdsAccept, kdsCancelLine, kdsBoard, kdsOlder, kdsBumpLine, kdsBumpTicket, kdsRealtimeToken, kdsRecall, kdsSearch, kdsStart, kdsStock } from "@/server/kitchen/kds";
import { kdsWorkRoles } from "@/lib/staff-permissions";
import { staffFor } from "@/server/staff/request";
import { changeWaiterLine } from "@/server/staff/waiter-mutations";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { KdsResult } from "@/app/(staff)/kds/actions";

// The kitchen board inside the console: the same board and rules as the wall screen, acting as the
// signed-in staff member (kitchen, manager or owner) instead of a device.

const kitchen = async () => consoleKitchen(await staffFor(kdsWorkRoles, "kitchen"));

async function run<T>(work: () => Promise<T>): Promise<KdsResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, message: err.message, reason: (err.details?.reason as string | undefined) ?? undefined };
    console.error("[console kitchen] action failed", err);
    return { ok: false, code: "failed", message: "That didn't go through. Try again." };
  }
}

export async function boardAction(station: string | null) {
  return run(async () => kdsBoard(await kitchen(), station ? String(station) : null));
}
export async function olderAction(station: string | null, offset: number, limit: number) {
  return run(async () => kdsOlder(await kitchen(), station ? String(station) : null, Number(offset) || 0, Number(limit) || 12));
}
export async function tokenAction() {
  try {
    return kdsRealtimeToken(await kitchen());
  } catch {
    return null;
  }
}
export const acceptAction = async (ticketId: string) => run(async () => kdsAccept(await kitchen(), ticketId));
export const startAction = async (ticketId: string) => run(async () => kdsStart(await kitchen(), ticketId));
export const bumpTicketAction = async (ticketId: string) => run(async () => kdsBumpTicket(await kitchen(), ticketId));
export const bumpLineAction = async (lineId: string) => run(async () => kdsBumpLine(await kitchen(), lineId));
export const recallAction = async (ticketId: string) => run(async () => kdsRecall(await kitchen(), ticketId));
export const stockAction = async (itemId: string, outOfStock: boolean) =>
  run(async () => {
    const res = await kdsStock(await kitchen(), itemId, outOfStock === true);
    return { cartsAffected: res.cartsAffected };
  });
export const searchAction = async (q: string) => run(async () => kdsSearch(await kitchen(), String(q ?? "")));

/** Cancel one item: a signed-in manager or owner does it directly; anyone else needs a manager's PIN */
export const cancelLineAction = async (lineId: string, reason: string, phone: string, pin: string) => run(async () => {
  const staff = await staffFor(kdsWorkRoles, "kitchen");
  if (staff.roles.some((r) => r === "manager" || r === "owner")) {
    const why = String(reason ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
    if (why.length < 3) throw new AppError("invalid_state", "Choose or write why it is cancelled.");
    const [line] = await db.select({ sessionId: s.orderLines.sessionId }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, staff.tenantId), eq(s.orderLines.id, String(lineId))));
    if (!line) throw new AppError("not_found", "This item was not found.");
    return changeWaiterLine(staff, { sessionId: line.sessionId, lineId: String(lineId), reason: `Kitchen: ${why}` }, new Date(), ["manager", "owner"]);
  }
  return kdsCancelLine(await kitchen(), { lineId, reason, phone, pin });
});
