import { AppError } from "@/server/errors";
import { confirmByGatewayRef, recordRefundResult } from "@/server/billing/payments";
import { gatewayByName } from "@/server/payments/gateway";

/**
 * Gateway webhook (PS 6.4, 10.1). The signature over the exact raw body is checked before
 * anything is read; only then does the event move money state. Replays are harmless: confirming
 * a payment or a refund twice changes nothing the second time.
 */
export async function POST(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const gateway = gatewayByName(provider);
  if (!gateway) return Response.json({ error: "Unknown gateway" }, { status: 404 });
  const raw = await request.text();
  const signature = request.headers.get(provider === "razorpay" ? "x-razorpay-signature" : "x-mock-signature");
  if (!gateway.verifyWebhook(raw, signature)) return Response.json({ error: "Bad signature" }, { status: 401 });

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
        gatewayPaymentId: event.gatewayPaymentId,
        reason: event.reason,
      });
      return Response.json({ ok: true, known: !!res });
    }
    if (event.kind === "refund") {
      return Response.json({ ok: true, known: await recordRefundResult(gateway.name, event) });
    }
    return Response.json({ ok: true, ignored: true });
  } catch (err) {
    // A known, final refusal (e.g. reference mismatch) is acknowledged so the gateway stops retrying
    if (err instanceof AppError) return Response.json({ ok: false, error: err.code });
    console.error("[payments] webhook failed", err);
    return Response.json({ error: "Try again" }, { status: 500 });
  }
}
