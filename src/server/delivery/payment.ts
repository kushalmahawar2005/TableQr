import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { gatewayForOutletPayment } from "../payments/outlet-gateway";
import { deliveryCheckout, placePaidDeliveryOrder } from "./checkout";
import { deliveryOutlet, priceDeliveryCart } from "./catalog";

function noPayment(message: string) {
  return new AppError("invalid_state", message, { reason: "delivery_payment" });
}

type DeliveryVerdict = { gatewayRef: string; status: "success" | "failed"; amountPaise: number; gatewayPaymentId?: string; reason?: string };

/** Creates or resumes a hosted checkout using only the restaurant's own merchant account. */
export async function startDeliveryPayment(code: string, token: string, deviceId: string, callbackTemplate: string) {
  const { outlet, row } = await deliveryCheckout(code, token, deviceId);
  if (row.status !== "draft" || row.paymentMode !== "gateway") throw noPayment("This order is not set up for online prepayment.");
  if (!row.guestId || !row.verifiedAt || !row.name || !row.phone) throw new AppError("verification_required", "Verify your phone before paying for delivery.");
  if (row.paymentStatus === "failed" || row.paymentStatus.startsWith("refund")) throw noPayment("This payment could not be completed. Start a new delivery checkout or contact the restaurant.");
  const gateway = await gatewayForOutletPayment(outlet.tenantId, outlet.id, "cashfree") ?? (process.env.NODE_ENV !== "production" ? await gatewayForOutletPayment(outlet.tenantId, outlet.id, "mock") : null);
  if (!gateway) throw noPayment("This restaurant has not connected its own live Cashfree account for delivery payments.");

  const quote = await priceDeliveryCart(db, outlet, row.lines, row.address.pincode);
  if (quote.totalPaise !== row.totalPaise) throw new AppError("price_changed", "Prices or delivery charges changed. Please start checkout again and review the updated total.");

  let gatewayRef = row.gatewayRef;
  const callbackUrl = callbackTemplate.replaceAll("{checkoutId}", row.id);
  if (!gatewayRef) {
    gatewayRef = (await gateway.createOrder({
      paymentId: row.id,
      amountPaise: row.totalPaise,
      receipt: row.id,
      callbackUrl,
      customer: { id: row.guestId, phone: row.phone, name: row.name },
    })).gatewayRef;
    await db.update(s.deliveryCheckouts).set({ paymentProvider: gateway.name, gatewayRef, paymentStatus: "pending", paymentFailureReason: null })
      .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id), eq(s.deliveryCheckouts.status, "draft"), eq(s.deliveryCheckouts.paymentStatus, "none")));
    const [saved] = await db.select({ gatewayRef: s.deliveryCheckouts.gatewayRef }).from(s.deliveryCheckouts)
      .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    gatewayRef = saved?.gatewayRef ?? null;
  }
  if (!gatewayRef || row.paymentProvider && row.paymentProvider !== gateway.name) throw noPayment("The payment session could not be resumed. Please start a new delivery checkout.");
  const resolvedCallback = callbackTemplate.replaceAll("{checkoutId}", row.id);
  const checkout = await gateway.checkout({ gatewayRef, paymentId: row.id, amountPaise: row.totalPaise, method: "upi", outletName: outlet.name, callbackUrl: resolvedCallback });
  if (checkout.kind === "form" && checkout.fields.callback_url) checkout.fields.callback_url = checkout.fields.callback_url.replace("PLACEHOLDER", row.id);
  return { checkout, amountPaise: row.totalPaise };
}

