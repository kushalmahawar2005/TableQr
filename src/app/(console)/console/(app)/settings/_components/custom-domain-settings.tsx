"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, ExternalLink, Globe2, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { customDomainProofRecord } from "@/domain/custom-domain-proof";
import { saveCustomDomainAction, setCustomDomainLiveAction, verifyCustomDomainAction } from "../actions";

export function CustomDomainSettings({ domain: initialDomain, token: initialToken, verifiedAt, live: initialLive, dnsTarget, canEdit }: {
  domain: string | null; token: string | null; verifiedAt: Date | null; live: boolean; dnsTarget: string | null; canEdit: boolean;
}) {
  const [domain, setDomain] = useState(initialDomain ?? "");
  const [token, setToken] = useState(initialToken ?? "");
  const [verified, setVerified] = useState(!!verifiedAt);
  const [live, setLive] = useState(initialLive);
  const [confirmedHttps, setConfirmedHttps] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function save() {
    start(async () => {
      const result = await saveCustomDomainAction(domain.trim());
      if (!result.ok) { setMessage(result.message); return; }
      setDomain(result.domain ?? "");
      setToken(result.token ?? "");
      setVerified(!!result.verified);
      setLive(false);
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

  function setGuestLinkDomain(nextLive: boolean, confirmed = false) {
    start(async () => {
      const result = await setCustomDomainLiveAction(nextLive, confirmed);
      setMessage(result.message);
      if (result.ok) setLive(result.live);
    });
  }

  const proof = customDomainProofRecord(domain, token);
  const recordHost = domain ? proof.name : "";
  const recordValue = token ? proof.value : "";

  return <section className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface" aria-labelledby="custom-domain-heading">
    <header className="flex items-start gap-3 border-b border-line px-5 py-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink/5 text-ink"><Globe2 className="size-4" aria-hidden="true" /></span>
      <div><h2 id="custom-domain-heading" className="font-display text-section font-bold text-ink">Custom guest domain</h2>
        <p className="text-sm text-muted">Use a restaurant-owned domain for your menu and booking link.</p></div>
      {verified && <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 sm:text-sm"><CheckCircle2 className="size-4" />{live ? "Live for guests" : "DNS verified"}</span>}
    </header>
    <div className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-2"><Label htmlFor="custom-domain">Domain</Label><Input id="custom-domain" value={domain} onChange={(event) => { setDomain(event.target.value); setToken(""); setVerified(false); setLive(false); setMessage(null); }} placeholder="menu.example.com" disabled={!canEdit || busy} /></div>
        {canEdit && <button type="button" onClick={save} disabled={busy} className="h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save domain"}</button>}
      </div>
      {domain && token && !verified && <div className="rounded-xl border border-line bg-canvas p-4 text-sm">
        <p className="font-semibold text-ink">1. Prove domain ownership with this DNS TXT record</p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-[7rem_1fr]">
          <dt className="text-muted">Type</dt><dd className="font-mono text-ink">TXT</dd>
          <dt className="text-muted">Name / Host</dt><dd className="break-all font-mono text-ink">{recordHost}</dd>
          <dt className="text-muted">Value</dt><dd className="break-all font-mono text-ink">{recordValue}</dd>
        </dl>
        <p className="mt-3 text-xs text-muted">In Hostinger DNS, add the record for this exact domain. Keep the TXT record in place while the custom domain is active.</p>
        {canEdit && <button type="button" onClick={verify} disabled={busy} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 font-semibold text-ink disabled:opacity-50">{busy && <LoaderCircle className="size-4 animate-spin" />}Verify DNS record</button>}
      </div>}
      {domain && verified && <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <p className="font-semibold">2. Attach it to the Tableeqr app in Hostinger</p>
        <p>In hPanel, open the same Node.js app and add <span className="font-mono">{domain}</span> under its domains. Then add the DNS record Hostinger requires:</p>
        {dnsTarget ? <dl className="grid gap-2 rounded-lg bg-white/80 p-3 sm:grid-cols-[7rem_1fr]">
          <dt className="text-emerald-800">Type</dt><dd className="font-mono">CNAME</dd>
          <dt className="text-emerald-800">Host</dt><dd className="break-all font-mono">{domain}</dd>
          <dt className="text-emerald-800">Points to</dt><dd className="break-all font-mono">{dnsTarget}</dd>
        </dl> : <p className="rounded-lg bg-white/80 p-3">Set <span className="font-mono">CUSTOM_DOMAIN_CNAME_TARGET</span> to the exact target shown by Hostinger to display the DNS target here.</p>}
        <p className="text-xs">For a root/apex domain, use the ALIAS/ANAME or DNS-flattening option your provider supports; a standard CNAME may not be allowed there. If Hostinger shows a different target, use Hostinger&apos;s value.</p>
        <p className="font-semibold">3. Enable HTTPS, then test the guest page</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0">Wait for the SSL certificate, open the secure URL, and confirm it shows this restaurant before changing its guest links.</p>
          <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 font-semibold text-emerald-900 hover:bg-emerald-100"><ExternalLink className="size-4" aria-hidden="true" />Open guest site</a>
        </div>
        {canEdit && !live && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmedHttps} onChange={(event) => setConfirmedHttps(event.target.checked)} className="mt-1 accent-emerald-800" /><span>I opened the HTTPS guest page and confirmed the correct restaurant loads without a certificate warning.</span></label>}
        {canEdit && <button type="button" onClick={() => { const nextLive = !live; setConfirmedHttps(false); setGuestLinkDomain(nextLive, nextLive && confirmedHttps); }} disabled={busy || (!live && !confirmedHttps)} className="min-h-10 rounded-xl bg-emerald-800 px-4 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : live ? "Use Tableeqr links instead" : "Use this domain for guest links"}</button>}
        <p className="text-xs">If DNS ownership proof disappears, the custom URL safely redirects guests to the Tableeqr address. Turning this off also restores Tableeqr links and QR printouts.</p>
      </div>}
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
    </div>
  </section>;
}
