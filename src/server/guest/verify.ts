import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, gte, isNull, max, or } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { checkFirstName, placeholderName } from "@/domain/guest-name";
import { CONSENT_VERSION, isCompleteCode, normaliseCode, OTP } from "@/domain/otp";
import { countryByIso, isValidIndianMobile, normaliseIndianMobile, toE164 } from "@/domain/phone";
import { LOCK_THEN_READ, type Runner } from "../db-types";
import { AppError } from "../errors";
import { smsSender } from "../sms/sender";
import { assertCanSeat, findOpenSession, findTableByQr } from "./table";

// Verified mode (G2, PS 3.6): a guest confirms their mobile with a 4-digit SMS code before
// joining a table. Codes are per phone (device) and table, stored only as a keyed hash.

const SECOND = 1000;
const later = (now: Date, seconds: number) => new Date(now.getTime() + seconds * SECOND);
const secondsUntil = (at: Date, now: Date) => Math.max(1, Math.ceil((at.getTime() - now.getTime()) / SECOND));

function otpSecret(): string {
  const secret = process.env.OTP_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("OTP_SECRET is not set");
  return "tableqr-local-otp-secret";
}

/** The code bound to its challenge, so a hash from one challenge says nothing about another */
const hashCode = (challengeId: string, code: string) =>
  createHmac("sha256", otpSecret()).update(`${challengeId}:${code}`).digest("hex");

