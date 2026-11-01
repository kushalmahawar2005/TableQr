import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { serviceDate } from "@/domain/booking-policy";
import { bookingByToken, confirmBooking, createBookingHold, getBookingAvailability } from "@/server/booking/core";
import { sendBookingOtp, verifyBookingOtp } from "@/server/booking/otp";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
const now = new Date();
const date = serviceDate(new Date(now.getTime() + 24 * 3600_000), "Asia/Kolkata");
let sequence = 0;

beforeAll(async () => { env = await resetTestDb(); });
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

async function hold() {
  const availability = await getBookingAvailability("SRJ01", { date, partySize: 2 }, now);
  const slot = availability.slots.find(value => value.available)!;
  const id = ++sequence;
  return createBookingHold("SRJ01", { date, startAt: slot.startAt, partySize: 2, requestId: `verify-${id}`, holdToken: `verify-token-${id}` }, now);
}

describe("booking identity and OTP boundaries", () => {
  it("requires verification and confirms the identity stored by OTP, ignoring browser replacements", async () => {
    const held = await hold();
    await expect(confirmBooking("SRJ01", held.manageToken, { name: "Unverified", phone: "9876543101" }, now)).rejects.toMatchObject({ code: "verification_required" });
    const sent = await sendBookingOtp("SRJ01", held.manageToken, "identity-device", "9876543101", now);
    const verified = await verifyBookingOtp("SRJ01", held.manageToken, "identity-device", sent.challengeId, sent.devCode!, "Verified Guest", false, now);
    await expect(confirmBooking("SRJ01", held.manageToken, { name: "Forged", phone: "9876543999", guestId: "another-guest" }, now)).rejects.toMatchObject({ code: "verification_required" });
    await confirmBooking("SRJ01", held.manageToken, { name: "Forged", phone: "9876543999", guestId: verified.guestId }, now);
    expect((await bookingByToken("SRJ01", held.manageToken)).row).toMatchObject({ name: "Verified Guest", phone: "+919876543101", guestId: verified.guestId, status: "confirmed" });
    await expect(sendBookingOtp("SRJ01", held.manageToken, "identity-device", "9876543999", now)).rejects.toMatchObject({ code: "expired" });
  });

  it("commits every wrong attempt and blocks the correct code after three failures", async () => {
    const held = await hold();
    const sent = await sendBookingOtp("SRJ01", held.manageToken, "attempt-device", "9876543102", now);
    const wrong = sent.devCode === "0000" ? "1111" : "0000";
    for (let attempt = 1; attempt <= 3; attempt++) {
      await expect(verifyBookingOtp("SRJ01", held.manageToken, "attempt-device", sent.challengeId, wrong, "Guest", false, now)).rejects.toMatchObject({ code: attempt === 3 ? "locked" : "wrong" });
      const [challenge] = await env.db.select().from(s.otpChallenges).where(eq(s.otpChallenges.id, sent.challengeId));
      expect(challenge.attempts).toBe(attempt);
    }
    await expect(verifyBookingOtp("SRJ01", held.manageToken, "attempt-device", sent.challengeId, sent.devCode!, "Guest", false, now)).rejects.toMatchObject({ code: "locked" });
    await expect(sendBookingOtp("SRJ01", held.manageToken, "attempt-device", "9876543102", now)).rejects.toMatchObject({ code: "locked" });
    const retry = new Date(now.getTime() + 61_000);
    const fresh = await sendBookingOtp("SRJ01", held.manageToken, "attempt-device", "9876543102", retry);
    expect(await verifyBookingOtp("SRJ01", held.manageToken, "attempt-device", fresh.challengeId, fresh.devCode!, "Guest", false, retry)).toMatchObject({ phone: "+919876543102" });
  });

  it("enforces resend timing and a separate device quota", async () => {
    const held = await hold();
    await sendBookingOtp("SRJ01", held.manageToken, "resend-device", "9876543103", now);
    await expect(sendBookingOtp("SRJ01", held.manageToken, "resend-device", "9876543103", now)).rejects.toMatchObject({ code: "rate_limited" });
    for (const seconds of [61, 122]) await sendBookingOtp("SRJ01", held.manageToken, "resend-device", "9876543103", new Date(now.getTime() + seconds * 1000));
    await expect(sendBookingOtp("SRJ01", held.manageToken, "resend-device", "9876543104", new Date(now.getTime() + 183_000))).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("cannot verify a different reservation using a valid code from the same table", async () => {
    const first = await hold();
    const [assignment] = await env.db.select().from(s.reservationTables).where(and(eq(s.reservationTables.tenantId, env.demo.tenantId), eq(s.reservationTables.reservationId, first.reservationId)));
    const { row } = await bookingByToken("SRJ01", first.manageToken);
    const otherStart = row.startAt.getTime() + 4 * 3600_000;
    const second = await createBookingHold("SRJ01", { date, startAt: otherStart, partySize: 2, requestId: "verify-other", holdToken: "verify-other-token" }, now);
    // The binding is stronger than table/device identity. Force both holds onto the same table.
    await env.db.update(s.reservationTables).set({ tableId: assignment.tableId }).where(and(eq(s.reservationTables.tenantId, env.demo.tenantId), eq(s.reservationTables.reservationId, second.reservationId)));
    const sent = await sendBookingOtp("SRJ01", first.manageToken, "binding-device", "9876543105", now);
    await expect(verifyBookingOtp("SRJ01", second.manageToken, "binding-device", sent.challengeId, sent.devCode!, "Guest", false, now)).rejects.toMatchObject({ code: "wrong" });
    expect((await bookingByToken("SRJ01", second.manageToken)).row.guestId).toBeNull();
  });

  it("rejects expired management links and expired table holds before sending codes", async () => {
    const held = await hold();
    await expect(sendBookingOtp("SRJ01", held.manageToken, "expired-device", "9876543106", new Date(now.getTime() + 6 * 60_000))).rejects.toMatchObject({ code: "expired" });
    await env.db.update(s.reservations).set({ manageTokenExpiresAt: new Date(now.getTime() - 1000) }).where(and(eq(s.reservations.tenantId, env.demo.tenantId), eq(s.reservations.id, held.reservationId)));
    await expect(bookingByToken("SRJ01", held.manageToken, now)).rejects.toMatchObject({ code: "not_found" });
  });
});
