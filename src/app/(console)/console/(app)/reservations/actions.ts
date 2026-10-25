"use server";
import { AppError } from "@/server/errors";
import { cancelReservation, checkInReservation, markNoShow, markReservationReminded, reassignReservation, seatReservation } from "@/server/floor/reservations";
import { rescheduleReservationStaff } from "@/server/booking/core";
import { staffRealtimeToken, topics } from "@/server/realtime/token";
import type { StaffSession } from "@/server/staff/auth";
import { staffFor } from "@/server/staff/request";
import { createCalendarReservation, editReservationDetails, getReservationCalendar, updateGroupRequestStatus, type CalendarInput, type ReservationDetailsPatch } from "@/server/staff/reservations";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import { confirmManualAdvance } from "@/server/booking/manual-advance";

// Reservation Calendar server actions. Staff, role and outlet always come from the httpOnly cookie;
// the client sends only ids and values, and every service checks the role again.

export type CalendarResult<T = null> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function run<T>(work: (staff: StaffSession) => Promise<T>): Promise<CalendarResult<T>> {
  try {
    return { ok: true, data: await work(await staffFor(consoleSectionRoles.reservations, "reservations")) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, message: err.message };
    console.error("[reservations] action failed", err);
    return { ok: false, code: "failed", message: "That didn't go through. Try again." };
  }
}
const done = async (work: Promise<unknown>) => {
  await work;
  return null;
};

export async function calendarAction(input: CalendarInput) {
  return run((s) => getReservationCalendar(s, input));
}

export async function editDetailsAction(id: string, patch: ReservationDetailsPatch) {
  return run((s) => done(editReservationDetails(s, id, patch)));
}

export async function reservationCreateAction(input: Parameters<typeof createCalendarReservation>[1]) {
  return run((s) => createCalendarReservation(s, input));
}

export async function reservationConfirmAdvanceAction(id: string, reference: string) {
  return run(s => confirmManualAdvance(s, id, reference));
}

export async function groupRequestStatusAction(id: string, status: "contacted" | "cancelled") {
  return run((s) => done(updateGroupRequestStatus(s, id, status)));
}

export async function reservationRescheduleAction(id: string, localDateTime: string, partySize?: number) {
  return run((s) => done(rescheduleReservationStaff(s, id, { localDateTime, partySize })));
}

export async function reservationArriveAction(id: string) {
  return run((s) => done(checkInReservation(s, id)));
}

export async function reservationSeatAction(id: string, tableIds?: string[]) {
  return run((s) => done(seatReservation(s, { reservationId: id, tableIds })));
}

export async function reservationReassignAction(id: string, tableIds: string[]) {
  return run((s) => done(reassignReservation(s, { reservationId: id, tableIds })));
}

export async function reservationNoShowAction(id: string) {
  return run((s) => done(markNoShow(s, id)));
}

export async function reservationRemindedAction(id: string) {
  return run((s) => done(markReservationReminded(s, id)));
}

export async function reservationCancelAction(id: string) {
  return run((s) => done(cancelReservation(s, id)));
}

export async function calendarTokenAction() {
  try {
    return staffRealtimeToken(await staffFor(consoleSectionRoles.reservations, "reservations"), [topics.floor]);
  } catch {
    return null;
  }
}