/** Applies a signed webhook or server-fetched status. A browser callback can never mark an order paid. */
export async function confirmDeliveryGatewayPayment(provider: string, verdict: DeliveryVerdict, now = new Date()) {
  // isolation-exempt: signed webhook or verified gateway reference identifies the tenant checkout.
  const [row] = await db.select().from(s.deliveryCheckouts)
    .where(and(eq(s.deliveryCheckouts.paymentProvider, provider), eq(s.deliveryCheckouts.gatewayRef, verdict.gatewayRef))).limit(1);
  if (!row) return false;
  if (row.paymentStatus === "paid" || row.paymentStatus === "refunded" || row.paymentStatus === "refund_pending" || row.paymentStatus === "refund_failed") return true;
  const gateway = await gatewayForOutletPayment(row.tenantId, row.outletId, provider);
  if (!gateway) return false;
  if (verdict.status === "failed") {
    await db.update(s.deliveryCheckouts).set({ paymentStatus: "failed", paymentFailureReason: (verdict.reason ?? "Payment was not completed").slice(0, 200) })
      .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id), eq(s.deliveryCheckouts.paymentStatus, "pending")));
    return true;
  }

  // Check current availability and price before creating a kitchen ticket. If either changed
  // while the guest was on the payment page, return the captured amount through the same merchant.
  let canFulfil = verdict.amountPaise === row.totalPaise && !!verdict.gatewayPaymentId && row.status === "draft" && row.paymentMode === "gateway" && row.expiresAt > now;
  if (canFulfil) {
    try {
      const [outletRow] = await db.select({ code: s.outlets.code }).from(s.outlets).where(and(eq(s.outlets.tenantId, row.tenantId), eq(s.outlets.id, row.outletId)));
      if (!outletRow) throw new AppError("not_found", "Restaurant not found.");
      const outlet = await deliveryOutlet(outletRow.code, true, now);
      const quote = await priceDeliveryCart(db, outlet, row.lines, row.address.pincode, now);
      canFulfil = quote.totalPaise === row.totalPaise;
    } catch { canFulfil = false; }
  }

  if (!canFulfil) {
    const amountPaise = Number.isSafeInteger(verdict.amountPaise) && verdict.amountPaise > 0 ? verdict.amountPaise : row.totalPaise;
    if (!verdict.gatewayPaymentId) {
      await db.update(s.deliveryCheckouts).set({ paymentStatus: "refund_failed", paymentFailureReason: "Payment was captured but its receipt could not be verified. Contact the restaurant." })
        .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id)));
      return true;
    }
    try {
      const refund = await gateway.refund({ gatewayRef: row.gatewayRef!, gatewayPaymentId: verdict.gatewayPaymentId, amountPaise, refundId: row.id });
      await db.update(s.deliveryCheckouts).set({ gatewayPaymentId: verdict.gatewayPaymentId, paymentStatus: refund.status === "success" ? "refunded" : refund.status === "pending" ? "refund_pending" : "refund_failed", paymentFailureReason: "Delivery details or prices changed after payment. The amount is being returned.", refundGatewayRef: refund.gatewayRefundId, refundStatus: refund.status === "success" ? "success" : refund.status === "pending" ? "pending" : "failed" })
        .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    } catch (error) {
      console.error("[delivery-payment] automatic refund failed", error);
      await db.update(s.deliveryCheckouts).set({ gatewayPaymentId: verdict.gatewayPaymentId, paymentStatus: "refund_failed", paymentFailureReason: "Payment was received but the order could not be fulfilled. Contact the restaurant for a refund." })
        .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    }
    return true;
  }

  const claimed = await db.transaction(async tx => {
    const [locked] = await tx.select().from(s.deliveryCheckouts)
      .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id))).for("update");
    if (!locked || locked.paymentStatus === "paid" || locked.sessionId) return false;
    if (locked.gatewayRef !== verdict.gatewayRef || locked.paymentProvider !== provider || locked.totalPaise !== verdict.amountPaise) return false;
    await tx.update(s.deliveryCheckouts).set({ paymentStatus: "paid", gatewayPaymentId: verdict.gatewayPaymentId!, paymentFailureReason: null })
      .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    return true;
  }, LOCK_THEN_READ);
  if (claimed) {
    try {
      await placePaidDeliveryOrder(row.id, now);
    } catch (error) {
      // A second availability check inside order placement may fail under concurrency. Refund
      // rather than leave a captured payment with no kitchen order.
      try {
        const refund = await gateway.refund({ gatewayRef: row.gatewayRef!, gatewayPaymentId: verdict.gatewayPaymentId!, amountPaise: verdict.amountPaise, refundId: row.id });
        await db.update(s.deliveryCheckouts).set({ paymentStatus: refund.status === "success" ? "refunded" : refund.status === "pending" ? "refund_pending" : "refund_failed", paymentFailureReason: "The order could not be placed after payment. Contact the restaurant if the refund is not visible.", refundGatewayRef: refund.gatewayRefundId, refundStatus: refund.status === "success" ? "success" : refund.status === "pending" ? "pending" : "failed" })
          .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id)));
      } catch (refundError) {
        console.error("[delivery-payment] placement refund failed", refundError);
        await db.update(s.deliveryCheckouts).set({ paymentStatus: "refund_failed", paymentFailureReason: "Payment was received but the order could not be placed. Contact the restaurant for a refund." })
          .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id)));
      }
      console.error("[delivery-payment] paid order placement failed", error);
    }
  }
  return true;
}

