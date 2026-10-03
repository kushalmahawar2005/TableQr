import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, eq, gte, or } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { OTP, normaliseCode } from "@/domain/otp";
import { isValidIndianMobile, normaliseIndianMobile, toE164 } from "@/domain/phone";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { smsSender } from "../sms/sender";
import { bookingByToken } from "./core";

const secret = () => process.env.OTP_SECRET || (process.env.NODE_ENV === "production" ? "" : "tableqr-local-otp-secret");
const hashCode = (challengeId: string, code: string) => createHmac("sha256", secret()).update(`${challengeId}:${code}`).digest("hex");
const equal = (a: string, b: string) => { const x = Buffer.from(a, "hex"); const y = Buffer.from(b, "hex"); return x.length === y.length && timingSafeEqual(x, y); };
const later = (d: Date, seconds: number) => new Date(d.getTime() + seconds * 1000);

export async function sendBookingOtp(outletCode: string, token: string, deviceId: string, phoneInput: string, now = new Date()) {
  const { row, scope } = await bookingByToken(outletCode, token);
  const digits = normaliseIndianMobile(phoneInput);
  if (!isValidIndianMobile(digits)) throw new AppError("invalid_phone", "Enter a valid Indian mobile number.");
  const phone = toE164("+91", digits);
  const [table] = await db.select({ tableId: s.reservationTables.tableId }).from(s.reservationTables).where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, row.id))).limit(1);
  if (!table) throw new AppError("not_found", "This booking has no table hold.");
  const since = new Date(now.getTime() - 10 * 60_000);
  const [{ n }] = await db.select({ n: count() }).from(s.otpChallenges).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), or(eq(s.otpChallenges.phone, phone), eq(s.otpChallenges.deviceId, deviceId)), gte(s.otpChallenges.createdAt, since)));
  if (Number(n) >= OTP.perDevicePer10Min + OTP.perPhonePerDay) throw new AppError("rate_limited", "Too many codes. Try again shortly.");
  const id = uuidv7();
  const code = String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, "0");
  await db.insert(s.otpChallenges).values({ id, tenantId: scope.tenantId, outletId: scope.outletId, tableId: table.tableId, deviceId, phone, codeHash: hashCode(id, code), expiresAt: later(now, OTP.validSeconds), resendAt: later(now, OTP.resendSeconds), createdAt: now });
  const sent = await smsSender().sendOtp({ phone, code, outletName: scope.name });
  if (!sent.ok) { await db.update(s.otpChallenges).set({ deadAt: now }).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.id, id))); throw new AppError("sms_failed", "We could not send a code."); }
  return { challengeId: id, phone, expiresIn: OTP.validSeconds, devCode: smsSender().name === "mock" && process.env.NODE_ENV !== "production" ? code : undefined };
}

export async function verifyBookingOtp(outletCode: string, token: string, deviceId: string, challengeId: string, codeInput: string, name: string, marketingConsent = false, now = new Date()) {
  const { row, scope } = await bookingByToken(outletCode, token);
  const [table] = await db.select({ tableId: s.reservationTables.tableId }).from(s.reservationTables).where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, row.id))).limit(1);
  if (!table) throw new AppError("not_found", "This booking has no table hold.");
  return db.transaction(async (tx) => {
    const [ch] = await tx.select().from(s.otpChallenges).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.id, challengeId), eq(s.otpChallenges.deviceId, deviceId), eq(s.otpChallenges.tableId, table.tableId))).for("update");
    if (!ch || ch.deadAt || ch.verifiedAt || ch.expiresAt <= now) throw new AppError("expired", "This code has expired.");
    const given = normaliseCode(codeInput);
    if (given.length !== OTP.length || !equal(hashCode(ch.id, given), ch.codeHash)) {
      const attempts = ch.attempts + 1;
      await tx.update(s.otpChallenges).set({ attempts, lockedUntil: attempts >= OTP.maxAttempts ? later(now, OTP.lockSeconds) : null }).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.id, ch.id)));
      throw new AppError(attempts >= OTP.maxAttempts ? "locked" : "wrong", attempts >= OTP.maxAttempts ? "Too many wrong codes." : "That code is not right.");
    }
    const cleanName = name.trim().slice(0, 80);
    if (!cleanName) throw new AppError("invalid_name", "Enter your name.");
    await tx.insert(s.guests).values({ tenantId: scope.tenantId, phone: ch.phone, name: cleanName, consentMarketing: marketingConsent, consentPersonalisation: false, consentVersion: "booking-v1", consentAt: marketingConsent ? now : null, lastSeenAt: now }).onDuplicateKeyUpdate({ set: { name: cleanName, consentMarketing: marketingConsent, consentVersion: "booking-v1", consentAt: marketingConsent ? now : null, lastSeenAt: now } });
    const [guest] = await tx.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.tenantId, scope.tenantId), eq(s.guests.phone, ch.phone)));
    await tx.update(s.otpChallenges).set({ verifiedAt: now, guestId: guest.id }).where(and(eq(s.otpChallenges.tenantId, scope.tenantId), eq(s.otpChallenges.id, ch.id)));
    await tx.update(s.reservations).set({ guestId: guest.id, name: cleanName, phone: ch.phone, updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    return { guestId: guest.id, phone: ch.phone };
  }, LOCK_THEN_READ);
}
