"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { broadcastVariableCount } from "@/domain/broadcast";
import type { BroadcastSegment } from "@/db/schema/broadcast";
import type { broadcastWorkspace } from "@/server/whatsapp/campaigns";
import type { whatsappOverview } from "@/server/whatsapp/accounts";
import type { messageCreditPrice, messageCreditPurchaseHistory } from "@/server/whatsapp/credits";
import { openCheckout } from "@/lib/payments/checkout";
import { buyMessageCreditsAction, cancelCampaignAction, createCampaignAction, previewCampaignAudienceAction, refreshMessageCreditPurchaseAction, startDraftAction, uploadBroadcastPhotoAction } from "./actions";

type Workspace = Awaited<ReturnType<typeof broadcastWorkspace>>;
type Template = Awaited<ReturnType<typeof whatsappOverview>>["templates"][number];
type CreditPricing = Awaited<ReturnType<typeof messageCreditPrice>>;
type CreditPurchase = Awaited<ReturnType<typeof messageCreditPurchaseHistory>>[number];
const inputClass = "block w-full rounded-lg border bg-transparent p-2 text-sm";
const buttonClass = "rounded-lg border px-4 py-2 text-sm disabled:opacity-50";
export function CampaignComposer({ workspace, templates, connected, defaultOutletId, owner, creditPricing, creditPurchases }: { workspace: Workspace; templates: Template[]; connected: boolean; defaultOutletId: string; owner: boolean; creditPricing: CreditPricing; creditPurchases: CreditPurchase[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pack, setPack] = useState(creditPricing?.packSizes[0] ?? 0);
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditError, setCreditError] = useState<string | null>(null);
  const purchaseRequest = useRef<{ credits: number; id: string } | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [variables, setVariables] = useState<string[]>([]);
  const [photo, setPhoto] = useState("");
  const [offer, setOffer] = useState("");
  const [link, setLink] = useState("");
  const [outletId, setOutletId] = useState(defaultOutletId);
  const [filters, setFilters] = useState({ recent: "", away: "", visits: "", spend: "", birthday: "", channel: "", first: false });
  const segment: BroadcastSegment = { outletId: outletId || null, visitedWithinDays: filters.recent ? Number(filters.recent) : null, notSeenForDays: filters.away ? Number(filters.away) : null, minVisits: filters.visits ? Number(filters.visits) : null, minSpendPaise: filters.spend ? Math.round(Number(filters.spend) * 100) : null, firstTimersOnly: filters.first, birthday: filters.birthday === "week" || filters.birthday === "month" ? filters.birthday : null, channel: filters.channel === "dine_in" || filters.channel === "delivery" || filters.channel === "booking" ? filters.channel : null };
  const signature = JSON.stringify(segment);
  const [preview, setPreview] = useState<{ signature: string; count: number; error: string | null } | null>(null);
  const lastRequest = useRef<{ fingerprint: string; requestId: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await previewCampaignAudienceAction(JSON.parse(signature));
        if (!cancelled) setPreview({ signature, count: result.data?.count ?? 0, error: result.error });
      } catch { if (!cancelled) setPreview({ signature, count: 0, error: "Audience preview could not load. Change a filter to retry." }); }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [signature]);
  useEffect(() => {
    const attempted = purchaseRequest.current;
    if (attempted && creditPurchases.some((purchase) => purchase.id === attempted.id && purchase.status !== "claimed")) purchaseRequest.current = null;
  }, [creditPurchases]);
  const live = preview?.signature === signature ? preview : null;
  const approved = templates.filter((t) => t.status === "approved" && t.category === "MARKETING");
  const template = approved.find((t) => t.id === templateId);
  let variableCount = 0;
  let templateError: string | null = null;
  if (template) { try { variableCount = broadcastVariableCount(template.body); } catch { templateError = "This template's variable format is not supported. Choose another template."; } }
  const timeZone = workspace.outlets.find((o) => o.id === (outletId || defaultOutletId))?.timezone ?? "Asia/Kolkata";
  const doAction = (work: () => Promise<{ error: string | null }>, message: string) => {
    setError(null); setNotice(null);
    start(async () => { try { const result = await work(); if (result.error) setError(result.error); else { setNotice(message); router.refresh(); } } catch { setError("The result is not confirmed. Refresh the campaign list before retrying."); } });
  };
  const buyCredits = async () => {
    if (!creditPricing || !pack) return;
    setCreditBusy(true); setCreditError(null);
    try {
      const requestId = purchaseRequest.current?.credits === pack ? purchaseRequest.current.id : crypto.randomUUID();
      purchaseRequest.current = { credits: pack, id: requestId };
      const result = await buyMessageCreditsAction({ credits: pack, requestId });
      if (result.error || !result.data) { setCreditError(result.error ?? "Checkout could not start."); setCreditBusy(false); return; }
      await openCheckout(result.data.checkout);
    } catch (err) {
      setCreditError(err instanceof Error ? err.message : "Cashfree checkout could not open. Refresh payment status before trying again.");
    } finally { setCreditBusy(false); }
  };
  return <section className="space-y-5 rounded-xl border bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Create campaign</h2><p className="text-sm">Available: <strong>{workspace.credits.toLocaleString("en-IN")} credits</strong></p></div>
    {creditPricing && workspace.credits <= creditPricing.lowBalanceThreshold && <p role="alert" className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">Low message-credit balance. {workspace.credits} left; add a pack before your next broadcast.</p>}
    <div className="space-y-3 rounded-lg border p-3"><h3 className="font-semibold">Buy message credits</h3>{creditPricing ? <><div className="flex flex-wrap items-end gap-3"><label className="text-sm">Credit pack<select className={inputClass} value={pack} onChange={(e) => { const credits = Number(e.target.value); setPack(credits); purchaseRequest.current = null; }} disabled={creditBusy}>{creditPricing.packSizes.map((credits) => <option key={credits} value={credits}>{credits.toLocaleString("en-IN")} credits · ₹{(credits * creditPricing.pricePerCreditPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</option>)}</select></label><button className={buttonClass} onClick={() => void buyCredits()} disabled={creditBusy || !pack}>{creditBusy ? "Opening Cashfree…" : "Pay with Cashfree"}</button></div><p className="text-xs text-muted-foreground">Payment goes to Tableeqr through its platform Cashfree account. Credits are added only after Cashfree confirms.</p></> : <p className="text-sm text-muted-foreground">Online packs are not set up yet. Ask Tableeqr to enable credit-pack pricing; the platform admin can still grant credits.</p>}
      {creditError && <p role="alert" className="text-sm text-red-600">{creditError}</p>}
      {creditPurchases.length > 0 && <div className="space-y-2 border-t pt-3"><p className="text-sm font-medium">Recent credit purchases</p>{creditPurchases.map((purchase) => <div className="flex flex-wrap items-center justify-between gap-2 text-sm" key={purchase.id}><span>{purchase.credits.toLocaleString("en-IN")} credits · ₹{(purchase.amountPaise / 100).toLocaleString("en-IN")} · {purchase.status}</span>{purchase.status === "claimed" && <button className={buttonClass} disabled={creditBusy} onClick={() => { setCreditBusy(true); void refreshMessageCreditPurchaseAction(purchase.id).then((result) => { if (result.error) setCreditError(result.error); else router.refresh(); }).finally(() => setCreditBusy(false)); }}>Refresh payment</button>}</div>)}</div>}
    </div>
    <p className="text-sm text-muted-foreground">One Tableeqr credit per recipient. Meta charges your WhatsApp account separately. Sending waits between 9 PM and 9 AM in the campaign&apos;s outlet time zone.</p>
    {error && <p className="text-sm text-red-600" role="alert">{error}</p>}{notice && <p className="text-sm text-green-700" role="status">{notice}</p>}
    <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault();
      if (!template || !live || live.error) return;
      const form = new FormData(event.currentTarget);
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      const intent = submitter?.value === "draft" ? "draft" : submitter?.value === "schedule" ? "schedule" : "send";
      const values = { name: String(form.get("name") ?? ""), templateId, outletId: outletId || null, variables: Array.from({ length: variableCount }, (_, i) => variables[i] ?? ""), headerMediaUrl: photo || null, offerCode: offer || null, linkUrl: link || null, segment, audienceLimit: Math.max(1, live.count), intent, scheduledLocal: String(form.get("schedule") ?? "") || null } as const;
      const fingerprint = JSON.stringify(values);
      if (!lastRequest.current || lastRequest.current.fingerprint !== fingerprint) lastRequest.current = { fingerprint, requestId: crypto.randomUUID() };
      const requestId = lastRequest.current.requestId;
      if (intent !== "draft" && !window.confirm(`${intent === "schedule" ? "Schedule" : "Start"} a campaign for up to ${live.count} customers (${live.count} credits)? Scheduled audience is rechecked when sending starts.`)) return;
      doAction(() => createCampaignAction({ ...values, requestId }), intent === "draft" ? "Draft saved." : "Campaign queued. The scheduler will process it during sending hours.");
    }}>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Campaign name<input className={inputClass} name="name" maxLength={120} required /></label><label className="text-sm">Approved marketing template<select className={inputClass} required value={templateId} onChange={(e) => { setTemplateId(e.target.value); setVariables([]); setPhoto(""); }}><option value="">Choose template</option>{approved.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}</select></label></div>
      {!connected && <p className="text-sm">Connect WhatsApp above to send a campaign.</p>}
      {templateError && <p role="alert">{templateError}</p>}
      {template && <div className="space-y-3 rounded-lg border p-3"><p className="whitespace-pre-wrap text-sm">{template.body}</p>{Array.from({ length: variableCount }, (_, i) => <label className="block text-sm" key={i}>Value for {`{{${i + 1}}}`}<input className={inputClass} value={variables[i] ?? ""} onChange={(e) => setVariables((old) => { const next = [...old]; next[i] = e.target.value; return next; })} maxLength={900} placeholder="Use {name}, {offer} or {link} to personalise" required /></label>)}
        {template.header !== "none" && <div className="space-y-2"><label className="block text-sm">{template.header === "image" ? "Photo/banner HTTPS link" : "Video HTTPS link"}<input className={inputClass} type="url" value={photo} onChange={(e) => setPhoto(e.target.value)} required /></label>{template.header === "image" && <label className="block text-sm">Or upload a photo (JPG/PNG/WebP, up to 2 MB)<input className="block py-2" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const form = new FormData(); form.set("photo", file); doAction(async () => { const result = await uploadBroadcastPhotoAction(form); if (!result.error && result.data) setPhoto(result.data); return result; }, "Photo uploaded."); }} /></label>}</div>}
      </div>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Offer code (optional)<input className={inputClass} value={offer} onChange={(e) => setOffer(e.target.value)} maxLength={30} /></label><label className="text-sm">Link / complete approved button URL (optional)<input className={inputClass} type="url" value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} /></label></div>
      <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">Audience — all selected rules must match</legend>
        <label className="text-sm">Outlet<select className={inputClass} value={outletId} onChange={(e) => setOutletId(e.target.value)}>{owner && <option value="">All outlets</option>}{workspace.outlets.map((o) => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>
        {([ ["recent", "Visited in last (days)"], ["away", "Not seen for (days)"], ["visits", "Minimum visits"], ["spend", "Minimum paid spend (₹)"] ] as const).map(([key, label]) => <label className="text-sm" key={key}>{label}<input className={inputClass} type="number" min={key === "recent" || key === "away" ? 1 : 0} value={filters[key]} onChange={(e) => setFilters((old) => ({ ...old, [key]: e.target.value }))} /></label>)}
        <label className="text-sm">Birthday<select className={inputClass} value={filters.birthday} onChange={(e) => setFilters((old) => ({ ...old, birthday: e.target.value }))}><option value="">Any</option><option value="week">This week</option><option value="month">This month</option></select></label>
        <label className="text-sm">Activity<select className={inputClass} value={filters.channel} onChange={(e) => setFilters((old) => ({ ...old, channel: e.target.value }))}><option value="">All customers</option><option value="dine_in">Dined in</option><option value="delivery">Ordered delivery</option><option value="booking">Booked a table</option></select></label>
        <label className="text-sm"><input type="checkbox" checked={filters.first} onChange={(e) => setFilters((old) => ({ ...old, first: e.target.checked }))} /> First-time visitors only</label>
      </fieldset>
      <div role="status" className="rounded-lg border p-3 text-sm">{!live ? "Calculating audience…" : live.error ? live.error : `${live.count.toLocaleString("en-IN")} eligible customers · maximum ${live.count.toLocaleString("en-IN")} credits`}{live && !live.error && live.count > workspace.credits && <p>Add credits before sending; this campaign exceeds your balance.</p>}</div>
      <label className="block text-sm">Schedule date/time ({timeZone})<input className={inputClass} name="schedule" type="datetime-local" /></label>
      <div className="flex flex-wrap gap-2"><button className={buttonClass} type="submit" value="draft" disabled={pending || !template || !live || !!live.error || !!templateError}>Save draft</button><button className={buttonClass} type="submit" value="send" disabled={pending || !connected || !template || !live?.count || !!live?.error || !!templateError || (live?.count ?? 0) > workspace.credits}>Send now</button><button className={buttonClass} type="submit" value="schedule" disabled={pending || !connected || !template || !live?.count || !!live?.error || !!templateError}>Schedule</button></div>
    </form>
    <div className="space-y-3 border-t pt-4"><div className="flex items-center justify-between"><h3 className="font-semibold">Recent campaigns</h3><button className={buttonClass} onClick={() => router.refresh()}>Refresh status</button></div>
      {workspace.campaigns.length === 0 && <p className="text-sm text-muted-foreground">No campaigns yet.</p>}
      {workspace.campaigns.map((c) => <article className="space-y-2 rounded-lg border p-3 text-sm" key={c.id}><div className="flex flex-wrap justify-between gap-2"><strong>{c.name}</strong><span>{c.status}</span></div>{c.scheduledAt && <p>Scheduled: {new Date(c.scheduledAt).toLocaleString("en-IN", { timeZone: c.timezone })} ({c.timezone})</p>}<p>Audience {c.audienceCount} · Credits used {c.creditsUsed} · Sent {c.counts.sent ?? 0} · Delivered {c.counts.delivered ?? 0} · Read {c.counts.read ?? 0} · Queued {c.counts.queued ?? 0} · Failed/skipped {(c.counts.failed ?? 0) + (c.counts.skipped ?? 0)} · Needs review {c.counts.unknown ?? 0}</p>{c.startedAt && <p>Opt-outs after campaign: {c.report.optedOut} · Guests who ordered within 7 days: {c.report.returningGuests} · Offer-code redemptions on paid bills: {c.report.offerRedemptions}</p>}{c.failureReason && <p>{c.failureReason}</p>}<div className="flex gap-2">{c.status === "draft" && <button className={buttonClass} disabled={pending} onClick={() => { if (window.confirm("Start this saved draft? Credits will be reserved after rechecking its audience.")) doAction(() => startDraftAction(c.id), "Draft queued for sending."); }}>Start draft</button>}{["draft", "scheduled", "sending"].includes(c.status) && <button className={buttonClass} disabled={pending} onClick={() => { if (window.confirm("Cancel the remaining queue and refund its credits? An already sending message may still finish.")) doAction(() => cancelCampaignAction(c.id), "Remaining queue cancelled and credits refunded."); }}>Cancel campaign</button>}</div></article>)}
    </div>
  </section>;
}
