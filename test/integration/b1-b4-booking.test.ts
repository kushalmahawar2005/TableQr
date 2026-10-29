import { getConsoleNotices } from "@/server/staff/notifications";
import { sendOutletPush } from "@/server/staff/web-push";
vi.mock("@/server/staff/web-push", () => ({ sendOutletPush: vi.fn().mockResolvedValue(undefined) }));
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { serviceDate } from "@/domain/booking-policy";
import { AppError } from "@/server/errors";
import { bookingByToken, bookingPreorderMenu, cancelBookingPublic, confirmBooking, createBookingHold, createGroupRequest, getBookingAvailability, getBookingZones, saveBookingPreorder } from "@/server/booking/core";
import { seatReservation } from "@/server/floor/reservations";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff } from "@/server/staff/auth";
import { sendBookingOtp, verifyBookingOtp } from "@/server/booking/otp";
import { estimateWait, joinPublicWaitlist, leavePublicWaitlist, publicWaitlistStatus } from "@/server/booking/waitlist";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
// Always midday in Jaipur tomorrow, whatever the clock says when the test runs: some tests ask
// for slots at "now", and late in the evening there would be none left that day
const date = serviceDate(new Date(Date.now() + 24 * 3600_000), "Asia/Kolkata");
const now = new Date(`${date}T12:00:00+05:30`);

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

  it("prices and saves a reservation preorder on the server, adding it to the required advance", async () => {
    const holdNow = new Date(now.getTime() - 2 * 3600_000);
    const availability = await getBookingAvailability("SRJ01", { date, partySize: 2 }, holdNow);
    const slot = availability.slots.find((x) => x.available)!;
    const hold = await createBookingHold("SRJ01", { date, startAt: slot.startAt, partySize: 2, requestId: "preorder-hold", holdToken: "preorder-token" }, holdNow);
    const menu = await bookingPreorderMenu("SRJ01");
    const item = menu.find((x) => x.groups.every((group) => group.minSelect === 0) && x.id === env.demo.itemIds["Masala Papad"])!;
    const saved = await saveBookingPreorder("SRJ01", hold.manageToken, [{ itemId: item.id, qty: 2 }], holdNow);
    expect(saved.preorder).toMatchObject([{ itemId: item.id, qty: 2, unitPricePaise: item.pricePaise }]);
    const taxPaise = Math.floor(item.pricePaise * 2 * item.taxRateBp / 10_000 + 0.5);
    expect(saved.preorderTotalPaise).toBe(item.pricePaise * 2 + taxPaise);
    expect(saved.creditRequiredPaise).toBe(hold.creditRequiredPaise + item.pricePaise * 2 + taxPaise);
    await expect(saveBookingPreorder("SRJ01", hold.manageToken, [{ itemId: item.id, qty: 0 }], holdNow)).rejects.toBeInstanceOf(AppError);
  });

  it("includes the restaurant's fixed advance in the slot and preserves it when a preorder is added", async () => {
    const [before] = await env.db.select({ bookingAdvancePaise: s.outlets.bookingAdvancePaise, bookingPaymentMode: s.outlets.bookingPaymentMode, bookingPaymentQrUrl: s.outlets.bookingPaymentQrUrl }).from(s.outlets).where(eq(s.outlets.id, env.demo.outletId));
    try {
      await env.db.update(s.outlets).set({ bookingAdvancePaise: 10_000, bookingPaymentMode: "manual_qr", bookingPaymentQrUrl: "/uploads/test-payment-qr.png" }).where(eq(s.outlets.id, env.demo.outletId));
      const holdNow = new Date(now.getTime() - 2 * 3600_000);
      const availability = await getBookingAvailability("SRJ01", { date, partySize: 2 }, holdNow);
      const slot = availability.slots.find((value) => value.available)!;
      expect(slot.creditRequiredPaise).toBe(10_000);
      const hold = await createBookingHold("SRJ01", { date, startAt: slot.startAt, partySize: 2, requestId: "fixed-deposit-hold", holdToken: "fixed-deposit-token" }, holdNow);
      expect(hold.creditRequiredPaise).toBe(10_000);
      const item = (await bookingPreorderMenu("SRJ01")).find((value) => value.nameEn === "Masala Papad")!;
      const saved = await saveBookingPreorder("SRJ01", hold.manageToken, [{ itemId: item.id, qty: 1 }], holdNow);
      expect(saved.creditRequiredPaise).toBe(10_000 + item.pricePaise + Math.floor(item.pricePaise * item.taxRateBp / 10_000 + 0.5));
    } finally {
      await env.db.update(s.outlets).set(before).where(eq(s.outlets.id, env.demo.outletId));
    }
  });

  it("sends a saved preorder to the kitchen when staff seats the party", async () => {
    const holdNow = new Date(now.getTime() - 2 * 3600_000);
    const availability = await getBookingAvailability("SRJ01", { date, partySize: 2 }, holdNow);
    const slot = availability.slots.find((x) => x.available)!;
    const hold = await createBookingHold("SRJ01", { date, startAt: slot.startAt, partySize: 2, requestId: "preorder-seat-hold", holdToken: "preorder-seat-token" }, holdNow);
    const item = (await bookingPreorderMenu("SRJ01")).find((x) => x.nameEn === "Masala Papad")!;
    await saveBookingPreorder("SRJ01", hold.manageToken, [{ itemId: item.id, qty: 1 }], holdNow);
    await env.db.update(s.reservations).set({ status: "confirmed", holdExpiresAt: null, confirmedAt: holdNow }).where(eq(s.reservations.id, hold.reservationId));

    const staff = await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token);
    expect(staff).not.toBeNull();
    const seated = await seatReservation(staff!, { reservationId: hold.reservationId }, new Date(slot.startAt));
    const [order] = await env.db.select().from(s.orders).where(eq(s.orders.sessionId, seated.sessionId));
    expect(order).toMatchObject({ status: "placed", note: expect.stringContaining("Preorder") });
    const lines = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, order.id));
    expect(lines).toMatchObject([{ itemId: item.id, qty: 1, status: "placed", personalForPickup: false }]);
    const tickets = await env.db.select().from(s.tickets).where(eq(s.tickets.orderId, order.id));
    expect(tickets.length).toBeGreaterThan(0);
    const [person] = await env.db.select().from(s.participants).where(eq(s.participants.sessionId, seated.sessionId));
    expect(person.guestId).toBeNull();
    const [visit] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, seated.sessionId));
    const [qr] = await env.db.select().from(s.qrCodes).where(eq(s.qrCodes.tableId, visit.tableId));
    const joined = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr.shortCode, deviceId: "legacy-preorder-phone", now: new Date(slot.startAt) });
    expect(joined.participantId).toBe(person.id);
    expect(joined.isHost).toBe(true);
    const people = await env.db.select().from(s.participants).where(eq(s.participants.sessionId, seated.sessionId));
    expect(people).toHaveLength(1);
    expect(people[0].guestId).toBeNull();
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
    const request = await createGroupRequest("SRJ01", { requestId: "group-req-1", name: "Large Party", phone: "9876543212", partySize: 15, desiredDate: date, desiredLocalDateTime: `${date}T19:00`, notes: "Private room if possible" });
    expect(request.publicReference).toMatch(/^TQ-/);
    const [reservation] = await env.db.select().from(s.reservations).where(eq(s.reservations.bookingRequestId, "group-req-1"));
    expect(reservation).toBeUndefined();
    const [stored] = await env.db.select().from(s.groupRequests).where(eq(s.groupRequests.requestId, "group-req-1"));
    expect(stored.partySize).toBe(15);
    expect(sendOutletPush).toHaveBeenCalledWith(expect.objectContaining({ tenantId: env.demo.tenantId }), expect.objectContaining({ title: "New party request", url: "/console/reservations" }), { kind: "management" });
    const staff = await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token);
    const notices = await getConsoleNotices(staff!, new Date(Date.now() - 60_000));
    expect(notices).toContainEqual(expect.objectContaining({ id: `party:${stored.id}`, kind: "party", title: "New party request · Large Party" }));
    const calls = vi.mocked(sendOutletPush).mock.calls.length;
    await createGroupRequest("SRJ01", { requestId: "group-req-1", name: "Large Party", phone: "9876543212", partySize: 15, desiredDate: date, desiredLocalDateTime: `${date}T19:00` });
    expect(vi.mocked(sendOutletPush).mock.calls.length).toBe(calls);

  });

  it("prevents simultaneous holds for the only twelve-top", async () => {
    const holdNow = new Date(now.getTime() - 2 * 3600_000);
    const at = (await getBookingAvailability("SRJ01", { date, partySize: 12 }, holdNow)).slots.find((slot) => slot.available)!.startAt;
    const results = await Promise.allSettled([
      createBookingHold("SRJ01", { date, startAt: at, partySize: 12, requestId: "race-a", holdToken: "race-a-token" }, holdNow),
      createBookingHold("SRJ01", { date, startAt: at, partySize: 12, requestId: "race-b", holdToken: "race-b-token" }, holdNow),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("reuses OTP rules for booking context and confirms the held reservation", async () => {
    const at = (await getBookingAvailability("SRJ01", { date, partySize: 2 }, now)).slots.find((slot) => slot.available)!.startAt;
    const hold = await createBookingHold("SRJ01", { date, startAt: at, partySize: 2, requestId: "otp-booking", holdToken: "otp-booking-token" }, now);
    const sent = await sendBookingOtp("SRJ01", hold.manageToken, "booking-device", "9876543210", now);
    expect(sent.devCode).toMatch(/^\d{4}$/);
    const verified = await verifyBookingOtp("SRJ01", hold.manageToken, "booking-device", sent.challengeId, sent.devCode!, "Booking Guest", false, now);
    expect(verified.guestId).toBeTruthy();
    await confirmBooking("SRJ01", hold.manageToken, { name: "Booking Guest", phone: "9876543210", guestId: verified.guestId }, now);
    await confirmBooking("SRJ01", hold.manageToken, { name: "Booking Guest", phone: "9876543210", guestId: verified.guestId }, now);
    expect((await env.db.select().from(s.reservationHistory).where(and(eq(s.reservationHistory.reservationId, hold.reservationId), eq(s.reservationHistory.kind, "confirmed")))).length).toBe(1);
    const [r] = await env.db.select().from(s.reservations).where(eq(s.reservations.id, hold.reservationId));
    expect(r?.guestId).toBe(verified.guestId);
  });

  it("rejects a timestamp that is not one of the restaurant's published slots", async () => {
    await expect(createBookingHold("SRJ01", { date, startAt: now.getTime() + 3 * 60_000, partySize: 2, requestId: "invalid-slot", holdToken: "invalid-slot-token" }, new Date(now.getTime() - 2 * 3600_000))).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("keeps public management opaque and supports cancellation", async () => {
    const at = (await getBookingAvailability("SRJ01", { date, partySize: 2 }, now)).slots.find((slot) => slot.available)!.startAt;
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

  it("keeps the open waitlist from being used to text strangers: one live entry per number, three a day", async () => {
    const phone = "+919811100001";
    const first = await joinPublicWaitlist("SRJ01", { name: "One", phone, partySize: 2 });
    await expect(joinPublicWaitlist("SRJ01", { name: "Again", phone, partySize: 2 })).rejects.toMatchObject({ code: "conflict" });
    await leavePublicWaitlist("SRJ01", first.token);
    await leavePublicWaitlist("SRJ01", (await joinPublicWaitlist("SRJ01", { name: "Two", phone, partySize: 2 })).token);
    await leavePublicWaitlist("SRJ01", (await joinPublicWaitlist("SRJ01", { name: "Three", phone, partySize: 2 })).token);
    await expect(joinPublicWaitlist("SRJ01", { name: "Four", phone, partySize: 2 })).rejects.toMatchObject({ code: "rate_limited" });
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
