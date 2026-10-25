import { AppError } from "@/server/errors";
import { confirmByGatewayRef, recordRefundResult } from "@/server/billing/payments";
import { outletGatewayForWebhook } from "@/server/payments/outlet-gateway";
import { recordReservationRefundResult } from "@/server/booking/credit";
import { confirmDeliveryGatewayPayment, recordDeliveryRefundResult } from "@/server/delivery/payment";
import { readRequestTextLimited } from "@/server/http-body";

/**
 * Gateway webhook (PS 6.4, 10.1). The signature over the exact raw body is checked before
 * anything is read; only then does the event move money state. Replays are harmless: confirming
 * a payment or a refund twice changes nothing the second time.
 */
export async function POST(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const raw = await readRequestTextLimited(request, 1_048_576);
  if (raw === null) return Response.json({ error: "Payload too large" }, { status: 413 });
  const gateway = await outletGatewayForWebhook(provider, raw);
  if (!gateway) return Response.json({ error: "Unknown or unconfigured gateway" }, { status: 404 });
  // Cashfree uses x-webhook-signature + x-webhook-timestamp; the mock uses x-mock-signature
  const signature = request.headers.get("x-webhook-signature") ?? request.headers.get("x-mock-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");
  if (!gateway.verifyWebhook(raw, signature, timestamp)) return Response.json({ error: "Bad signature" }, { status: 401 });

  let event;
  try {
    event = gateway.parseWebhook(raw);
  } catch {
    return Response.json({ error: "Bad payload" }, { status: 400 });
  }
  try {
    if (event.kind === "payment") {
      const res = await confirmByGatewayRef(gateway.name, {
        gatewayRef: event.gatewayRef,
        status: event.status,
        amountPaise: event.amountPaise,
        currency: event.currency,
        gatewayPaymentId: event.gatewayPaymentId,
        reason: event.reason,
      });
      const delivery = res ? false : await confirmDeliveryGatewayPayment(gateway.name, {
        gatewayRef: event.gatewayRef,
        status: event.status,
        amountPaise: event.amountPaise,
        currency: event.currency,
        gatewayPaymentId: event.gatewayPaymentId,
        reason: event.reason,
      });
      return Response.json({ ok: true, known: !!res || delivery });
    }
    if (event.kind === "refund") {
      const known = await recordRefundResult(gateway.name, event);
      return Response.json({ ok: true, known: known || await recordReservationRefundResult(gateway.name, event.gatewayRefundId, event.status) || await recordDeliveryRefundResult(gateway.name, event.gatewayRefundId, event.status) });
    }
    return Response.json({ ok: true, ignored: true });
  } catch (err) {
    // A known, final refusal (e.g. reference mismatch) is acknowledged so the gateway stops retrying
    if (err instanceof AppError) return Response.json({ ok: false, error: err.code });
    console.error("[payments] webhook failed", err);
    return Response.json({ error: "Try again" }, { status: 500 });
  }
}
