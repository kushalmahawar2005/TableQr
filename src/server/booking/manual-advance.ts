import "server-only";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import type { StaffSession } from "../staff/auth";
import { audit } from "../staff/audit";
import { publish } from "../realtime/publish";
import { sendOutletPush } from "../staff/web-push";
import { topics } from "../realtime/token";
import { bookingByToken } from "./core";
import { queueReservationConfirmation } from "./notifications";

/** A guest reports a transfer; it never increases paid or received balances. */
export async function claimManualAdvance(outletCode: string, token: string, reference: string, now = new Date()) {
  const { row, scope } = await bookingByToken(outletCode, token, now);
  const cleanReference = String(reference).trim().toUpperCase();
  if (!/^[A-Za-z0-9-]{6,40}$/.test(cleanReference)) throw new AppError("invalid_state", "Enter the transaction reference from your payment app (6–40 letters or numbers).");
  const result = await db.transaction(async tx => {
    const [held] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), eq(s.reservations.id, row.id))).for("update");
    if (!held) throw new AppError("not_found", "Booking not found.");
    if (held.manualAdvanceClaimedAt) {
      if (held.manualAdvanceReference !== cleanReference) {
        if (held.manualAdvanceConfirmedAt || held.status !== "requested" || !held.holdExpiresAt || held.holdExpiresAt <= now) throw new AppError("invalid_state", "This reference can no longer be changed. Please contact the restaurant.");
        await tx.update(s.reservations).set({ manualAdvanceReference: cleanReference, updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
      }
      return { holdExpiresAt: held.holdExpiresAt?.getTime() ?? null };
    }
    if (held.advancePaymentMode !== "manual_qr" || !held.advancePaymentQrUrl) throw new AppError("invalid_state", "This booking uses online checkout.");
    if (!held.guestId || !held.phone) throw new AppError("verification_required", "Verify your mobile number before submitting a payment reference.");
    if (held.status !== "requested" || !held.holdExpiresAt || held.holdExpiresAt <= now) throw new AppError("expired", "Your table hold has expired. Contact the restaurant before paying.");
    if (held.creditRequiredPaise <= held.creditPaidPaise + held.advanceReceivedPaise) throw new AppError("invalid_state", "No advance is due.");
    const holdExpiresAt = new Date(now.getTime() + 15 * 60_000);
    await tx.update(s.reservations).set({ manualAdvanceReference: cleanReference, manualAdvanceClaimedAt: now, holdExpiresAt, creditStatus: "pending", updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    return { holdExpiresAt: holdExpiresAt.getTime() };
  }, LOCK_THEN_READ);
  if (!row.manualAdvanceClaimedAt) void sendOutletPush(scope, { title: "Booking advance needs checking", body: "A guest submitted an advance payment reference. Verify it to confirm the booking.", url: "/console/reservations", tag: `advance-${row.id}` }, { kind: "management" });
  await publish(scope, [{ topic: topics.floor, type: "reservation.updated", data: { reservationId: row.id } }]);
  return result;
}

/** Receipt is trusted only after an authorized staff member checks their bank/payment app. */
export async function confirmManualAdvance(staff: StaffSession, reservationId: string, reference: string, now = new Date()) {
  if (!staff.roles.some(role => role === "owner" || role === "manager")) throw new AppError("forbidden", "Only an owner or manager can confirm advance payments.");
  const result = await db.transaction(async tx => {
    const [row] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, staff.tenantId), eq(s.reservations.outletId, staff.outletId), eq(s.reservations.id, String(reservationId)))).for("update");
    if (!row) throw new AppError("not_found", "Booking not found.");
    if (row.manualAdvanceConfirmedAt) return { row, confirmed: row.status === "confirmed" };
    if (row.advancePaymentMode !== "manual_qr" || !row.manualAdvanceClaimedAt || row.manualAdvanceReference !== reference) throw new AppError("conflict", "The payment reference changed. Refresh this booking before confirming receipt.");
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, staff.tenantId)).for("update");
    const [used] = await tx.select({ id: s.reservations.id }).from(s.reservations).where(and(eq(s.reservations.tenantId, staff.tenantId), ne(s.reservations.id, row.id), eq(s.reservations.manualAdvanceReference, reference), isNotNull(s.reservations.manualAdvanceConfirmedAt))).limit(1);
    if (used) throw new AppError("conflict", "This transaction reference was already recorded for another booking. Check the bank record before continuing.");
    const received = Math.max(0, row.creditRequiredPaise - row.creditPaidPaise - row.advanceReceivedPaise);
    if (!received) throw new AppError("invalid_state", "No advance is outstanding.");
    const confirmed = row.status === "requested" && !!row.holdExpiresAt && row.holdExpiresAt > now && !!row.guestId && !!row.phone;
    const next = { advanceReceivedPaise: row.advanceReceivedPaise + received, manualAdvanceConfirmedAt: now, creditStatus: "paid" as const, updatedAt: now, ...(confirmed ? { status: "confirmed" as const, confirmedAt: now, holdExpiresAt: null } : {}) };
    await tx.update(s.reservations).set(next).where(and(eq(s.reservations.tenantId, staff.tenantId), eq(s.reservations.id, row.id)));
    if (confirmed) await tx.insert(s.reservationHistory).values({ tenantId: staff.tenantId, reservationId: row.id, kind: "confirmed", actorUserId: staff.userId, before: { status: row.status }, after: { status: "confirmed", payment: "manual_qr" }, createdAt: now });
    await audit(tx, staff, { action: "reservation.manual_advance_received", entity: "reservation", entityId: row.id, before: { advanceReceivedPaise: row.advanceReceivedPaise }, after: { advanceReceivedPaise: next.advanceReceivedPaise, reference: row.manualAdvanceReference, bookingConfirmed: confirmed }, now });
    return { row: { ...row, ...next }, confirmed };
  }, LOCK_THEN_READ);
  await publish(staff, [{ topic: topics.floor, type: "reservation.updated", data: { reservationId } }, { topic: topics.floor, type: "booking.updated", data: { reservationId } }]);
  if (result.confirmed) await queueReservationConfirmation(staff, result.row, now);
  return { confirmed: result.confirmed, advanceReceivedPaise: result.row.advanceReceivedPaise };
}
