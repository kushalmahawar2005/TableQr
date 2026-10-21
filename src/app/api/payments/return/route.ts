import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { cancelIfUnattempted, reconcilePayment } from "@/server/billing/payments";

/**
 * Where the hosted checkout sends the guest back. Never trusted as the result: it only asks the
 * gateway, server to server, where the payment stands, then returns the guest to their bill,
 * which keeps checking. Works for the gateway's POST form return and for GET.
 */
async function handle(request: Request) {
  const url = new URL(request.url);
  const paymentId = url.searchParams.get("p") ?? "";
  const to = url.searchParams.get("to") ?? "";
  // Only back into a table page on this site: never an open redirect
  const back = /^\/r\/[A-Za-z0-9_-]+\/t\/[A-Za-z0-9_-]+\/bill$/.test(to) ? to : "/";
  let cancelled = url.searchParams.get("cancelled") === "1";
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    if (form?.get("error[code]") || form?.get("error[reason]")) cancelled = true;
  }
  // isolation-exempt: the payment id comes from our own callback URL; its tenant is read from the row
  const [payment] = /^[0-9a-f-]{36}$/.test(paymentId)
    ? await db.select({ tenantId: s.payments.tenantId }).from(s.payments).where(eq(s.payments.id, paymentId))
    : [];
  if (payment) {
    try {
      if (cancelled) await cancelIfUnattempted(payment, paymentId);
      else await reconcilePayment(payment, paymentId);
    } catch {
      // The bill page keeps checking; a slow gateway here must not strand the guest
    }
  }
  const baseOrigin = url.origin.replace("0.0.0.0", "localhost");
  return Response.redirect(new URL(`${back}${back === "/" ? "" : `?p=${encodeURIComponent(paymentId)}`}`, baseOrigin), 303);
}

export const GET = handle;
export const POST = handle;
