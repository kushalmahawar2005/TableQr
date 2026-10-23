"use server";

import { cookies } from "next/headers";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { AppError } from "@/server/errors";
import { arriveBookingPublic, bookingByToken, bookingPreorderMenu, cancelBookingPublic, createBookingHold, createGroupRequest, getBookingAvailability, confirmBooking, lateBookingPublic, rescheduleBookingPublic, saveBookingPreorder } from "@/server/booking/core";
import { sendBookingOtp, verifyBookingOtp } from "@/server/booking/otp";
import { startReservationCredit } from "@/server/booking/credit";
import { claimManualAdvance } from "@/server/booking/manual-advance";
import { uuidv7 } from "@/db/id";

const device = async () => {
  const jar = await cookies();
  let id = jar.get(DEVICE_COOKIE)?.value;
  if (!id) { id = uuidv7(); jar.set(DEVICE_COOKIE, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 24 * 3600 }); }
  return id;
};
const fail = (e: unknown) => ({ ok: false as const, code: e instanceof AppError ? e.code : "failed", message: e instanceof AppError ? e.message : "That did not go through. Try again." });

export async function availabilityAction(outletCode: string, input: { date: string; partySize: number; seatingPreference?: string | null; tableClass?: string | null; zoneId?: string | null }) {
  try { return { ok: true as const, data: await getBookingAvailability(outletCode, { ...input, preference: { seatingPreference: input.seatingPreference, tableClass: input.tableClass, zoneId: input.zoneId } }) }; } catch (e) { return fail(e); }
}

export async function holdAction(outletCode: string, input: { date: string; startAt: number; partySize: number; requestId: string; holdToken: string; seatingPreference?: string | null; tableClass?: string | null; zoneId?: string | null }) {
  try { return { ok: true as const, data: await createBookingHold(outletCode, { ...input, preference: { seatingPreference: input.seatingPreference, tableClass: input.tableClass, zoneId: input.zoneId } }) }; } catch (e) { return fail(e); }
}

export async function bookingSummaryAction(outletCode: string, token: string) {
  try { const { row } = await bookingByToken(outletCode, token); return { ok: true as const, data: { reference: row.publicReference, name: row.name, phone: row.phone, partySize: row.partySize, startAt: row.startAt.getTime(), endAt: row.expectedEndAt.getTime(), status: row.status, holdExpiresAt: row.holdExpiresAt?.getTime() ?? null, seatingPreference: row.seatingPreference, creditRequiredPaise: row.creditRequiredPaise, creditPaidPaise: row.creditPaidPaise + row.advanceReceivedPaise, preorder: row.preorder ?? [], verified: !!row.guestId, paymentMode: row.advancePaymentMode, paymentQrUrl: row.advancePaymentQrUrl, manualReference: row.manualAdvanceReference, manualClaimedAt: row.manualAdvanceClaimedAt?.getTime() ?? null, manualConfirmedAt: row.manualAdvanceConfirmedAt?.getTime() ?? null } }; } catch (e) { return fail(e); }
}

export async function claimBookingAdvanceAction(outletCode: string, token: string, reference: string) {
  try { return { ok: true as const, data: await claimManualAdvance(outletCode, token, reference) }; } catch (error) { return fail(error); }
}

export async function bookingPreorderMenuAction(outletCode: string) {
  try { return { ok: true as const, data: await bookingPreorderMenu(outletCode) }; } catch (e) { return fail(e); }
}

export async function saveBookingPreorderAction(outletCode: string, token: string, lines: { itemId: string; qty: number }[]) {
  try { return { ok: true as const, data: await saveBookingPreorder(outletCode, token, lines) }; } catch (e) { return fail(e); }
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
