import { reconcileCashfreeFee } from "@/server/fees";

/** Cashfree sends the restaurant back here; the server asks Cashfree for the actual result. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const paymentId = url.searchParams.get("p") ?? "";
  if (/^[0-9a-f-]{36}$/.test(paymentId)) await reconcileCashfreeFee(paymentId).catch(() => undefined);
  // Normalize 0.0.0.0 to localhost to prevent Chrome "ERR_CONNECTION_REFUSED" on local redirect
  const baseOrigin = url.origin.replace("0.0.0.0", "localhost");
  return Response.redirect(new URL(`/console/plan${paymentId ? `?payment=${encodeURIComponent(paymentId)}` : ""}`, baseOrigin), 303);
}
