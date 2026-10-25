import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { currencyAccepted } from "../payments/gateway";
import { gatewayForOutletPayment } from "../payments/outlet-gateway";
import { bookingByToken } from "./core";

export async function startReservationCredit(outletCode: string, token: string, requestId: string, callbackUrl: string) {
  const { row, scope } = await bookingByToken(outletCode, token);
  if (row.advancePaymentMode !== "gateway") throw new AppError("invalid_state", "Pay using the restaurant’s payment QR and submit your transaction reference.");
  if (row.creditRequiredPaise <= row.creditPaidPaise) return { paid: true as const };
  const gateway = await gatewayForOutletPayment(scope.tenantId, scope.outletId, "cashfree") ?? (process.env.NODE_ENV !== "production" ? await gatewayForOutletPayment(scope.tenantId, scope.outletId, "mock") : null); if (!gateway) throw new AppError("invalid_state", "This restaurant has not connected its own Cashfree account for online advances. Please use its payment QR or contact staff.");
  const [existing] = await db.select().from(s.reservationCredits).where(and(eq(s.reservationCredits.tenantId, scope.tenantId), eq(s.reservationCredits.reservationId, row.id), eq(s.reservationCredits.clientRequestId, requestId)));
  const credit = existing ?? (await db.insert(s.reservationCredits).values({ tenantId: scope.tenantId, outletId: scope.outletId, reservationId: row.id, clientRequestId: requestId, amountPaise: row.creditRequiredPaise, status: "pending", provider: gateway.name }).$returningId(), await db.select().from(s.reservationCredits).where(and(eq(s.reservationCredits.tenantId, scope.tenantId), eq(s.reservationCredits.reservationId, row.id), eq(s.reservationCredits.clientRequestId, requestId))).then(x => x[0]));
  const resolvedCallbackUrl = callbackUrl.replaceAll("{provider}", gateway.name).replaceAll("{creditId}", credit.id);
  let gatewayRef = credit.gatewayRef;
  if (!gatewayRef) { gatewayRef = (await gateway.createOrder({ paymentId: credit.id, amountPaise: credit.amountPaise, receipt: credit.id, callbackUrl: resolvedCallbackUrl })).gatewayRef; await db.update(s.reservationCredits).set({ gatewayRef, status: "pending", updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, scope.tenantId), eq(s.reservationCredits.id, credit.id))); }
  const checkout = await gateway.checkout({ gatewayRef, paymentId: credit.id, amountPaise: credit.amountPaise, method: "upi", outletName: scope.name, callbackUrl: resolvedCallbackUrl });
  if (checkout.kind === "form" && checkout.fields.callback_url) checkout.fields.callback_url = checkout.fields.callback_url.replace("PLACEHOLDER", credit.id);
  return { paid: false as const, creditId: credit.id, gatewayRef, checkout };
}

export async function reconcileReservationCredit(provider: string, creditId: string, cancelled = false) {
  // isolation-exempt: a signed gateway callback names the credit row; its tenant is read before mutation.
  const [credit] = await db.select().from(s.reservationCredits).where(eq(s.reservationCredits.id, creditId));
  if (!credit) return false;
  const gateway = await gatewayForOutletPayment(credit.tenantId, credit.outletId, provider); if (!gateway) return false;
  // A credit that was paid, used, returned or kept is final; a browser link cannot change it
  if (["paid", "applied", "refunded", "forfeited"].includes(credit.status)) return true;
  const status = await gateway.fetchStatus(credit.gatewayRef ?? "");
  // The guest came back saying cancel: close it only when the gateway confirms nothing was attempted
  if (cancelled && status.status === "none") {
    await db.update(s.reservationCredits).set({ status: "failed", failureReason: "Cancelled", updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, credit.tenantId), eq(s.reservationCredits.id, creditId), ne(s.reservationCredits.status, "paid")));
    return true;
  }
  if (status.status === "success" && status.amountPaise === credit.amountPaise && currencyAccepted(status.currency)) {
    await db.transaction(async (tx) => { await tx.update(s.reservationCredits).set({ status: "paid", paidPaise: credit.amountPaise, gatewayPaymentId: status.gatewayPaymentId ?? null, updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, credit.tenantId), eq(s.reservationCredits.id, credit.id))); await tx.update(s.reservations).set({ creditPaidPaise: credit.amountPaise, creditStatus: "paid", updatedAt: new Date() }).where(and(eq(s.reservations.tenantId, credit.tenantId), eq(s.reservations.id, credit.reservationId))); });
  } else if (status.status === "failed") await db.update(s.reservationCredits).set({ status: "failed", failureReason: status.reason ?? "Payment failed", updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, credit.tenantId), eq(s.reservationCredits.id, credit.id)));
  return true;
}

export async function refundReservationCredit(tenantId: string, reservationId: string) {
  const [credit] = await db.select().from(s.reservationCredits).where(and(eq(s.reservationCredits.tenantId, tenantId), eq(s.reservationCredits.reservationId, reservationId), eq(s.reservationCredits.status, "paid")));
  if (!credit) return { status: "none" as const };
  if (credit.refundStatus !== "none") return { status: credit.refundStatus };
  const gateway = await gatewayForOutletPayment(credit.tenantId, credit.outletId, credit.provider ?? "");
  if (!gateway || !credit.gatewayRef || !credit.gatewayPaymentId) return { status: "failed" as const };
  const result = await gateway.refund({ gatewayRef: credit.gatewayRef, gatewayPaymentId: credit.gatewayPaymentId, amountPaise: credit.paidPaise, refundId: credit.id });
  await db.update(s.reservationCredits).set({ refundGatewayRef: result.gatewayRefundId, refundStatus: result.status, status: result.status === "success" ? "refunded" : "paid", updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, tenantId), eq(s.reservationCredits.id, credit.id)));
  return { status: result.status };
}

export async function recordReservationRefundResult(provider: string, refundGatewayRef: string, status: "success" | "failed") {
  // isolation-exempt: the verified gateway refund reference names the credit row; tenant is read before mutation.
  const [credit] = await db.select().from(s.reservationCredits).where(and(eq(s.reservationCredits.provider, provider), eq(s.reservationCredits.refundGatewayRef, refundGatewayRef)));
  if (!credit) return false;
  if (credit.refundStatus === "success" || credit.refundStatus === "failed") return true;
  await db.update(s.reservationCredits).set({ refundStatus: status, status: status === "success" ? "refunded" : "paid", updatedAt: new Date() }).where(and(eq(s.reservationCredits.tenantId, credit.tenantId), eq(s.reservationCredits.id, credit.id)));
  return true;
}
