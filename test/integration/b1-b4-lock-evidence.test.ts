import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { serviceDate } from "@/domain/booking-policy";
import { uuidv7 } from "@/db/id";
import { AppError } from "@/server/errors";
import { createReservation } from "@/server/floor/reservations";
import { startOrJoinTable } from "@/server/guest/session";
import { getGuestContext } from "@/server/guest/context";
import { addCartLine } from "@/server/guest/cart";
import { placeOrder } from "@/server/guest/order";
import { requestBill } from "@/server/billing/payments";
import { mockGateway } from "@/server/payments/gateway";
import { bookingByToken, cancelBookingPublic, confirmBooking, createBookingHold } from "@/server/booking/core";
import { sendBookingOtp, verifyBookingOtp } from "@/server/booking/otp";
import { recordReservationRefundResult, refundReservationCredit, reconcileReservationCredit, startReservationCredit } from "@/server/booking/credit";
import { joinPublicWaitlist, publicWaitlistStatus } from "@/server/booking/waitlist";
import { resetTestDb } from "./setup-db";
import type { StaffSession } from "@/server/staff/auth";

let env: Awaited<ReturnType<typeof resetTestDb>>;
const now = new Date(Date.now() + 24 * 3600_000);
const date = serviceDate(now, "Asia/Kolkata");
let host: StaffSession;
const fails = async (p: Promise<unknown>) => { const e = await p.then(() => null, (x) => x); expect(e).toBeInstanceOf(AppError); };

beforeAll(async () => {
  env = await resetTestDb();
  host = { tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: env.demo.staffIds.host, sessionId: uuidv7(), name: "Anil Kumar", roles: ["host"], expiresAt: Date.now() + 3600_000, outlet: { code: "SRJ01", name: "Spice Route", timezone: "Asia/Kolkata" } };
  await env.db.insert(s.bookingPolicies).values({ id: uuidv7(), tenantId: env.demo.tenantId, outletId: env.demo.outletId, pacingCoversPerSlot: 1, peakCreditPaise: 800, updatedAt: now });
});
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

async function hold(label: string, offset: number, credit = false) {
  const at = now.getTime() + offset * 3600_000;
  if (credit) await createReservation(host, { name: `Pacer ${label}`, phone: "9876500000", partySize: 2, startAt: at, tableIds: [env.demo.tableIds.T2], source: "staff" }, now);
  return createBookingHold("SRJ01", { date, startAt: at, partySize: 2, requestId: `lock-${label}`, holdToken: `token-${label}` }, now);
}

async function payCredit(h: Awaited<ReturnType<typeof hold>>) {
  const sent = await sendBookingOtp("SRJ01", h.manageToken, `device-${h.reservationId}`, "9876543218", now);
  const verified = await verifyBookingOtp("SRJ01", h.manageToken, `device-${h.reservationId}`, sent.challengeId, sent.devCode!, "Credit Guest", false, now);
  const checkout = await startReservationCredit("SRJ01", h.manageToken, `payment-${h.reservationId}`, "http://localhost:3000/api/booking-credit/return?provider=mock&p=PLACEHOLDER");
  mockGateway.settle(checkout.gatewayRef!, "success");
  await reconcileReservationCredit("mock", checkout.creditId!);
  await confirmBooking("SRJ01", h.manageToken, { name: "Credit Guest", phone: "9876543218", guestId: verified.guestId }, now);
  return checkout;
}

