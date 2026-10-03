import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { serviceDate } from "@/domain/booking-policy";
import { AppError } from "@/server/errors";
import { bookingByToken, cancelBookingPublic, createBookingHold, createGroupRequest, getBookingAvailability, getBookingZones } from "@/server/booking/core";
import { sendBookingOtp, verifyBookingOtp } from "@/server/booking/otp";
import { estimateWait, joinPublicWaitlist, leavePublicWaitlist, publicWaitlistStatus } from "@/server/booking/waitlist";
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

  it("accepts only tenant-scoped configured zones", async () => {
    const zones = await getBookingZones("SRJ01");
    expect(zones.length).toBeGreaterThan(0);
    const availability = await getBookingAvailability("SRJ01", { date, partySize: 2, preference: { zoneId: zones[0].id } }, now);
    expect(availability.slots.length).toBeGreaterThan(0);
    await expect(getBookingAvailability("SRJ01", { date, partySize: 2, preference: { zoneId: "not-a-zone" } }, now)).rejects.toBeInstanceOf(AppError);
    const [otherZone] = await env.db.select({ id: s.zones.id }).from(s.zones).where(eq(s.zones.tenantId, env.other.tenantId)).limit(1);
    await expect(getBookingAvailability("SRJ01", { date, partySize: 2, preference: { zoneId: otherZone.id } }, now)).rejects.toBeInstanceOf(AppError);
  });

  it("persists group requests above twelve without creating a reservation", async () => {
    const request = await createGroupRequest("SRJ01", { requestId: "group-req-1", name: "Large Party", phone: "9876543212", partySize: 15, desiredDate: date, desiredStartAt: now.getTime(), notes: "Private room if possible" });
    expect(request.publicReference).toMatch(/^TQ-/);
    const [reservation] = await env.db.select().from(s.reservations).where(eq(s.reservations.bookingRequestId, "group-req-1"));
    expect(reservation).toBeUndefined();
    const [stored] = await env.db.select().from(s.groupRequests).where(eq(s.groupRequests.requestId, "group-req-1"));
    expect(stored.partySize).toBe(15);
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

  it("uses historical wait time after thirty useful completed parties", async () => {
    const tableId = env.demo.tableIds.T1;
    for (let i = 0; i < 30; i++) {
      const sessionId = uuidv7();
      const opened = new Date(now.getTime() - (i + 1) * 3600_000);
      const closed = new Date(opened.getTime() + 40 * 60_000);
      await env.db.insert(s.tableSessions).values({ id: sessionId, tenantId: env.demo.tenantId, outletId: env.demo.outletId, tableId, mode: "open", status: "closed", source: "walk_in", partySize: 2, openedAt: opened, lastActivityAt: closed, closedAt: closed, openKey: null });
      await env.db.insert(s.sessionTables).values({ id: uuidv7(), tenantId: env.demo.tenantId, outletId: env.demo.outletId, sessionId, tableId, isPrimary: true, activeKey: null, assignedAt: opened, releasedAt: closed });
    }
    const estimate = await estimateWait(appDb, { tenantId: env.demo.tenantId, outletId: env.demo.outletId }, 2, null, now);
    expect(estimate.source).toBe("historical");
    expect(estimate.minutes).toBeGreaterThan(0);
  });
});
