import { settleCashfreeFeeByGatewayRef } from "@/server/fees";
import { platformGateway } from "@/server/payments/gateway";
import { readRequestTextLimited } from "@/server/http-body";

/** Cashfree payment webhook for Tableeqr plan fees. Replays are safe and idempotent. */
export async function POST(request: Request) {
  const gateway = platformGateway();
  if (!gateway) return Response.json({ error: "Cashfree is not configured" }, { status: 503 });
  const raw = await readRequestTextLimited(request, 1_048_576);
  if (raw === null) return Response.json({ error: "Payload too large" }, { status: 413 });
  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");
  if (!gateway.verifyWebhook(raw, signature, timestamp)) return Response.json({ error: "Bad signature" }, { status: 401 });

  let event;
  try {
    event = gateway.parseWebhook(raw);
  } catch {
    return Response.json({ error: "Bad payload" }, { status: 400 });
  }
  if (event.kind !== "payment") return Response.json({ ok: true, ignored: true });
  try {
    const result = await settleCashfreeFeeByGatewayRef(event.gatewayRef, {
      status: event.status,
      amountPaise: event.amountPaise,
      currency: event.currency,
      gatewayPaymentId: event.gatewayPaymentId,
      reason: event.reason,
    });
    return Response.json({ ok: true, known: !!result });
  } catch (error) {
    console.error("[fees] Cashfree webhook failed", error);
    return Response.json({ error: "Try again" }, { status: 500 });
  }
}
