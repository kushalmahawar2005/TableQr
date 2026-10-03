"use server";

import { cookies } from "next/headers";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { AppError } from "@/server/errors";
import { arriveBookingPublic, bookingByToken, cancelBookingPublic, createBookingHold, createGroupRequest, getBookingAvailability, confirmBooking, lateBookingPublic, rescheduleBookingPublic } from "@/server/booking/core";
import { sendBookingOtp, verifyBookingOtp } from "@/server/booking/otp";
import { startReservationCredit } from "@/server/booking/credit";

const device = async () => (await cookies()).get(DEVICE_COOKIE)?.value ?? "booking-device";
const fail = (e: unknown) => ({ ok: false as const, code: e instanceof AppError ? e.code : "failed", message: e instanceof AppError ? e.message : "That did not go through. Try again." });

export async function availabilityAction(outletCode: string, input: { date: string; partySize: number; seatingPreference?: string | null; tableClass?: string | null; zoneId?: string | null }) {
  try { return { ok: true as const, data: await getBookingAvailability(outletCode, { ...input, preference: { seatingPreference: input.seatingPreference, tableClass: input.tableClass, zoneId: input.zoneId } }) }; } catch (e) { return fail(e); }
}

export async function holdAction(outletCode: string, input: { date: string; startAt: number; partySize: number; requestId: string; holdToken: string; seatingPreference?: string | null; tableClass?: string | null; zoneId?: string | null }) {
  try { return { ok: true as const, data: await createBookingHold(outletCode, { ...input, preference: { seatingPreference: input.seatingPreference, tableClass: input.tableClass, zoneId: input.zoneId } }) }; } catch (e) { return fail(e); }
}

export async function bookingSummaryAction(outletCode: string, token: string) {
  try { const { row } = await bookingByToken(outletCode, token); return { ok: true as const, data: { reference: row.publicReference, name: row.name, phone: row.phone, partySize: row.partySize, startAt: row.startAt.getTime(), endAt: row.expectedEndAt.getTime(), status: row.status, holdExpiresAt: row.holdExpiresAt?.getTime() ?? null, seatingPreference: row.seatingPreference, creditRequiredPaise: row.creditRequiredPaise, creditPaidPaise: row.creditPaidPaise } }; } catch (e) { return fail(e); }
}

export async function sendBookingOtpAction(outletCode: string, token: string, phone: string) {
  try { return { ok: true as const, data: await sendBookingOtp(outletCode, token, await device(), phone) }; } catch (e) { return fail(e); }
}

export async function verifyBookingOtpAction(outletCode: string, token: string, input: { challengeId: string; code: string; name: string; marketingConsent: boolean }) {
  try { return { ok: true as const, data: await verifyBookingOtp(outletCode, token, await device(), input.challengeId, input.code, input.name, input.marketingConsent) }; } catch (e) { return fail(e); }
}

export async function confirmBookingAction(outletCode: string, token: string, input: { name: string; phone: string; guestId?: string | null }) {
  try { return { ok: true as const, data: await confirmBooking(outletCode, token, input) }; } catch (e) { return fail(e); }
}

export async function cancelBookingAction(outletCode: string, token: string) {
  try { return { ok: true as const, data: await cancelBookingPublic(outletCode, token) }; } catch (e) { return fail(e); }
}

export async function lateBookingAction(outletCode: string, token: string) {
  try { return { ok: true as const, data: await lateBookingPublic(outletCode, token) }; } catch (e) { return fail(e); }
}

export async function rescheduleBookingAction(outletCode: string, token: string, input: { date: string; startAt: number }) {
  try { return { ok: true as const, data: await rescheduleBookingPublic(outletCode, token, input) }; } catch (e) { return fail(e); }
}

export async function arriveBookingAction(outletCode: string, token: string) {
  try { return { ok: true as const, data: await arriveBookingPublic(outletCode, token) }; } catch (e) { return fail(e); }
}

export async function groupRequestAction(outletCode: string, input: { requestId: string; name: string; phone: string; partySize: number; desiredDate: string; desiredStartAt: number; notes?: string }) {
  try { return { ok: true as const, data: await createGroupRequest(outletCode, input) }; } catch (e) { return fail(e); }
}

export async function startBookingCreditAction(outletCode: string, token: string, requestId: string, origin: string) {
  try { return { ok: true as const, data: await startReservationCredit(outletCode, token, requestId, `${origin}/api/booking-credit/return?provider=mock&p=PLACEHOLDER&to=${encodeURIComponent(`/r/${outletCode}/book/details?token=${token}`)}`) }; } catch (e) { return fail(e); }
}