export async function reconcileDeliveryPayment(code: string, token: string, deviceId: string, now = new Date()) {
  const { outlet, row } = await deliveryCheckout(code, token, deviceId, now);
  return reconcileRowPayment(row, outlet, now);
}

/** Callback endpoint has only a random checkout id; result still comes from the restaurant gateway. */
export async function reconcileDeliveryPaymentById(checkoutId: string, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(checkoutId)) return null;
  // isolation-exempt: opaque checkout UUID is supplied only to trigger a server-side gateway status lookup.
  const [row] = await db.select().from(s.deliveryCheckouts).where(eq(s.deliveryCheckouts.id, checkoutId)).limit(1);
  if (!row) return null;
  const [outlet] = await db.select().from(s.outlets).where(and(eq(s.outlets.tenantId, row.tenantId), eq(s.outlets.id, row.outletId))).limit(1);
  if (!outlet) return null;
  const resolvedOutlet = await deliveryOutlet(outlet.code, false, now);
  return reconcileRowPayment(row, resolvedOutlet, now);
}

async function reconcileRowPayment(row: typeof s.deliveryCheckouts.$inferSelect, outlet: Awaited<ReturnType<typeof deliveryOutlet>>, now: Date) {
  if (row.paymentMode !== "gateway" || !row.paymentProvider || !row.gatewayRef) return row.paymentStatus;
  if (row.paymentStatus === "paid" && !row.sessionId) {
    await confirmDeliveryGatewayPayment(row.paymentProvider, { gatewayRef: row.gatewayRef, gatewayPaymentId: row.gatewayPaymentId ?? "", amountPaise: row.totalPaise, status: "success" }, now);
  } else if (["pending", "failed"].includes(row.paymentStatus)) {
    const gateway = await gatewayForOutletPayment(outlet.tenantId, outlet.id, row.paymentProvider);
    if (!gateway) return row.paymentStatus;
    try {
      const result = await gateway.fetchStatus(row.gatewayRef);
      if (result.status === "success" || result.status === "failed") await confirmDeliveryGatewayPayment(row.paymentProvider, { gatewayRef: row.gatewayRef, gatewayPaymentId: result.gatewayPaymentId, amountPaise: result.amountPaise, status: result.status, reason: result.reason }, now);
    } catch { /* keep pending; a slow gateway never turns a payment into a failure */ }
  }
  const [fresh] = await db.select({ paymentStatus: s.deliveryCheckouts.paymentStatus }).from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id)));
  return fresh?.paymentStatus ?? row.paymentStatus;
}

export async function recordDeliveryRefundResult(provider: string, gatewayRef: string, status: "success" | "failed") {
  // isolation-exempt: signed refund webhook reference identifies the tenant checkout.
  const [row] = await db.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.paymentProvider, provider), eq(s.deliveryCheckouts.refundGatewayRef, gatewayRef))).limit(1);
  if (!row) return false;
  if (row.refundStatus === "success" || row.refundStatus === "failed") return true;
  await db.update(s.deliveryCheckouts).set({ refundStatus: status, paymentStatus: status === "success" ? "refunded" : "refund_failed" })
    .where(and(eq(s.deliveryCheckouts.tenantId, row.tenantId), eq(s.deliveryCheckouts.id, row.id)));
  return true;
}
