"use server";
import { AppError } from "@/server/errors";
import { getOnlineAvailability, setOnlineBookingsPaused, setSlotCapacity } from "@/server/floor/pacing";
import { getFloor, getTableDetail } from "@/server/floor/read";
import { getTableQr, type TableQr } from "@/server/floor/qr-read";
import { cancelReservation, checkInReservation, markNoShow, reassignReservation, seatReservation } from "@/server/floor/reservations";
import {
  blockTable,
  clearEmptyVisit,
  combineTables,
  extendTime,
  markNeedsCleaning,
  markReady,
  moveParty,
  seatWalkIn,
  swapTables,
  uncombineTable,
  unblockTable,
} from "@/server/floor/table-actions";
import { addToWaitlist, notifyWaitlist, removeFromWaitlist, reorderWaitlist, restoreWaitlist, seatWaitlist, skipWaitlist } from "@/server/floor/waitlist";
import { staffRealtimeToken, topics } from "@/server/realtime/token";
import type { StaffSession } from "@/server/staff/auth";
import { staffFor } from "@/server/staff/request";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import type { BlockReason } from "@/db/schema";

// S1 server actions. The staff member, role and outlet always come from the httpOnly cookie on
// the server; the client sends only ids and values. Never queued offline (the client refuses).

export type FloorResult = { ok: true } | { ok: false; code: string; message: string; details?: Record<string, unknown> };

const staff = () => staffFor(consoleSectionRoles.floor);

async function act(work: (s: StaffSession) => Promise<unknown>): Promise<FloorResult> {
  try {
    await work(await staff());
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) {
      const { latestEndAt, reason, startAt, name, until, allowedAt } = (err.details ?? {}) as Record<string, unknown>;
      return { ok: false, code: err.code, message: err.message, details: { latestEndAt, reason, startAt, name, until, allowedAt } };
    }
    console.error("[floor] action failed", err);
    return { ok: false, code: "failed", message: "That didn't go through. Try again." };
  }
}

export async function floorDataAction() {
  try {
    return { ok: true as const, data: await getFloor(await staff()) };
  } catch (err) {
    return { ok: false as const, code: err instanceof AppError ? err.code : "failed" };
  }
}

export async function tableDetailAction(tableId: string) {
  try {
    return { ok: true as const, detail: await getTableDetail(await staff(), String(tableId)) };
  } catch (err) {
    return { ok: false as const, code: err instanceof AppError ? err.code : "failed" };
  }
}

export async function floorTokenAction() {
  try {
    const s = await staff();
    return staffRealtimeToken(s, [topics.floor, topics.tasks]);
  } catch {
    return null;
  }
}

export const seatWalkInAction = async (tableId: string, partySize: number, guestName: string | null, endBy: number | null) =>
  act((s) => seatWalkIn(s, { tableId, partySize: Number(partySize), guestName, endBy }));
export const needsCleaningAction = async (tableId: string) => act((s) => markNeedsCleaning(s, String(tableId)));
export const readyAction = async (tableId: string) => act((s) => markReady(s, String(tableId)));
export const clearEmptyAction = async (tableId: string) => act((s) => clearEmptyVisit(s, String(tableId)));
export const blockAction = async (tableId: string, reason: BlockReason, note: string | null, until: number | null) =>
  act((s) => blockTable(s, { tableId: String(tableId), reason, note, until }));
export const unblockAction = async (tableId: string) => act((s) => unblockTable(s, String(tableId)));
export const moveAction = async (fromTableId: string, toTableId: string) => act((s) => moveParty(s, { fromTableId: String(fromTableId), toTableId: String(toTableId) }));
export const swapAction = async (tableId: string, otherTableId: string) => act((s) => swapTables(s, { tableId: String(tableId), otherTableId: String(otherTableId) }));
export const combineAction = async (tableId: string, addTableId: string) => act((s) => combineTables(s, { tableId: String(tableId), addTableId: String(addTableId) }));
export const uncombineAction = async (tableId: string) => act((s) => uncombineTable(s, String(tableId)));
export const extendAction = async (tableId: string) => act((s) => extendTime(s, { tableId: String(tableId) }));

export const checkInAction = async (id: string) => act((s) => checkInReservation(s, String(id)));
export const noShowAction = async (id: string) => act((s) => markNoShow(s, String(id)));
export const cancelBookingAction = async (id: string) => act((s) => cancelReservation(s, String(id)));
export const reassignAction = async (id: string, tableIds: string[]) => act((s) => reassignReservation(s, { reservationId: String(id), tableIds: (tableIds ?? []).map(String) }));
export const seatBookingAction = async (id: string, tableIds: string[] | null) =>
  act((s) => seatReservation(s, { reservationId: String(id), tableIds: tableIds?.map(String) }));

export const addWaitlistAction = async (input: { name: string; phone: string; partySize: number; quotedMinutes: number | null; notes: string }) =>
  act((s) => addToWaitlist(s, { name: String(input.name), phone: String(input.phone ?? ""), partySize: Number(input.partySize), quotedMinutes: input.quotedMinutes, notes: String(input.notes ?? "") }));
export const notifyAction = async (id: string) => act((s) => notifyWaitlist(s, String(id)));
export const skipAction = async (id: string) => act((s) => skipWaitlist(s, String(id)));
export const leftAction = async (id: string) => act((s) => removeFromWaitlist(s, String(id)));
export const restoreWaitlistAction = async (id: string) => act((s) => restoreWaitlist(s, String(id)));
export const reorderAction = async (id: string, toIndex: number) => act((s) => reorderWaitlist(s, { entryId: String(id), toIndex: Number(toIndex) }));
export const seatWaitlistAction = async (id: string, tableIds: string[]) => act((s) => seatWaitlist(s, { entryId: String(id), tableIds: (tableIds ?? []).map(String) }));

export const pauseAction = async (paused: boolean) => act((s) => setOnlineBookingsPaused(s, { paused: paused === true }));
export const capacityAction = async (slotStartAt: number, extraCovers: number) => act((s) => setSlotCapacity(s, { slotStartAt: Number(slotStartAt), extraCovers: Number(extraCovers) }));

/** For the future booking page: kept here only so the build checks the call shape */
export type OnlineAvailability = Awaited<ReturnType<typeof getOnlineAvailability>>;

export async function setStaffLangAction(lang: "en" | "hi") {
  const { cookies } = await import("next/headers");
  (await cookies()).set("tq_lang", lang === "hi" ? "hi" : "en", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
}

/** The table's live QR for showing, printing or downloading. Same roles as the floor. */
export async function tableQrAction(tableId: string): Promise<{ ok: true; qr: TableQr } | { ok: false; message: string }> {
  try {
    const st = await staff();
    return { ok: true, qr: await getTableQr(st, String(tableId)) };
  } catch (err) {
    return { ok: false, message: err instanceof AppError ? err.message : "The QR could not be loaded." };
  }
}
