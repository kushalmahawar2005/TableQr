import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { serviceDate } from "@/domain/booking-policy";
import { bookingByToken, confirmBooking, createBookingHold, getBookingAvailability, saveBookingPreorder } from "@/server/booking/core";
import { claimManualAdvance, confirmManualAdvance } from "@/server/booking/manual-advance";
import { sendBookingOtp, verifyBookingOtp } from "@/server/booking/otp";
import { startReservationCredit } from "@/server/booking/credit";
import { updateBookingPaymentQr, updateOutletSettings } from "@/server/staff/settings-write";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { seatReservation } from "@/server/floor/reservations";
import { syncBill } from "@/server/billing/bill";
import { startOrJoinTable } from "@/server/guest/session";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
const now = new Date();
const date = serviceDate(new Date(now.getTime() + 24 * 3600_000), "Asia/Kolkata");
let serial = 0;
beforeAll(async () => {
  env = await resetTestDb();
  owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
});
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

async function hold(verify = true) {
  await env.db.update(s.outlets).set({ bookingPaymentMode: "manual_qr", bookingPaymentQrUrl: "https://example.test/restaurant-qr.webp" }).where(eq(s.outlets.id, owner.outletId));
  const slot = (await getBookingAvailability("SRJ01", { date, partySize: 2 }, now)).slots.find(value => value.available)!;
  const id = ++serial;
  const held = await createBookingHold("SRJ01", { date, startAt: slot.startAt, partySize: 2, requestId: `manual-hold-${id}`, holdToken: `manual-token-${id}` }, now);
  const priced = await saveBookingPreorder("SRJ01", held.manageToken, [{ itemId: env.demo.itemIds["Masala Papad"], qty: 1 }], now);
  if (verify) {
    const device = `manual-device-${id}`;
    const sent = await sendBookingOtp("SRJ01", held.manageToken, device, `987655${String(id).padStart(4, "0")}`, now);
    await verifyBookingOtp("SRJ01", held.manageToken, device, sent.challengeId, sent.devCode!, `Manual Guest ${id}`, false, now);
  }
  return { ...held, amount: priced.creditRequiredPaise, startAt: slot.startAt, device: `manual-device-${id}` };
}

