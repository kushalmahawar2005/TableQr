import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, gte, or } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { checkFirstName } from "@/domain/guest-name";
import { OTP, normaliseCode } from "@/domain/otp";
import { isValidIndianMobile, normaliseIndianMobile, toE164 } from "@/domain/phone";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { limitByClient } from "../request-limit";
import { smsMockEnabled, smsSender } from "../sms/sender";
import { deliveryCheckout } from "./checkout";
import { deliveryOutlet } from "./catalog";

const later = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000);
const hash = (checkoutId: string, challengeId: string, code: string) => {
  const secret = process.env.OTP_SECRET || (process.env.NODE_ENV === "production" ? "" : "tableqr-local-otp-secret");
  if (!secret) throw new AppError("sms_failed", "Phone verification is temporarily unavailable.");
  return createHmac("sha256", secret).update(`delivery:${checkoutId}:${challengeId}:${code}`).digest("hex");
};
const active = (row: typeof s.deliveryCheckouts.$inferSelect, now: Date) => {
  if (row.status !== "draft" || row.expiresAt <= now) throw new AppError("expired", "This checkout has expired or was already placed.");
};

export async function sendDeliveryOtp(code: string, token: string, deviceId: string, phoneInput: string, now = new Date()) {
  await limitByClient("sms", 20);
  const { outlet, row } = await deliveryCheckout(code, token, deviceId, now);
  await deliveryOutlet(code, true, now, row.serviceMode);
  active(row, now);
  const digits = normaliseIndianMobile(phoneInput);
  if (!isValidIndianMobile(digits)) throw new AppError("invalid_phone", "Enter a valid Indian mobile number.");
  const phone = toE164("+91", digits), id = uuidv7(), otp = String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, "0"), codeHash = hash(row.id, id, otp);
  await db.transaction(async tx => {
    const [checkout] = await tx.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id))).for("update");
    active(checkout, now);
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, outlet.tenantId)).for("update");
    const identity = or(eq(s.deliveryOtpChallenges.phone, phone), eq(s.deliveryOtpChallenges.deviceId, deviceId));
    const [locked] = await tx.select({ id: s.deliveryOtpChallenges.id }).from(s.deliveryOtpChallenges).where(and(eq(s.deliveryOtpChallenges.tenantId, outlet.tenantId), identity, gt(s.deliveryOtpChallenges.lockedUntil, now))).limit(1);
    if (locked) throw new AppError("locked", "Too many wrong codes. Wait one minute.");
    const [recent] = await tx.select({ id: s.deliveryOtpChallenges.id }).from(s.deliveryOtpChallenges).where(and(eq(s.deliveryOtpChallenges.tenantId, outlet.tenantId), identity, gt(s.deliveryOtpChallenges.resendAt, now))).limit(1);
    if (recent) throw new AppError("rate_limited", "Wait 30 seconds before requesting another code.");
    const [[phoneCount], [deviceCount]] = await Promise.all([
      tx.select({ n: count() }).from(s.deliveryOtpChallenges).where(and(eq(s.deliveryOtpChallenges.tenantId, outlet.tenantId), eq(s.deliveryOtpChallenges.phone, phone), gte(s.deliveryOtpChallenges.createdAt, later(now, -86400)))),
      tx.select({ n: count() }).from(s.deliveryOtpChallenges).where(and(eq(s.deliveryOtpChallenges.tenantId, outlet.tenantId), eq(s.deliveryOtpChallenges.deviceId, deviceId), gte(s.deliveryOtpChallenges.createdAt, later(now, -600)))),
    ]);
    if (Number(phoneCount.n) >= OTP.perPhonePerDay || Number(deviceCount.n) >= OTP.perDevicePer10Min) throw new AppError("rate_limited", "Too many codes requested. Try again later.");
    await tx.update(s.deliveryOtpChallenges).set({ deadAt: now }).where(and(eq(s.deliveryOtpChallenges.tenantId, outlet.tenantId), eq(s.deliveryOtpChallenges.checkoutId, row.id)));
    await tx.update(s.deliveryCheckouts).set({ guestId: null, verifiedAt: null, name: null, phone: null }).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    await tx.insert(s.deliveryOtpChallenges).values({ id, tenantId: outlet.tenantId, outletId: outlet.id, checkoutId: row.id, deviceId, phone, codeHash, expiresAt: later(now, OTP.validSeconds), resendAt: later(now, OTP.resendSeconds), createdAt: now });
  }, LOCK_THEN_READ);
  const sender = smsSender();
  const sent = await sender.sendOtp({ phone, code: otp, outletName: outlet.name }).catch(() => ({ ok: false }));
  if (!sent.ok) {
    await db.update(s.deliveryOtpChallenges).set({ deadAt: now }).where(and(eq(s.deliveryOtpChallenges.tenantId, outlet.tenantId), eq(s.deliveryOtpChallenges.id, id)));
    throw new AppError("sms_failed", "Could not send the code. Try again shortly.");
  }
  return { challengeId: id, phone, resendIn: OTP.resendSeconds, devCode: sender.name === "mock" && (process.env.NODE_ENV !== "production" || smsMockEnabled()) ? otp : undefined };
}

