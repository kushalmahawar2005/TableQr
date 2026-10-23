"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Globe2, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCustomDomainAction, verifyCustomDomainAction } from "../actions";

export function CustomDomainSettings({ domain: initialDomain, token: initialToken, verifiedAt, canEdit }: {
  domain: string | null; token: string | null; verifiedAt: Date | null; canEdit: boolean;
}) {
  const [domain, setDomain] = useState(initialDomain ?? "");
  const [token, setToken] = useState(initialToken ?? "");
  const [verified, setVerified] = useState(!!verifiedAt);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function save() {
    start(async () => {
      const result = await saveCustomDomainAction(domain.trim());
      if (!result.ok) { setMessage(result.message); return; }
      setDomain(result.domain ?? "");
      setToken(result.token ?? "");
      setVerified(!!result.verified);
      setMessage(result.domain ? "Domain saved. Add the DNS TXT record below, then verify it." : "Custom domain removed.");
    });
  }

  function verify() {
    start(async () => {
      const result = await verifyCustomDomainAction();
      setMessage(result.message);
      if (result.ok) setVerified(true);
    });
  }

  const recordHost = domain ? `_tableqr-verify.${domain}` : "";
  const recordValue = token ? `tableqr-verify=${token}` : "";

  return <section className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface" aria-labelledby="custom-domain-heading">
    <header className="flex items-start gap-3 border-b border-line px-5 py-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink/5 text-ink"><Globe2 className="size-4" aria-hidden="true" /></span>
      <div><h2 id="custom-domain-heading" className="font-display text-section font-bold text-ink">Custom guest domain</h2>
        <p className="text-sm text-muted">Use a restaurant-owned domain for your menu and booking link.</p></div>
      {verified && <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-emerald-700"><CheckCircle2 className="size-4" />Verified</span>}
    </header>
    <div className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-2"><Label htmlFor="custom-domain">Domain</Label><Input id="custom-domain" value={domain} onChange={(event) => { setDomain(event.target.value); setVerified(false); }} placeholder="menu.example.com" disabled={!canEdit || busy} /></div>
        {canEdit && <button type="button" onClick={save} disabled={busy} className="h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save domain"}</button>}
      </div>
      {domain && token && !verified && <div className="rounded-xl border border-line bg-canvas p-4 text-sm">
        <p className="font-semibold text-ink">1. Add this DNS TXT record at your domain provider</p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-[7rem_1fr]">
          <dt className="text-muted">Type</dt><dd className="font-mono text-ink">TXT</dd>
          <dt className="text-muted">Name / Host</dt><dd className="break-all font-mono text-ink">{recordHost}</dd>
          <dt className="text-muted">Value</dt><dd className="break-all font-mono text-ink">{recordValue}</dd>
        </dl>
        <p className="mt-3 text-xs text-muted">2. Wait for DNS to update, then verify ownership. 3. Attach the domain to your app in Hostinger and enable HTTPS. The guest link switches to this domain after it is connected and secure.</p>
        {canEdit && <button type="button" onClick={verify} disabled={busy} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 font-semibold text-ink disabled:opacity-50">{busy && <LoaderCircle className="size-4 animate-spin" />}Verify DNS record</button>}
      </div>}
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
    </div>
  </section>;
}