function codeMatches(challengeId: string, code: string, storedHash: string) {
  const given = Buffer.from(hashCode(challengeId, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

export type CodeSent = {
  challengeId: string;
  /** E.164 number the code went to */
  phone: string;
  expiresIn: number;
  resendIn: number;
  /** Development and tests only: the mock SMS code, so the flow can be tried without a phone */
  devCode?: string;
};

export type SendOutcome =
  | ({ ok: true } & CodeSent)
  | { ok: false; error: "invalid_phone" | "unsupported_country" | "rate_limited" | "sms_failed" }
  | { ok: false; error: "locked"; retryIn: number };

/**
 * Send code / Resend code / Send a new code. Asking again for the same number within 30 seconds
 * returns the code already on its way instead of sending another. Table problems (closed,
 * settling, not ready) throw the same AppErrors as Start ordering, so the guest goes back to G1.
 */
export async function sendCode(input: {
  outletCode: string;
  shortCode: string;
  deviceId: string;
  country: string;
  phone: string;
  now?: Date;
}): Promise<SendOutcome> {
  const now = input.now ?? new Date();
  const country = countryByIso(input.country);
  if (!country?.otp) return { ok: false, error: "unsupported_country" };
  const digits = normaliseIndianMobile(input.phone);
  if (!isValidIndianMobile(digits)) return { ok: false, error: "invalid_phone" };
  const phone = toE164(country.dial, digits);

  const t = await findTableByQr(db, input.outletCode, input.shortCode);
  if (t.outlet.sessionMode !== "verified") throw new AppError("invalid_state", "This table does not need a code.");
  const tenantId = t.outlet.tenantId;
  const tableId = t.table.id;
  assertCanSeat(t, t.table.state, await findOpenSession(db, tenantId, tableId), now);

  const sent = await db.transaction(async (tx) => {
    // One send at a time per table, so the limits below cannot be raced past
    await tx
      .select({ id: s.diningTables.id })
      .from(s.diningTables)
      .where(and(eq(s.diningTables.tenantId, tenantId), eq(s.diningTables.id, tableId)))
      .for("update");

    const [lock] = await tx
      .select({ until: max(s.otpChallenges.lockedUntil) })
      .from(s.otpChallenges)
      .where(
        and(
          eq(s.otpChallenges.tenantId, tenantId),
          or(eq(s.otpChallenges.phone, phone), eq(s.otpChallenges.deviceId, input.deviceId)),
          gt(s.otpChallenges.lockedUntil, now),
        ),
      );
    if (lock?.until) return { ok: false as const, error: "locked" as const, retryIn: secondsUntil(lock.until, now) };

    const [live] = await tx
      .select()
      .from(s.otpChallenges)
      .where(
        and(
          eq(s.otpChallenges.tenantId, tenantId),
          eq(s.otpChallenges.deviceId, input.deviceId),
          eq(s.otpChallenges.tableId, tableId),
          eq(s.otpChallenges.phone, phone),
          isNull(s.otpChallenges.verifiedAt),
          isNull(s.otpChallenges.deadAt),
          isNull(s.otpChallenges.lockedUntil),
          gt(s.otpChallenges.expiresAt, now),
        ),
      )
      .orderBy(desc(s.otpChallenges.createdAt))
      .limit(1);
    if (live && live.resendAt > now) {
      return {
        ok: true as const,
        challengeId: live.id,
        phone,
        expiresIn: secondsUntil(live.expiresAt, now),
        resendIn: secondsUntil(live.resendAt, now),
        code: null,
      };
    }

    const sentSince = async (column: "phone" | "deviceId" | "tableId", value: string, seconds: number) => {
      const [row] = await tx
        .select({ n: count() })
        .from(s.otpChallenges)
        .where(
          and(
            eq(s.otpChallenges.tenantId, tenantId),
            eq(s.otpChallenges[column], value),
            gte(s.otpChallenges.createdAt, later(now, -seconds)),
          ),
        );
      return row?.n ?? 0;
    };
    if (
      (await sentSince("phone", phone, 24 * 3600)) >= OTP.perPhonePerDay ||
      (await sentSince("deviceId", input.deviceId, 600)) >= OTP.perDevicePer10Min ||
      (await sentSince("tableId", tableId, 600)) >= OTP.perTablePer10Min
    ) {
      return { ok: false as const, error: "rate_limited" as const };
    }

    // A new code (or a changed number) kills any earlier code from this phone at this table
    await tx
      .update(s.otpChallenges)
      .set({ deadAt: now })
      .where(
        and(
          eq(s.otpChallenges.tenantId, tenantId),
          eq(s.otpChallenges.deviceId, input.deviceId),
          eq(s.otpChallenges.tableId, tableId),
          isNull(s.otpChallenges.verifiedAt),
          isNull(s.otpChallenges.deadAt),
        ),
      );

    const id = uuidv7();
    const code = String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, "0");
    await tx.insert(s.otpChallenges).values({
      id,
      tenantId,
      outletId: t.outlet.id,
      tableId,
      deviceId: input.deviceId,
      phone,
      codeHash: hashCode(id, code),
      expiresAt: later(now, OTP.validSeconds),
      resendAt: later(now, OTP.resendSeconds),
      createdAt: now,
    });
    return { ok: true as const, challengeId: id, phone, expiresIn: OTP.validSeconds, resendIn: OTP.resendSeconds, code };
  }, LOCK_THEN_READ);

  if (!sent.ok) return sent;
  const { code, ...view } = sent;
  if (code === null) return view;

  // Sent after commit, so a slow SMS provider never holds the table lock
  const sender = smsSender();
  const res = await sender.sendOtp({ phone, code, outletName: t.outlet.name }).catch(() => ({ ok: false }));
  if (!res.ok) {
    await db
      .update(s.otpChallenges)
      .set({ deadAt: new Date() })
      .where(and(eq(s.otpChallenges.tenantId, tenantId), eq(s.otpChallenges.id, view.challengeId)));
    return { ok: false, error: "sms_failed" };
  }
  return sender.name === "mock" && process.env.NODE_ENV !== "production" ? { ...view, devCode: code } : view;
}

export type VerifyOutcome =
  | { ok: true; guestId: string }
  | { ok: false; error: "invalid_name" | "expired" }
  | { ok: false; error: "wrong"; attemptsLeft: number }
  | { ok: false; error: "locked"; retryIn: number };

/**
 * Verify and continue. A right code saves the guest (name and the consent checkbox as it is now)
 * and marks this phone verified at this table; the caller then joins the table. The third wrong
 * code locks the number and the phone for 60 seconds, after which only a new code works.
 */
export async function verifyCode(input: {
  outletCode: string;
  shortCode: string;
  deviceId: string;
  challengeId: string;
  code: string;
  name: string;
  consent: boolean;
  now?: Date;
}): Promise<VerifyOutcome> {
  const now = input.now ?? new Date();
  const name = checkFirstName(input.name);
  if (!name.ok) return { ok: false, error: "invalid_name" };

  const t = await findTableByQr(db, input.outletCode, input.shortCode);
  const tenantId = t.outlet.tenantId;

  return db.transaction(async (tx): Promise<VerifyOutcome> => {
    const [ch] = await tx
      .select()
      .from(s.otpChallenges)
      .where(
        and(
          eq(s.otpChallenges.tenantId, tenantId),
          eq(s.otpChallenges.id, input.challengeId),
          eq(s.otpChallenges.deviceId, input.deviceId),
          eq(s.otpChallenges.tableId, t.table.id),
        ),
      )
      .for("update");
    if (!ch || ch.verifiedAt || ch.deadAt) return { ok: false, error: "expired" };
    if (ch.lockedUntil) {
      return ch.lockedUntil > now ? { ok: false, error: "locked", retryIn: secondsUntil(ch.lockedUntil, now) } : { ok: false, error: "expired" };
    }
    if (ch.expiresAt <= now) return { ok: false, error: "expired" };

    const code = normaliseCode(input.code);
    if (!isCompleteCode(code) || !codeMatches(ch.id, code, ch.codeHash)) {
      const attempts = ch.attempts + 1;
      const locked = attempts >= OTP.maxAttempts;
      await tx
        .update(s.otpChallenges)
        .set({ attempts, lockedUntil: locked ? later(now, OTP.lockSeconds) : null })
        .where(and(eq(s.otpChallenges.tenantId, tenantId), eq(s.otpChallenges.id, ch.id)));
      return locked ? { ok: false, error: "locked", retryIn: OTP.lockSeconds } : { ok: false, error: "wrong", attemptsLeft: OTP.maxAttempts - attempts };
    }

    // The checkbox as it is now decides both consents; an unticked box withdraws an earlier yes
    const consent = {
      name: name.name,
      consentPersonalisation: input.consent,
      consentMarketing: input.consent,
      consentVersion: CONSENT_VERSION,
      consentAt: now,
      lastSeenAt: now,
    };
    await tx
      .insert(s.guests)
      .values({ tenantId, phone: ch.phone, ...consent })
      .onDuplicateKeyUpdate({ set: consent });
    const [guest] = await tx
      .select({ id: s.guests.id })
      .from(s.guests)
      .where(and(eq(s.guests.tenantId, tenantId), eq(s.guests.phone, ch.phone)));
    await tx
      .update(s.otpChallenges)
      .set({ verifiedAt: now, guestId: guest.id })
      .where(and(eq(s.otpChallenges.tenantId, tenantId), eq(s.otpChallenges.id, ch.id)));
    return { ok: true, guestId: guest.id };
  }, LOCK_THEN_READ);
}

/** The guest this phone verified as at this table within the last 12 hours, if any */
export async function findRecentVerification(run: Runner, tenantId: string, tableId: string, deviceId: string, now: Date) {
  const [row] = await run
    .select({ guestId: s.guests.id, name: s.guests.name })
    .from(s.otpChallenges)
    .innerJoin(s.guests, and(eq(s.guests.tenantId, s.otpChallenges.tenantId), eq(s.guests.id, s.otpChallenges.guestId)))
    .where(
      and(
        eq(s.otpChallenges.tenantId, tenantId),
        eq(s.otpChallenges.tableId, tableId),
        eq(s.otpChallenges.deviceId, deviceId),
        gt(s.otpChallenges.verifiedAt, later(now, -OTP.skipHours * 3600)),
      ),
    )
    .orderBy(desc(s.otpChallenges.verifiedAt))
    .limit(1);
  return row ? { guestId: row.guestId, name: row.name ?? placeholderName(1) } : null;
}

/** For the G2 page: a phone verified here recently skips G2 entirely */
export async function isRecentlyVerified(outletCode: string, shortCode: string, deviceId: string, now = new Date()) {
  const t = await findTableByQr(db, outletCode, shortCode);
  return !!(await findRecentVerification(db, t.outlet.tenantId, t.table.id, deviceId, now));
}
