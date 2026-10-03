"use server";
import { AppError } from "@/server/errors";
import { getReservationCalendar, editReservationDetails } from "@/server/staff/reservations";
import { cancelReservation, checkInReservation, markNoShow, reassignReservation, seatReservation, createReservation } from "@/server/floor/reservations";
import { rescheduleReservationStaff } from "@/server/booking/core";
import { staffFor } from "@/server/staff/request";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import { staffRealtimeToken, topics } from "@/server/realtime/token";
async function run<T>(work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) { try { return { ok: true as const, data: await work(await staffFor(consoleSectionRoles.reservations)) }; } catch (e) { return { ok: false as const, message: e instanceof AppError ? e.message : "Could not complete this reservation action.", code: e instanceof AppError ? e.code : "failed" }; } }
export async function calendarAction(input: Parameters<typeof getReservationCalendar>[1]) { return run((s) => getReservationCalendar(s, input)); }
export async function editDetailsAction(id: string, input: Parameters<typeof editReservationDetails>[2]) { return run((s) => editReservationDetails(s, id, input)); }
export async function reservationCancelAction(id: string) { return run((s) => cancelReservation(s, id)); }
export async function reservationArriveAction(id: string) { return run((s) => checkInReservation(s, id)); }
export async function reservationNoShowAction(id: string) { return run((s) => markNoShow(s, id)); }
export async function reservationSeatAction(id: string, tableIds?: string[]) { return run((s) => seatReservation(s, { reservationId: id, tableIds })); }
export async function reservationReassignAction(id: string, tableIds: string[]) { return run((s) => reassignReservation(s, { reservationId: id, tableIds })); }
export async function reservationCreateAction(input: Parameters<typeof createReservation>[1]) { return run((s) => createReservation(s, input)); }
export async function reservationRescheduleAction(id: string, localDateTime: string, partySize?: number) { return run((s) => rescheduleReservationStaff(s, id, { localDateTime, partySize })); }
export async function calendarTokenAction() { try { const s = await staffFor(consoleSectionRoles.reservations); return staffRealtimeToken(s, [topics.floor]); } catch { return null; } }
