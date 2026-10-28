import { requestOrigin } from "@/server/request-host";
import { reconcileCashfreeFee } from "@/server/fees";
import { reconcileMessageCreditPurchase } from "@/server/whatsapp/credits";

/** Cashfree sends the restaurant back here; the server asks Cashfree for the actual result. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const paymentId = url.searchParams.get("p") ?? "";
  const planPayment = /^[0-9a-f-]{36}$/.test(paymentId) ? await reconcileCashfreeFee(paymentId).catch(() => null) : null;
  const creditPayment = !planPayment && /^[0-9a-f-]{36}$/.test(paymentId) ? await reconcileMessageCreditPurchase(paymentId).catch(() => null) : null;
  const baseOrigin = requestOrigin(request.headers, url.host);
  const destination = creditPayment ? `/console/broadcasts?creditPurchase=${encodeURIComponent(paymentId)}` : `/console/plan${paymentId ? `?payment=${encodeURIComponent(paymentId)}` : ""}`;
  return Response.redirect(new URL(destination, baseOrigin), 303);
}