export async function verifyDeliveryOtp(code: string, token: string, deviceId: string, challengeId: string, otpInput: string, nameInput: string, now = new Date()) {
  const { outlet, row } = await deliveryCheckout(code, token, deviceId, now);
  const name = checkFirstName(nameInput);
  if (!name.ok) throw new AppError("invalid_name", "Enter your name using letters, up to 40 characters.");
  const result = await db.transaction(async tx => {
    const [checkout] = await tx.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id))).for("update");
    active(checkout, now);
    const [challenge] = await tx.select().from(s.deliveryOtpChallenges).where(and(eq(s.deliveryOtpChallenges.tenantId, outlet.tenantId), eq(s.deliveryOtpChallenges.checkoutId, row.id), eq(s.deliveryOtpChallenges.deviceId, deviceId), eq(s.deliveryOtpChallenges.id, challengeId))).for("update");
    if (!challenge || challenge.deadAt || challenge.verifiedAt || challenge.expiresAt <= now) throw new AppError("expired", "This code expired. Request a new one.");
    if (challenge.lockedUntil) throw new AppError(challenge.lockedUntil > now ? "locked" : "expired", "Request a new code after one minute.");
    const given = Buffer.from(hash(row.id, challenge.id, normaliseCode(otpInput)), "hex"), stored = Buffer.from(challenge.codeHash, "hex");
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
      const attempts = challenge.attempts + 1;
      await tx.update(s.deliveryOtpChallenges).set({ attempts, lockedUntil: attempts >= OTP.maxAttempts ? later(now, OTP.lockSeconds) : null }).where(and(eq(s.deliveryOtpChallenges.tenantId, outlet.tenantId), eq(s.deliveryOtpChallenges.id, challenge.id)));
      return { error: new AppError(attempts >= OTP.maxAttempts ? "locked" : "wrong", attempts >= OTP.maxAttempts ? "Too many wrong codes. Wait one minute." : "That code is not correct.") };
    }
    // Delivery does not opt a customer into marketing.
    await tx.insert(s.guests).values({ tenantId: outlet.tenantId, phone: challenge.phone, name: name.name, lastSeenAt: now }).onDuplicateKeyUpdate({ set: { name: name.name, lastSeenAt: now } });
    const [guest] = await tx.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.tenantId, outlet.tenantId), eq(s.guests.phone, challenge.phone)));
    await tx.update(s.deliveryOtpChallenges).set({ verifiedAt: now }).where(and(eq(s.deliveryOtpChallenges.tenantId, outlet.tenantId), eq(s.deliveryOtpChallenges.id, challenge.id)));
    await tx.update(s.deliveryCheckouts).set({ guestId: guest.id, verifiedAt: now, name: name.name, phone: challenge.phone }).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    return { error: null };
  }, LOCK_THEN_READ);
  if (result.error) throw result.error;
}
