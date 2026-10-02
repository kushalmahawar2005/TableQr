import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { mockAllowed, mockGateway, type GatewayStatus } from "@/server/payments/gateway";

export const metadata: Metadata = { title: "Test payment", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Stand-in for a gateway's hosted page, for development and tests only. Never in production
// unless PAYMENTS_MOCK=1 is set for a test deployment.
export default async function MockCheckout(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!mockAllowed()) notFound();
  const q = await props.searchParams;
  const ref = q.ref ?? "";
  const callback = q.callback ?? "";
  let callbackPath = callback;
  if (callback.startsWith("http://localhost:3000") || callback.startsWith("http://127.0.0.1:3000")) {
    try { const parsed = new URL(callback); callbackPath = `${parsed.pathname}${parsed.search}`; } catch { notFound(); }
  }
  if (!mockGateway.orderOf(ref) || !callbackPath.startsWith("/api/payments/return")) notFound();

  async function finish(form: FormData) {
    "use server";
    const outcome = String(form.get("outcome")) as GatewayStatus | "cancel";
    if (outcome === "cancel") redirect(`${callbackPath}&cancelled=1`);
    mockGateway.settle(ref, outcome);
    if (form.get("close") === "1") redirect("/");
    redirect(callbackPath);
  }

  const button = "w-full min-h-12 rounded-cta px-4 font-semibold";
  return (
    <main className="mx-auto max-w-[420px] p-6">
      <p className="text-caption font-semibold uppercase tracking-wide text-muted">Test gateway · no real money</p>
      <h1 className="mt-2 font-display text-title font-bold">Pay ₹{(Number(q.amount ?? 0) / 100).toLocaleString("en-IN")}</h1>
      <p className="mt-1 text-body text-muted">Method: {q.method}</p>
      <form action={finish} className="mt-6 grid gap-3">
        <button name="outcome" value="success" className={`${button} bg-success text-white`}>Pay successfully</button>
        <button name="outcome" value="failed" className={`${button} bg-danger text-white`}>Decline payment</button>
        <button name="outcome" value="pending" className={`${button} border border-line bg-surface`}>Bank still processing</button>
        <button name="outcome" value="cancel" className={`${button} border border-line bg-surface`}>Cancel and go back</button>
        <input type="hidden" name="close" value="0" />
      </form>
      <form action={finish} className="mt-3">
        <input type="hidden" name="outcome" value="success" />
        <input type="hidden" name="close" value="1" />
        <button className={`${button} border border-line bg-surface text-caption`}>Pay, then close the browser</button>
      </form>
    </main>
  );
}
