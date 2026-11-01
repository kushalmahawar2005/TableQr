import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, gte, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { OTP, normaliseCode } from "@/domain/otp";
import { isValidIndianMobile, normaliseIndianMobile, toE164 } from "@/domain/phone";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { limitByClient } from "../request-limit";
import { smsMockEnabled, smsSender } from "../sms/sender";
import { bookingByToken } from "./core";

const secret = () => {
  const value = process.env.OTP_SECRET || (process.env.NODE_ENV === "production" ? "" : "tableqr-local-otp-secret");
  if (!value) throw new AppError("sms_failed", "Verification is temporarily unavailable. Please contact the restaurant.");
  return value;
};
// A code from another reservation cannot verify this hold, even on the same table and device.
const hashCode = (reservationId: string, challengeId: string, code: string) => createHmac("sha256", secret()).update(`${reservationId}:${challengeId}:${code}`).digest("hex");
const equal = (a: string, b: string) => { const x = Buffer.from(a, "hex"); const y = Buffer.from(b, "hex"); return x.length === y.length && timingSafeEqual(x, y); };
const later = (d: Date, seconds: number) => new Date(d.getTime() + seconds * 1000);

function activeHold(row: typeof s.reservations.$inferSelect, now: Date) {
  if (row.status !== "requested" || !row.holdExpiresAt || row.holdExpiresAt <= now || !row.manageTokenExpiresAt || row.manageTokenExpiresAt <= now) throw new AppError("expired", "Your table hold has expired. Please choose another time.");
}

export async function sendBookingOtp(outletCode: string, token: string, deviceId: string, phoneInput: string, now = new Date()) {
  await limitByClient("sms", 20);
  const { row, scope } = await bookingByToken(outletCode, token, now);
  activeHold(row, now);
  if (!deviceId || deviceId.length > 64) throw new AppError("invalid_state", "Please reopen the booking page and try again.");
  const digits = normaliseIndianMobile(phoneInput);
  if (!isValidIndianMobile(digits)) throw new AppError("invalid_phone", "Enter a valid Indian mobile number.");
  const phone = toE164("+91", digits);
  const [table] = await db.select({ tableId: s.reservationTables.tableId }).from(s.reservationTables).where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, row.id))).limit(1);
  if (!table) throw new AppError("not_found", "This booking has no table hold.");
  const id = uuidv7();
  const code = String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, "0");
  const codeHash = hashCode(row.id, id, code);
  await db.transaction(async (tx) => {
    const [held] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id))).for("update");
    if (!held) throw new AppError("not_found", "This booking link is not valid.");
    activeHold(held, now);
    // Serialize booking sends across this tenant so concurrent taps cannot pass the same quota.
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, scope.tenantId)).for("update");
    const identity = or(eq(s.otpChallenges.phone, phone), eq(s.otpChallenges.deviceId, deviceId));
    const [locked] = await tx.select({ id: s.otpChallenges.id }).from(s.otpChallenges).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), identity, gt(s.otpChallenges.lockedUntil, now))).limit(1);
    if (locked) throw new AppError("locked", "Too many wrong codes. Please wait a minute.");
    const [recent] = await tx.select({ id: s.otpChallenges.id }).from(s.otpChallenges).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), identity, isNull(s.otpChallenges.deadAt), gt(s.otpChallenges.resendAt, now))).limit(1);
    if (recent) throw new AppError("rate_limited", "Please wait 30 seconds before requesting another code.");
    const since = new Date(now.getTime() - 10 * 60_000);
    const [[phoneCount], [deviceCount], [tableCount]] = await Promise.all([
      tx.select({ n: count() }).from(s.otpChallenges).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.phone, phone), gte(s.otpChallenges.createdAt, new Date(now.getTime() - 24 * 3600_000)))),
      tx.select({ n: count() }).from(s.otpChallenges).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.deviceId, deviceId), gte(s.otpChallenges.createdAt, since))),
      tx.select({ n: count() }).from(s.otpChallenges).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.tableId, table.tableId), gte(s.otpChallenges.createdAt, since))),
    ]);
    if (Number(phoneCount.n) >= OTP.perPhonePerDay || Number(deviceCount.n) >= OTP.perDevicePer10Min || Number(tableCount.n) >= OTP.perTablePer10Min) throw new AppError("rate_limited", "Too many codes. Please try again later.");
    await tx.insert(s.otpChallenges).values({ id, tenantId: scope.tenantId, outletId: scope.outletId, tableId: table.tableId, deviceId, phone, codeHash, expiresAt: later(now, OTP.validSeconds), resendAt: later(now, OTP.resendSeconds), createdAt: now });
  }, LOCK_THEN_READ);
  const sent = await smsSender().sendOtp({ phone, code, outletName: scope.name });
  if (!sent.ok) { await db.update(s.otpChallenges).set({ deadAt: now }).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.id, id))); throw new AppError("sms_failed", "We could not send a code."); }
  return { challengeId: id, phone, expiresIn: OTP.validSeconds, devCode: smsSender().name === "mock" && (process.env.NODE_ENV !== "production" || smsMockEnabled()) ? code : undefined };
}