describe("restaurant-collected booking advances", () => {
  it("requires an owner-uploaded QR before enabling the manual payment mode", async () => {
    await expect(updateOutletSettings(owner, { city: "Jaipur", address: "Test", gstin: "", fssai: "", serviceChargeBp: 0, tipPresetsBp: null, autoAcceptOrders: false, reviewUrl: "", openingHours: null, roomServices: [], wifiSsid: "", wifiPassword: "", bookingPaymentMode: "manual_qr" })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(updateBookingPaymentQr({ ...owner, roles: ["waiter"] }, "/uploads/payment.webp")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("freezes payment instructions and requires verification before a transfer claim", async () => {
    const held = await hold(false);
    await env.db.update(s.outlets).set({ bookingPaymentMode: "gateway", bookingPaymentQrUrl: "https://example.test/new-qr.webp" }).where(eq(s.outlets.id, owner.outletId));
    expect((await bookingByToken("SRJ01", held.manageToken)).row).toMatchObject({ advancePaymentMode: "manual_qr", advancePaymentQrUrl: "https://example.test/restaurant-qr.webp" });
    await expect(claimManualAdvance("SRJ01", held.manageToken, "123456789001", now)).rejects.toMatchObject({ code: "verification_required" });
    await expect(startReservationCredit("SRJ01", held.manageToken, "gateway-bypass", "https://example.test/callback")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("does not count a claim as paid; records a verified receipt once and credits the final bill once", async () => {
    const held = await hold();
    const claim = await claimManualAdvance("SRJ01", held.manageToken, "123456789002", now);
    expect(claim.holdExpiresAt).toBe(now.getTime() + 15 * 60_000);
    expect(await claimManualAdvance("SRJ01", held.manageToken, "123456789002", new Date(now.getTime() + 60_000))).toEqual(claim);
    expect((await bookingByToken("SRJ01", held.manageToken)).row).toMatchObject({ advanceReceivedPaise: 0, creditPaidPaise: 0, status: "requested" });
    await expect(confirmBooking("SRJ01", held.manageToken, { name: "Guest", phone: "9876550002" }, now)).rejects.toMatchObject({ code: "payment_required" });
    await expect(saveBookingPreorder("SRJ01", held.manageToken, [], now)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(confirmManualAdvance({ ...owner, roles: ["host"] }, held.reservationId, "123456789002", now)).rejects.toMatchObject({ code: "forbidden" });
    await expect(confirmManualAdvance({ ...owner, tenantId: env.other.tenantId, outletId: env.other.outletId }, held.reservationId, "123456789002", now)).rejects.toMatchObject({ code: "not_found" });
    const receipts = await Promise.all([confirmManualAdvance(owner, held.reservationId, "123456789002", now), confirmManualAdvance(owner, held.reservationId, "123456789002", now)]);
    expect(receipts).toEqual([{ confirmed: true, advanceReceivedPaise: held.amount }, { confirmed: true, advanceReceivedPaise: held.amount }]);
    const histories = await env.db.select().from(s.reservationHistory).where(and(eq(s.reservationHistory.reservationId, held.reservationId), eq(s.reservationHistory.kind, "confirmed")));
    expect(histories).toHaveLength(1);
    const seated = await seatReservation(owner, { reservationId: held.reservationId }, new Date(held.startAt));
    const [session] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, seated.sessionId));
    const [qr] = await env.db.select().from(s.qrCodes).where(eq(s.qrCodes.tableId, session.tableId));
    const joined = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr.shortCode, deviceId: held.device, now: new Date(held.startAt) });
    const people = await env.db.select().from(s.participants).where(eq(s.participants.sessionId, seated.sessionId));
    expect(people).toHaveLength(1);
    expect(joined.participantId).toBe(people[0].id);
    expect(joined.isHost).toBe(true);
    const scope = { tenantId: owner.tenantId, outletId: owner.outletId, sessionId: seated.sessionId };
    await appDb.transaction(tx => syncBill(tx, scope, now));
    await appDb.transaction(tx => syncBill(tx, scope, now));
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, seated.sessionId));
    expect(bill.bookingCreditPaise).toBe(held.amount);
    // The advance includes exact GST; final invoicing separately rounds to a whole rupee.
    expect(bill.totalPaise).toBe(bill.roundOffPaise);
  });

  it("rejects reuse of a receipt reference across bookings", async () => {
    const held = await hold();
    await claimManualAdvance("SRJ01", held.manageToken, "123456789002", now);
    await expect(confirmManualAdvance(owner, held.reservationId, "123456789002", now)).rejects.toMatchObject({ code: "conflict" });
  });

  it("records money received after expiry without reviving an expired booking", async () => {
    const held = await hold();
    await claimManualAdvance("SRJ01", held.manageToken, "123456789004", now);
    const received = await confirmManualAdvance(owner, held.reservationId, "123456789004", new Date(now.getTime() + 16 * 60_000));
    expect(received).toEqual({ confirmed: false, advanceReceivedPaise: held.amount });
    expect((await bookingByToken("SRJ01", held.manageToken)).row.status).toBe("requested");
  });

  it("allows correcting an unverified reference without extending the hold or approving stale details", async () => {
    const held = await hold();
    const original = await claimManualAdvance("SRJ01", held.manageToken, "WRONGREF123", now);
    const corrected = await claimManualAdvance("SRJ01", held.manageToken, "RIGHTREF123", new Date(now.getTime() + 30_000));
    expect(corrected.holdExpiresAt).toBe(original.holdExpiresAt);
    await expect(confirmManualAdvance(owner, held.reservationId, "WRONGREF123", now)).rejects.toMatchObject({ code: "conflict" });
    expect((await confirmManualAdvance(owner, held.reservationId, "RIGHTREF123", now)).confirmed).toBe(true);
  });
});
