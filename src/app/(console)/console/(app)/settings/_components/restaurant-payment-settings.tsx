"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, LockKeyhole } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OutletSettings } from "@/server/staff/settings-read";
import { saveRestaurantCashfreeAction } from "../actions";

export function RestaurantPaymentSettings({ initial, canEdit }: { initial: OutletSettings["paymentGateway"]; canEdit: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [mode, setMode] = useState<"sandbox" | "production">(initial.mode ?? "sandbox");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function save() {
    start(async () => {
      const result = await saveRestaurantCashfreeAction({ mode, clientId: clientId.trim(), clientSecret });
      if (!result.ok) { setMessage(result.message); return; }
      setStatus(result.status);
      setClientId(""); setClientSecret("");
      setMessage("Cashfree credentials saved. The first checkout will confirm that Cashfree accepts them.");
      router.refresh();
    });
  }

  function remove() {
    start(async () => {
      const result = await saveRestaurantCashfreeAction(null);
      if (!result.ok) { setMessage(result.message); return; }
      setStatus(result.status);
      setMode("sandbox"); setClientId(""); setClientSecret("");
      setMessage("Business payment account disconnected.");
      router.refresh();
    });
  }

  return <section className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface" aria-labelledby="business-payments-heading">
    <header className="flex items-start gap-3 border-b border-line px-5 py-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink/5 text-ink"><CreditCard className="size-4" aria-hidden="true" /></span>
      <div className="min-w-0"><h2 id="business-payments-heading" className="font-display text-section font-bold text-ink">Online payments</h2>
        <p className="text-sm text-muted">Connect this outlet’s own Cashfree merchant account for guest payments.</p></div>
      <span className={`ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${status.configured ? "bg-emerald-500/10 text-emerald-700" : "bg-ink/5 text-muted"}`}>{status.configured ? "Saved" : "Not connected"}</span>
    </header>
    <div className="space-y-4 p-5">
      <div className="rounded-xl border border-line bg-ink/[0.02] p-4 text-sm text-muted">
        <p className="font-semibold text-ink">Payments go directly to your business.</p>
        <p className="mt-1">Use the App ID and Secret Key from your own Cashfree account. Tableeqr’s separate Cashfree account is used only for your Tableeqr subscription and is never used for guest payments.</p>
        {status.configured && <p className="mt-2">Saved account: {status.appIdHint} · {status.mode === "production" ? "Live" : "Test mode"}</p>}
        {status.configured && <p className="mt-1">Saved means the credentials are encrypted here; Cashfree still has to accept them for an order to work.</p>}
        {status.configured && !status.available && <p className="mt-1 text-amber-700">Test mode is saved, but live guest checkout stays unavailable on the production app.</p>}
      </div>
      {canEdit ? <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="merchant-cashfree-mode">Account mode</Label><select id="merchant-cashfree-mode" className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={mode} onChange={event => setMode(event.target.value as "sandbox" | "production")} disabled={busy}><option value="sandbox">Test / Sandbox</option><option value="production">Live payments</option></select></div>
        <div className="space-y-2"><Label htmlFor="merchant-cashfree-id">Cashfree App ID</Label><Input id="merchant-cashfree-id" autoComplete="off" value={clientId} onChange={event => setClientId(event.target.value)} placeholder={status.appIdHint ?? "From your Cashfree account"} disabled={busy} /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="merchant-cashfree-secret">Cashfree Secret Key</Label><Input id="merchant-cashfree-secret" type="password" autoComplete="new-password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} placeholder="Secret is never displayed after saving" disabled={busy} /></div>
      </div> : <p className="text-sm text-muted">Only the outlet owner can connect payment credentials.</p>}
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && <button type="button" onClick={save} disabled={busy || !clientId.trim() || !clientSecret} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white disabled:opacity-50"><LockKeyhole className="size-4" />{busy ? "Saving securely…" : status.configured ? "Update merchant account" : "Connect merchant account"}</button>}
        {canEdit && status.configured && <button type="button" onClick={remove} disabled={busy} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50">Disconnect</button>}
        {message && <p role="status" className="text-sm text-muted">{message}</p>}
      </div>
      <p className="text-xs text-muted">Credentials are encrypted on the server. Live mode requires a secure HTTPS guest link and a server PAYMENT_CREDENTIALS_KEY configured by the Tableeqr administrator.</p>
    </div>
  </section>;
}