export async function verifyBookingOtp(outletCode: string, token: string, deviceId: string, challengeId: string, codeInput: string, name: string, marketingConsent = false, now = new Date()) {
  const { row, scope } = await bookingByToken(outletCode, token, now);
  activeHold(row, now);
  const [table] = await db.select({ tableId: s.reservationTables.tableId }).from(s.reservationTables).where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, row.id))).limit(1);
  if (!table) throw new AppError("not_found", "This booking has no table hold.");
  const result = await db.transaction(async (tx) => {
    const [held] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id))).for("update");
    if (!held) throw new AppError("not_found", "This booking link is not valid.");
    activeHold(held, now);
    const [ch] = await tx.select().from(s.otpChallenges).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.id, challengeId), eq(s.otpChallenges.deviceId, deviceId), eq(s.otpChallenges.tableId, table.tableId))).for("update");
    if (!ch || ch.deadAt || ch.verifiedAt || ch.expiresAt <= now) throw new AppError("expired", "This code has expired.");
    if (ch.lockedUntil) throw new AppError(ch.lockedUntil > now ? "locked" : "expired", "Please wait a minute, then request a fresh code.");
    const given = normaliseCode(codeInput);
    if (given.length !== OTP.length || !equal(hashCode(row.id, ch.id, given), ch.codeHash)) {
      const attempts = ch.attempts + 1;
      await tx.update(s.otpChallenges).set({ attempts, lockedUntil: attempts >= OTP.maxAttempts ? later(now, OTP.lockSeconds) : null }).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.id, ch.id)));
      // Return the failure so the increment commits; throwing inside the transaction undoes it.
      return { ok: false as const, error: new AppError(attempts >= OTP.maxAttempts ? "locked" : "wrong", attempts >= OTP.maxAttempts ? "Too many wrong codes." : "That code is not right.") };
    }
    const cleanName = name.trim().slice(0, 80);
    if (!cleanName) throw new AppError("invalid_name", "Enter your name.");
    await tx.insert(s.guests).values({ tenantId: scope.tenantId, phone: ch.phone, name: cleanName, consentMarketing: marketingConsent, consentPersonalisation: false, consentVersion: "booking-v1", consentAt: marketingConsent ? now : null, lastSeenAt: now }).onDuplicateKeyUpdate({ set: { name: cleanName, consentMarketing: marketingConsent, consentVersion: "booking-v1", consentAt: marketingConsent ? now : null, lastSeenAt: now } });
    const [guest] = await tx.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.tenantId, scope.tenantId), eq(s.guests.phone, ch.phone)));
    await tx.update(s.otpChallenges).set({ verifiedAt: now, guestId: guest.id }).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.id, ch.id)));
    await tx.update(s.reservations).set({ guestId: guest.id, name: cleanName, phone: ch.phone, bookingDeviceId: deviceId, updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    return { ok: true as const, guestId: guest.id, phone: ch.phone };
  }, LOCK_THEN_READ);
  if (!result.ok) throw result.error;
  return { guestId: result.guestId, phone: result.phone };
}
