import { requestOrigin } from "@/server/request-host";
import { reconcileDeliveryPaymentById } from "@/server/delivery/payment";
import { readRequestBodyLimited } from "@/server/http-body";

async function handle(request: Request) {
  if (request.method === "POST" && (await readRequestBodyLimited(request, 65_536)) === null) {
    return new Response("Request body too large", { status: 413 });
  }
  const url = new URL(request.url);
  const checkoutId = url.searchParams.get("c") ?? "";
  const outletCode = url.searchParams.get("o") ?? "";
  // The return URL only triggers a server-to-server status check; it never decides payment state.
  if (/^[0-9a-f-]{36}$/i.test(checkoutId)) {
    try { await reconcileDeliveryPaymentById(checkoutId); } catch { /* status can be checked again from the order page */ }
  }
  const base = requestOrigin(request.headers, url.host);
  const back = /^[A-Z0-9_-]{1,32}$/i.test(outletCode)
    ? `/r/${encodeURIComponent(outletCode)}/delivery?payment=1`
    : "/";
  return Response.redirect(new URL(back, base), 303);
}

export const GET = handle;
export const POST = handle;
