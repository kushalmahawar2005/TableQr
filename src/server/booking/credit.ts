import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { gatewayByName, gatewayFor } from "../payments/gateway";
import { bookingByToken } from "./core";

export async function startReservationCredit(outletCode: string, token: string, requestId: string, callbackUrl: string) {
  const { row, scope } = await bookingByToken(outletCode, token);
  if (row.creditRequiredPaise <= row.creditPaidPaise) return { paid: true as const };
  const gateway = gatewayFor(); if (!gateway) throw new AppError("invalid_state", "Online booking credit is not available. Please contact the restaurant.");
  const [existing] = await db.select().from(s.reservationCredits).where(and(eq(s.reservationCredits.tenantId, scope.tenantId), eq(s.reservationCredits.reservationId, row.id), eq(s.reservationCredits.clientRequestId, requestId)));
  const credit = existing ?? (await db.insert(s.reservationCredits).values({ tenantId: scope.tenantId, outletId: scope.outletId, reservationId: row.id, clientRequestId: requestId, amountPaise: row.creditRequiredPaise, status: "pending", provider: gateway.name }).$returningId(), await db.select().from(s.reservationCredits).where(and(eq(s.reservationCredits.tenantId, scope.tenantId), eq(s.reservationCredits.reservationId, row.id), eq(s.reservationCredits.clientRequestId, requestId))).then(x => x[0]));
  let gatewayRef = credit.gatewayRef;
  if (!gatewayRef) { gatewayRef = (await gateway.createOrder({ paymentId: credit.id, amountPaise: credit.amountPaise, receipt: credit.id })).gatewayRef; await db.update(s.reservationCredits).set({ gatewayRef, status: "pending", updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, scope.tenantId), eq(s.reservationCredits.id, credit.id))); }
  const checkout = gateway.checkout({ gatewayRef, paymentId: credit.id, amountPaise: credit.amountPaise, method: "upi", outletName: scope.name, callbackUrl }).fields;
  if (checkout.callback_url) checkout.callback_url = checkout.callback_url.replace("PLACEHOLDER", credit.id);
  return { paid: false as const, creditId: credit.id, gatewayRef, checkout: { ...gateway.checkout({ gatewayRef, paymentId: credit.id, amountPaise: credit.amountPaise, method: "upi", outletName: scope.name, callbackUrl }), fields: checkout } };
}

export async function reconcileReservationCredit(provider: string, creditId: string, cancelled = false) {
  // isolation-exempt: a signed gateway callback names the credit row; its tenant is read before mutation.
  const [credit] = await db.select().from(s.reservationCredits).where(eq(s.reservationCredits.id, creditId));
  if (!credit) return false;
  const gateway = gatewayByName(provider); if (!gateway) return false;
  if (cancelled) { await db.update(s.reservationCredits).set({ status: "failed", failureReason: "Cancelled", updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, credit.tenantId), eq(s.reservationCredits.id, creditId))); return true; }
  const status = await gateway.fetchStatus(credit.gatewayRef ?? "");
  if (status.status === "success" && status.amountPaise === credit.amountPaise) {
    await db.transaction(async (tx) => { await tx.update(s.reservationCredits).set({ status: "paid", paidPaise: credit.amountPaise, gatewayPaymentId: status.gatewayPaymentId ?? null, updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, credit.tenantId), eq(s.reservationCredits.id, credit.id))); await tx.update(s.reservations).set({ creditPaidPaise: credit.amountPaise, creditStatus: "paid", updatedAt: new Date() }).where(and(eq(s.reservations.tenantId, credit.tenantId), eq(s.reservations.id, credit.reservationId))); });
  } else if (status.status === "failed") await db.update(s.reservationCredits).set({ status: "failed", failureReason: status.reason ?? "Payment failed", updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, credit.tenantId), eq(s.reservationCredits.id, credit.id)));
  return true;
}

export async function refundReservationCredit(tenantId: string, reservationId: string) {
  const [credit] = await db.select().from(s.reservationCredits).where(and(eq(s.reservationCredits.tenantId, tenantId), eq(s.reservationCredits.reservationId, reservationId), eq(s.reservationCredits.status, "paid")));
  if (!credit) return { status: "none" as const };
  if (credit.refundStatus !== "none") return { status: credit.refundStatus };
  const gateway = gatewayByName(credit.provider ?? "");
  if (!gateway || !credit.gatewayPaymentId) return { status: "failed" as const };
  const result = await gateway.refund({ gatewayPaymentId: credit.gatewayPaymentId, amountPaise: credit.paidPaise, refundId: credit.id });
  await db.update(s.reservationCredits).set({ refundGatewayRef: result.gatewayRefundId, refundStatus: result.status, status: result.status === "success" ? "refunded" : "paid", updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, tenantId), eq(s.reservationCredits.id, credit.id)));
  return { status: result.status };
}