describe("B1-B4 final credit and security evidence", () => {
  it("failed payment does not pay credit or confirm reservation", async () => {
    const h = await hold("failed", 2, true); const checkout = await startReservationCredit("SRJ01", h.manageToken, "failed-payment", "http://localhost:3000/api/booking-credit/return?provider=mock&p=PLACEHOLDER");
    mockGateway.settle(checkout.gatewayRef!, "failed"); await reconcileReservationCredit("mock", checkout.creditId!);
    const [c] = await env.db.select().from(s.reservationCredits).where(eq(s.reservationCredits.id, checkout.creditId!)); const [r] = await env.db.select().from(s.reservations).where(eq(s.reservations.id, h.reservationId));
    expect(c.status).toBe("failed"); expect(r.creditPaidPaise).toBe(0); expect(r.status).toBe("requested");
    expect((await env.db.select().from(s.bills).where(eq(s.bills.bookingCreditReservationId, r.id)))).toHaveLength(0);
  });

  it("ignores a client-forged credit amount", async () => {
    const h = await hold("forged", 6, true); const forgedStart = startReservationCredit as unknown as (outlet: string, token: string, request: string, callback: string, extra: { amountPaise: number }) => Promise<{ paid: false; creditId: string; checkout: { fields: Record<string, string> } }>; const checkout = await forgedStart("SRJ01", h.manageToken, "forged-payment", "http://localhost:3000/api/booking-credit/return?provider=mock&p=PLACEHOLDER", { amountPaise: 1 });
    const [c] = await env.db.select().from(s.reservationCredits).where(eq(s.reservationCredits.id, checkout.creditId!));
    expect(c.amountPaise).toBe(800); expect(Number(checkout.checkout.fields.amount)).toBe(800);
  });

  it("refunds paid credit once and keeps duplicate refund processing idempotent", async () => {
    const h = await hold("refund", 10, true); const checkout = await payCredit(h); await cancelBookingPublic("SRJ01", h.manageToken, "guest_cancelled", new Date(now.getTime() - 3 * 3600_000));
    const first = await refundReservationCredit(env.demo.tenantId, h.reservationId); const [pending] = await env.db.select().from(s.reservationCredits).where(eq(s.reservationCredits.id, checkout.creditId!)); expect(first.status).toBe("pending"); expect(pending.refundStatus).toBe("pending");
    mockGateway.settleRefund(pending.refundGatewayRef!, "success"); await recordReservationRefundResult("mock", pending.refundGatewayRef!, "success"); await recordReservationRefundResult("mock", pending.refundGatewayRef!, "success");
    const [done] = await env.db.select().from(s.reservationCredits).where(eq(s.reservationCredits.id, checkout.creditId!)); expect(done.refundStatus).toBe("success"); expect(done.status).toBe("refunded");
  });

  it("applies paid credit once when bill sync runs repeatedly", async () => {
    const h = await hold("bill", 14, true); const checkout = await payCredit(h); await (await import("@/server/floor/reservations")).seatReservation(host, { reservationId: h.reservationId }, now); const joined = await startOrJoinTable({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T1, deviceId: `bill-${h.reservationId}`, displayName: "Credit Guest" }); const ctx = await getGuestContext("SRJ01", env.demo.tableQr.T1, joined.participantId, `bill-${h.reservationId}`); await addCartLine(ctx, { itemId: env.demo.itemIds.Cola, qty: 1 }); await placeOrder(ctx); await requestBill({ tenantId: ctx.tenantId, outletId: ctx.outletId, sessionId: ctx.sessionId }); const [a] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, ctx.sessionId)); await requestBill({ tenantId: ctx.tenantId, outletId: ctx.outletId, sessionId: ctx.sessionId }); const [b] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, ctx.sessionId)); expect(a.bookingCreditPaise).toBe(b.bookingCreditPaise); expect(a.totalPaise).toBe(b.totalPaise); expect(a.bookingCreditReservationId).toBe(h.reservationId); expect(checkout.creditId).toBeTruthy();
  });

  it("rejects guessed/reference/token/cross-outlet access and stale confirmation", async () => {
    const h = await hold("security", 18); await fails(bookingByToken("SRJ01", String(h.publicReference))); await fails(bookingByToken("SRJ01", "bad-token")); await fails(bookingByToken("CNJ01", h.manageToken)); await fails(confirmBooking("SRJ01", h.manageToken, { name: "Late", phone: "9876543218" }, new Date(now.getTime() + 6 * 60_000)));
  });

  it("keeps duplicate confirmation/cancellation and waitlist tampering safe", async () => {
    await env.db.update(s.bookingPolicies).set({ peakCreditPaise: 0 }).where(and(eq(s.bookingPolicies.tenantId, env.demo.tenantId), eq(s.bookingPolicies.outletId, env.demo.outletId)));
    const h = await hold("idempotent", 22); await confirmBooking("SRJ01", h.manageToken, { name: "Idempotent", phone: "9876543218" }, now); await confirmBooking("SRJ01", h.manageToken, { name: "Idempotent", phone: "9876543218" }, now); await cancelBookingPublic("SRJ01", h.manageToken, "guest_cancelled", new Date(now.getTime() - 3 * 3600_000)); await cancelBookingPublic("SRJ01", h.manageToken, "guest_cancelled", now); const joined = await joinPublicWaitlist("SRJ01", { name: "Tamper", phone: "9876543219", partySize: 2 }); await fails(publicWaitlistStatus("SRJ01", `${joined.token}bad`)); const s1 = await publicWaitlistStatus("SRJ01", joined.token); expect(s1.position).toBe(1); expect(s1.estimateMinutes).toBeGreaterThan(0);
  });
});
