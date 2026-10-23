import { reconcileDeliveryPaymentById } from "@/server/delivery/payment";

async function handle(request: Request) {
  const url = new URL(request.url);
  const checkoutId = url.searchParams.get("c") ?? "";
  const outletCode = url.searchParams.get("o") ?? "";
  // The return URL only triggers a server-to-server status check; it never decides payment state.
  if (/^[0-9a-f-]{36}$/i.test(checkoutId)) {
    try { await reconcileDeliveryPaymentById(checkoutId); } catch { /* status can be checked again from the order page */ }
  }
  const base = url.origin.replace("0.0.0.0", "localhost");
  const back = /^[A-Z0-9_-]{1,32}$/i.test(outletCode)
    ? `/r/${encodeURIComponent(outletCode)}/delivery?payment=1`
    : "/";
  return Response.redirect(new URL(back, base), 303);
}

export const GET = handle;
export const POST = handle;
