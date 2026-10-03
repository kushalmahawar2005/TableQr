import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { serviceDate } from "@/domain/booking-policy";
import { AppError } from "@/server/errors";
import { bookingByToken, cancelBookingPublic, createBookingHold, getBookingAvailability } from "@/server/booking/core";
import { sendBookingOtp, verifyBookingOtp } from "@/server/booking/otp";
import { joinPublicWaitlist, leavePublicWaitlist, publicWaitlistStatus } from "@/server/booking/waitlist";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
const now = new Date(Date.now() + 24 * 3600_000);
const date = serviceDate(now, "Asia/Kolkata");

beforeAll(async () => { env = await resetTestDb(); });
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

describe("B1-B4 booking domain", () => {
  it("returns server-derived slots and holds an exact table for five minutes", async () => {
    const availability = await getBookingAvailability("SRJ01", { date, partySize: 12 }, new Date(now.getTime() - 2 * 3600_000));
    expect(availability.groupRequest).toBe(false);
    const slot = availability.slots.find((x) => x.available)!;
    expect(slot).toBeDefined();
    const hold = await createBookingHold("SRJ01", { date, startAt: slot.startAt, partySize: 12, requestId: "b1-hold", holdToken: "hold-token" }, new Date(now.getTime() - 2 * 3600_000));
    expect(hold.holdExpiresAt - (now.getTime() - 2 * 3600_000)).toBe(5 * 60_000);
    const [tables] = await env.db.select({ n: s.reservationTables.id }).from(s.reservationTables).where(eq(s.reservationTables.reservationId, hold.reservationId));
    expect(tables).toBeDefined();
  });

  it("prevents simultaneous holds for the only twelve-top", async () => {
    const at = now.getTime() + 4 * 3600_000;
    const results = await Promise.allSettled([
      createBookingHold("SRJ01", { date, startAt: at, partySize: 12, requestId: "race-a", holdToken: "race-a-token" }, now),
      createBookingHold("SRJ01", { date, startAt: at, partySize: 12, requestId: "race-b", holdToken: "race-b-token" }, now),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("reuses OTP rules for booking context and confirms the held reservation", async () => {
    const at = now.getTime() + 6 * 3600_000;
    const hold = await createBookingHold("SRJ01", { date, startAt: at, partySize: 2, requestId: "otp-booking", holdToken: "otp-booking-token" }, now);
    const sent = await sendBookingOtp("SRJ01", hold.manageToken, "booking-device", "9876543210", now);
    expect(sent.devCode).toMatch(/^\d{4}$/);
    const verified = await verifyBookingOtp("SRJ01", hold.manageToken, "booking-device", sent.challengeId, sent.devCode!, "Booking Guest", false, now);
    expect(verified.guestId).toBeTruthy();
    const [r] = await env.db.select().from(s.reservations).where(eq(s.reservations.id, hold.reservationId));
    expect(r?.guestId).toBe(verified.guestId);
  });

  it("keeps public management opaque and supports cancellation", async () => {
    const at = now.getTime() + 8 * 3600_000;
    const hold = await createBookingHold("SRJ01", { date, startAt: at, partySize: 2, requestId: "manage-booking", holdToken: "manage-booking-token" }, now);
    expect((await bookingByToken("SRJ01", hold.manageToken)).row.id).toBe(hold.reservationId);
    await cancelBookingPublic("SRJ01", hold.manageToken, "guest_cancelled", now);
    await expect(bookingByToken("SRJ01", "wrong-token")).rejects.toBeInstanceOf(AppError);
  });

  it("supports public waitlist position, fallback estimate and leave", async () => {
    const joined = await joinPublicWaitlist("SRJ01", { name: "Queue Guest", phone: "+919876543210", partySize: 2, seatingPreference: "Indoor" });
    const status = await publicWaitlistStatus("SRJ01", joined.token);
    expect(status.position).toBe(1);
    expect(status.estimateMinutes).toBe(30);
    expect(status.seatingPreference).toBe("Indoor");
    await leavePublicWaitlist("SRJ01", joined.token);
    expect((await publicWaitlistStatus("SRJ01", joined.token)).status).toBe("left");
  });
});
