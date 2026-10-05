"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Banknote, BellRing, Check, CreditCard, PackagePlus, Printer, ReceiptText, RotateCcw, Search, Trash2, Users, Wallet, WifiOff } from "lucide-react";
import type { PosBillDetail, PosQueue } from "@/server/staff/pos-read";
import * as actions from "@/server/staff/pos-actions";
import { connectRealtime } from "@/lib/realtime-client";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/app/(console)/console/login/actions";
import { AddItemsDialog } from "./add-items-dialog";
import { billHtml, printHtml } from "./bill-print";
import { RefundPanel } from "./refund-panel";

type Card = { sessionId: string; tableCode: string; status: string; totalPaise: number; paidPaise: number; balancePaise: number; partySize: number; requestedAt: number | null; pendingOnline: boolean; payAtCounter?: boolean };
type Sheet = { kind: "pay" } | { kind: "reopen" } | { kind: "void"; lineId: string } | null;

const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const quiet = cn(buttonVariants({ variant: "secondary" }), "h-11 gap-2 border border-border px-4 text-sm");
const brand = cn(buttonVariants({ variant: "default" }), "h-11 gap-2 px-4 text-sm hover:bg-primary/90");
const field = "mt-1 block min-h-11 w-full rounded-input border border-line bg-surface px-3 text-body text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-ink/20";

export function BillingScreen({ initial, realtimeUrl, embedded = false }: { initial: PosQueue; realtimeUrl: string | null; embedded?: boolean }) {
  const [queue, setQueue] = useState(initial);
  const [detail, setDetail] = useState<PosBillDetail | null>(null);
  const [tab, setTab] = useState<"due" | "paid">("due");
  const [search, setSearch] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [hi, setHi] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sheet, setSheet] = useState<Sheet>(null);
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [received, setReceived] = useState("");
  const [share, setShare] = useState("");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<{ change: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(false);
  const settleKey = useRef<string | null>(null);
  const detailId = useRef<string | null>(null);
  const L = (en: string, h: string) => (hi ? h : en);

  useEffect(() => { detailId.current = detail?.sessionId ?? null; }, [detail]);
  // Standalone /pos: dialogs live on <body>, so the console tokens must be on <html> there too
  useEffect(() => { if (embedded) return; const root = document.documentElement; root.classList.add("console-ui"); return () => root.classList.remove("console-ui"); }, [embedded]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    const q = await actions.queueAction();
    if (!q.ok) return;
    setQueue(q.data);
    setOffline(false);
    if (detailId.current) { const d = await actions.detailAction(detailId.current); if (d.ok) setDetail(d.data); }
  }, []);

  useEffect(() => {
    const stop = connectRealtime({ url: realtimeUrl, getToken: actions.tokenAction, pollMs: 20000, onResync: () => void refresh(), onEvents: () => void refresh(), onStatus: (s) => setOffline(s === "offline") });
    const poll = setInterval(() => void refresh(), 30000);
    const on = () => void refresh(); const off = () => setOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { stop(); clearInterval(poll); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [realtimeUrl, refresh]);

  const run = async <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, ok?: (v: T) => void | Promise<void>) => {
    if (offline || busy) return;
    setBusy(true); setMessage(null);
    try { const r = await fn(); if (!r.ok) setMessage({ tone: "bad", text: r.error }); else { await ok?.(r.data); await refresh(); } }
    catch { setOffline(true); setMessage({ tone: "bad", text: L("Connection lost. It is safe to try again.", "कनेक्शन टूट गया। फिर से कोशिश करें।") }); }
    finally { setBusy(false); }
  };

  const open = (id: string) => void run(() => actions.detailAction(id), (d) => { setDetail(d); setShare(""); });
  const closeSheet = () => { setSheet(null); setPhone(""); setPin(""); setReason(""); setReceived(""); setReference(""); setDone(null); settleKey.current = null; };

  const dueAll = queue.queue as Card[];
  const paidAll = queue.recent as Card[];
  const due = dueAll.filter((c) => `${c.tableCode} ${c.status}`.toLowerCase().includes(search.toLowerCase()));
  const paid = paidAll.filter((c) => c.tableCode.toLowerCase().includes(search.toLowerCase()));
  const toCollect = dueAll.reduce((n, c) => n + c.balancePaise, 0);
  const counterCount = dueAll.filter((c) => c.payAtCounter).length;
  const paidToday = paidAll.reduce((n, c) => n + c.totalPaise, 0);
  const asked = (c: Card) => (c.requestedAt ? Math.max(0, Math.floor((now - c.requestedAt) / 60_000)) : null);

  const pendingOnline = !!detail?.payments.some((p) => ["pending", "initiated"].includes(p.status));
  const dueNow = detail ? detail.shares.filter((s) => !share || s.participantId === share).reduce((n, s) => n + Math.max(0, s.amountPaise - s.paidPaise), 0) : 0;
  const canPay = !!detail?.bill && detail.status === "bill_requested" && !pendingOnline && dueNow > 0 && !offline;
  const paidSoFar = detail ? detail.payments.filter((p) => p.status === "success").reduce((n, p) => n + p.amountPaise + p.tipPaise, 0) : 0;
  const personName = (id: string | null) => detail?.people.find((p) => p.id === id)?.name ?? L("Table", "टेबल");
  const quick = detail ? [...new Set([dueNow, Math.ceil(dueNow / 5000) * 5000, Math.ceil(dueNow / 10000) * 10000, Math.ceil(dueNow / 50000) * 50000, Math.ceil(dueNow / 200000) * 200000])].filter((v) => v >= dueNow).slice(0, 5) : [];
  const receivedPaise = Math.round(Number(received || "0") * 100);
  const change = method === "cash" ? Math.max(0, receivedPaise - dueNow) : 0;
  const needApproval = !!detail?.needsApproval;
  const approval = phone && pin ? { phone, pin } : undefined;

  const pay = () => {
    if (!detail) return;
    settleKey.current ??= crypto.randomUUID();
    void run(() => actions.settleAction({ sessionId: detail.sessionId, method, forParticipantIds: share ? [share] : undefined, receivedPaise: method === "cash" ? receivedPaise : undefined, clientRequestId: settleKey.current!, externalReference: reference }),
      async (r) => { setDone({ change: r.changePaise }); const d = await actions.detailAction(detail.sessionId); if (d.ok) setDetail(d.data); });
  };
  const doReopen = () => detail && void run(() => actions.reopenAction(detail.sessionId, approval), async () => { closeSheet(); open(detail.sessionId); });
  const doVoid = () => { if (!detail || sheet?.kind !== "void") return; void run(() => actions.voidAction({ sessionId: detail.sessionId, lineId: sheet.lineId, reason, approval }), async () => { closeSheet(); open(detail.sessionId); }); };
  const print = (kind: "bill" | "receipt") => detail && printHtml(billHtml(detail, queue.identity.outlet, kind));

  const lines = detail?.lines ?? [];
  const live = lines.filter((l) => l.status !== "voided" && l.status !== "cancelled");
  const voidLine = sheet?.kind === "void" ? lines.find((l) => l.id === sheet.lineId) : null;
  const isPaidBill = detail?.bill?.status === "paid";

  return (
    <main lang={hi ? "hi" : "en"} className={`console-ui ${embedded ? "pb-6 text-ink" : "min-h-dvh bg-paper pb-10 text-ink"}`}>
      <div className={embedded ? "mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7" : "mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8"}>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption font-semibold text-muted">{queue.identity.outlet}{embedded ? "" : ` · ${queue.identity.name}`}</p>
            <h1 className="mt-1 flex items-center gap-3 font-display text-title font-bold">{L("Billing", "बिलिंग")}
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-semibold ${offline ? "bg-[var(--state-seated-soft)] text-[var(--state-seated-text)]" : "bg-[var(--state-available-soft)] text-[var(--state-available-text)]"}`}><span className={`size-1.5 rounded-full ${offline ? "bg-[var(--state-seated)]" : "animate-pulse bg-[var(--state-available)]"}`} aria-hidden="true" />{offline ? L("Offline", "ऑफ़लाइन") : L("Live", "लाइव")}</span>
            </h1>
          </div>
          <div className="flex gap-2">
            <button type="button" className={quiet} onClick={() => setHi(!hi)}>{hi ? "EN" : "हिंदी"}</button>
            {!embedded && <form action={signOutAction}><button className={quiet}>{L("Sign out", "बाहर निकलें")}</button></form>}
          </div>
        </header>

        {offline && <p role="status" className="mt-4 flex items-center gap-2 rounded-input border border-warning bg-[var(--state-held-soft)] p-3 text-body font-semibold text-[var(--state-held-text)]"><WifiOff className="size-4" aria-hidden="true" />{L("You are offline. Taking payments is paused until the connection is back.", "आप ऑफ़लाइन हैं। कनेक्शन आने तक भुगतान बंद हैं।")}</p>}
        {message && !sheet && <p role={message.tone === "bad" ? "alert" : "status"} className={`mt-4 rounded-input border p-3 text-body font-semibold ${message.tone === "bad" ? "border-danger text-danger" : "border-line"}`}>{message.text}</p>}

        <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([[Wallet, L("To collect", "वसूलना है"), rs(toCollect), "#c9482b"], [ReceiptText, L("Bills waiting", "बिल इंतज़ार में"), String(dueAll.length), "#315e9e"], [BellRing, L("Want to pay at counter", "काउंटर पर भुगतान"), String(counterCount), "#a74608"], [Check, L("Paid recently", "हाल में भुगतान"), rs(paidToday), "#237a68"]] as const).map(([Icon, label, v, tone]) => (
            <Card key={label} size="sm"><CardContent>
              <div className="flex items-start justify-between gap-2"><dt className="text-caption font-semibold text-muted">{label}</dt><span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${tone} 14%, var(--surface))`, color: tone }}><Icon className="size-4" aria-hidden="true" /></span></div>
              <dd className="mt-1 font-display text-[24px] leading-8 font-bold tabular">{v}</dd>
            </CardContent></Card>
          ))}
        </dl>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
          <section aria-label={L("Bills", "बिल")} className={detail ? "hidden lg:block" : ""}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input aria-label={L("Search tables", "टेबल खोजें")} className="h-11 w-full rounded-input border border-line bg-surface pl-9 pr-3 text-body outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-ink/20" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L("Search by table", "टेबल से खोजें")} />
            </div>
            <div role="tablist" className="mt-3 flex gap-2">
              {([["due", L("Needs payment", "भुगतान बाकी"), due.length], ["paid", L("Recently paid", "हाल में भुगतान"), paid.length]] as const).map(([k, label, n]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-11 flex-1 rounded-full border px-3 text-body font-semibold ${tab === k ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:text-ink"}`}>{label} <span className="tabular opacity-70">{n}</span></button>
              ))}
            </div>

            <ul className="mt-3 space-y-2.5">
              {(tab === "due" ? due : paid).map((c) => {
                const mins = asked(c);
                const sel = detail?.sessionId === c.sessionId;
                return (
                  <li key={c.sessionId}>
                    <button type="button" onClick={() => open(c.sessionId)} aria-pressed={sel} className={`block w-full rounded-card border bg-surface p-4 text-left transition-colors hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-brand ${sel ? "border-brand ring-2 ring-brand/30" : "border-line"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="font-display text-section font-bold">{L("Table", "टेबल")} {c.tableCode}</p><p className="mt-0.5 flex items-center gap-1.5 text-caption text-muted"><Users className="size-3.5" aria-hidden="true" />{c.partySize} {L("guests", "लोग")}{tab === "due" && mins !== null ? ` · ${L("bill asked", "बिल माँगा")} ${mins < 1 ? L("just now", "अभी") : `${mins} min`}` : ""}</p></div>
                        <p className="font-display text-section font-bold tabular">{tab === "due" ? rs(c.balancePaise) : rs(c.totalPaise)}</p>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {tab === "paid" && <span className="rounded-full bg-[var(--state-paid-soft)] px-2 py-0.5 text-caption font-semibold text-[var(--state-paid-text)]">{L("Paid", "भुगतान हुआ")}</span>}
                        {tab === "due" && c.payAtCounter && !c.pendingOnline && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--state-held-soft)] px-2 py-0.5 text-caption font-semibold text-[var(--state-held-text)]"><BellRing className="size-3" aria-hidden="true" />{L("Wants to pay at counter", "काउंटर पर भुगतान")}</span>}
                        {c.pendingOnline && <span className="rounded-full bg-[var(--state-cleaning-soft)] px-2 py-0.5 text-caption font-semibold text-[var(--state-cleaning-text)]">{L("Online payment being checked", "ऑनलाइन भुगतान जाँच में")}</span>}
                        {tab === "due" && c.paidPaise > 0 && <span className="rounded-full bg-[var(--state-available-soft)] px-2 py-0.5 text-caption font-semibold text-[var(--state-available-text)]">{L("Part paid", "आंशिक भुगतान")} {rs(c.paidPaise)}</span>}
                        {tab === "due" && c.status !== "bill_requested" && <span className="rounded-full bg-ink/10 px-2 py-0.5 text-caption font-semibold text-muted">{L("Still eating", "अभी खा रहे हैं")}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
              {(tab === "due" ? due : paid).length === 0 && (
                <li className="rounded-card border border-dashed border-line bg-surface px-5 py-10 text-center">
                  <span className="mx-auto grid size-12 place-items-center rounded-full bg-brand-soft text-brand"><ReceiptText className="size-6" aria-hidden="true" /></span>
                  <p className="mt-3 font-display text-section font-bold">{tab === "due" ? L("No bills to collect", "कोई बिल बाकी नहीं") : L("Nothing paid yet", "अभी कोई भुगतान नहीं")}</p>
                  <p className="mt-1 text-body text-muted">{tab === "due" ? L("When a table asks for the bill, it shows up here.", "जब कोई टेबल बिल माँगेगी, वह यहाँ दिखेगी।") : L("Bills paid in the last 24 hours show up here.", "पिछले 24 घंटे के भुगतान यहाँ दिखते हैं।")}</p>
                </li>
              )}
            </ul>
          </section>

          <section aria-label={L("Bill", "बिल")} className="min-w-0">
            {!detail ? (
              <div className="hidden min-h-72 items-center justify-center rounded-card border border-dashed border-line bg-surface p-8 text-center text-muted lg:flex">
                <div><span className="mx-auto grid size-14 place-items-center rounded-full bg-ink/5"><ReceiptText className="size-7" aria-hidden="true" /></span><p className="mt-3 font-display text-section font-bold text-ink">{L("Pick a table", "टेबल चुनें")}</p><p className="mt-1 text-body">{L("Open its bill to take payment, print it or fix an item.", "बिल खोलकर भुगतान लें, प्रिंट करें या आइटम ठीक करें।")}</p></div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
                  <button type="button" className="mb-3 inline-flex items-center gap-1.5 text-body font-semibold text-muted hover:text-ink lg:hidden" onClick={() => setDetail(null)}><ArrowLeft className="size-4" aria-hidden="true" />{L("All bills", "सभी बिल")}</button>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-title font-bold">{L("Table", "टेबल")} {detail.tableCode}</h2>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-body text-muted">
                        <span className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${isPaidBill ? "bg-[var(--state-paid-soft)] text-[var(--state-paid-text)]" : detail.status === "bill_requested" ? "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]" : "bg-[var(--state-seated-soft)] text-[var(--state-seated-text)]"}`}>{isPaidBill ? L("Paid", "भुगतान हुआ") : detail.status === "bill_requested" ? L("Bill asked", "बिल माँगा") : L("Still eating", "अभी खा रहे हैं")}</span>
                        {detail.people.length > 0 && <span>{detail.people.map((p) => p.name).join(", ")}</span>}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!isPaidBill && detail.status === "open" && <button type="button" className={quiet} disabled={offline} onClick={() => setAdding(true)}><PackagePlus className="size-4" aria-hidden="true" />{L("Add items", "आइटम जोड़ें")}</button>}
                      <button type="button" className={quiet} onClick={() => print(isPaidBill ? "receipt" : "bill")}><Printer className="size-4" aria-hidden="true" />{isPaidBill ? L("Print receipt", "रसीद प्रिंट") : L("Print bill", "बिल प्रिंट")}</button>
                      {!isPaidBill && <button type="button" className={brand} disabled={!canPay} onClick={() => { setMethod("cash"); setSheet({ kind: "pay" }); }}><Banknote className="size-4" aria-hidden="true" />{L("Take payment", "भुगतान लें")}</button>}
                    </div>
                  </div>
                  {detail.status === "open" && !isPaidBill && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-input bg-[var(--state-held-soft)] px-3 py-2.5 text-body text-[var(--state-held-text)]">
                      <p className="flex min-w-0 flex-1 items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{L("The guests have not asked for the bill. If they are done, or the request did not reach you, close the table's eating stage here.", "मेहमानों ने बिल नहीं माँगा। अगर वे खा चुके हैं, या अनुरोध नहीं पहुँचा, तो यहाँ से खाना बंद करें।")}</span></p>
                      <button type="button" className={quiet} disabled={offline} onClick={() => setClosing(true)}><Check className="size-4" aria-hidden="true" />{L("Guests are done · Get the bill", "खाना हो गया · बिल लें")}</button>
                    </div>
                  )}
                  {pendingOnline && <p className="mt-3 rounded-input bg-[var(--state-cleaning-soft)] px-3 py-2 text-body text-[var(--state-cleaning-text)]">{L("An online payment is being checked. Wait a moment before taking cash.", "ऑनलाइन भुगतान जाँच में है। नकद लेने से पहले थोड़ा रुकें।")}</p>}
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
                    <h3 className="font-display text-section font-bold">{L("Items", "आइटम")}</h3>
                    <ul className="mt-2 divide-y divide-line">
                      {lines.map((l) => {
                        const gone = l.status === "voided" || l.status === "cancelled";
                        return (
                          <li key={l.id} className="flex items-start justify-between gap-3 py-2.5 text-body">
                            <div className={`min-w-0 ${gone ? "text-muted line-through" : ""}`}><p><b className="tabular">{l.qty}</b> × {hi ? l.nameHi || l.name : l.name}</p><p className="text-caption text-muted no-underline">{L("for", "के लिए")} {personName(l.participantId)}{gone ? ` · ${L("removed", "हटाया")}` : ""}{!gone && l.note && /parcel|pack/i.test(l.note) ? <span className="ml-2 rounded-full bg-[var(--state-held-soft)] px-2 py-0.5 text-label font-semibold text-[var(--state-held-text)]">{L("Parcel", "पार्सल")}</span> : null}</p></div>
                            <div className="flex shrink-0 items-center gap-2"><span className={`tabular ${gone ? "text-muted line-through" : ""}`}>{rs(l.qty * l.unitPricePaise)}</span>
                              {!gone && !isPaidBill && <button type="button" aria-label={`${L("Remove", "हटाएँ")} ${l.name}`} title={L("Remove this item", "यह आइटम हटाएँ")} disabled={offline} onClick={() => setSheet({ kind: "void", lineId: l.id })} className="grid size-9 place-items-center rounded-input text-muted hover:bg-[var(--state-seated-soft)] hover:text-danger disabled:opacity-40"><Trash2 className="size-4" aria-hidden="true" /></button>}</div>
                          </li>
                        );
                      })}
                      {lines.length === 0 && <li className="py-6 text-center text-body text-muted">{L("No items on this bill.", "इस बिल में कोई आइटम नहीं।")}</li>}
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
                      <h3 className="font-display text-section font-bold">{L("Bill total", "बिल का कुल")}</h3>
                      <dl className="mt-2 space-y-1.5 text-body">
                        <div className="flex justify-between"><dt className="text-muted">{L("Items", "आइटम")} ({live.length})</dt><dd className="tabular">{rs(detail.bill?.subtotalPaise ?? 0)}</dd></div>
                        <div className="flex justify-between"><dt className="text-muted">{L("Tax", "कर")}</dt><dd className="tabular">{rs(detail.bill?.taxPaise ?? 0)}</dd></div>
                        {!!detail.bill?.serviceChargePaise && <div className="flex justify-between"><dt className="text-muted">{L("Service charge", "सर्विस चार्ज")}</dt><dd className="tabular">{rs(detail.bill.serviceChargePaise)}</dd></div>}
                        {!!detail.bill?.roundOffPaise && <div className="flex justify-between"><dt className="text-muted">{L("Round off", "राउंड ऑफ़")}</dt><dd className="tabular">{rs(detail.bill.roundOffPaise)}</dd></div>}
                        <div className="flex justify-between border-t border-line pt-2 font-display text-section font-bold"><dt>{L("Total", "कुल")}</dt><dd className="tabular">{rs(detail.bill?.totalPaise ?? 0)}</dd></div>
                        {paidSoFar > 0 && <div className="flex justify-between text-[var(--state-available-text)]"><dt>{L("Paid so far", "अब तक भुगतान")}</dt><dd className="tabular">− {rs(paidSoFar)}</dd></div>}
                        {!isPaidBill && <div className="flex justify-between rounded-input bg-brand-soft px-3 py-2 font-display text-section font-bold"><dt>{L("Still to pay", "बाकी")}</dt><dd className="tabular">{rs(detail.shares.reduce((n, s) => n + Math.max(0, s.amountPaise - s.paidPaise), 0))}</dd></div>}
                      </dl>
                    </div>

                    {!isPaidBill && detail.shares.length > 1 && (
                      <fieldset className="rounded-card border border-line bg-surface p-4 sm:p-5">
                        <legend className="px-1 font-display text-section font-bold">{L("Who is paying?", "कौन भुगतान कर रहा है?")}</legend>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" aria-pressed={!share} onClick={() => setShare("")} className={`min-h-11 rounded-input border px-3 text-body font-semibold ${!share ? "border-brand bg-brand-soft" : "border-line text-muted hover:text-ink"}`}>{L("Whole table", "पूरी टेबल")}</button>
                          {detail.shares.map((s) => { const left = Math.max(0, s.amountPaise - s.paidPaise); return (
                            <button key={s.id} type="button" disabled={left === 0} aria-pressed={share === s.participantId} onClick={() => setShare(s.participantId ?? "")} className={`min-h-11 rounded-input border px-3 text-left leading-tight disabled:opacity-40 ${share === s.participantId ? "border-brand bg-brand-soft" : "border-line hover:border-ink/40"}`}><span className="block text-body font-semibold">{personName(s.participantId)}</span><span className="block text-caption text-muted">{left ? rs(left) : L("Paid", "भुगतान हुआ")}</span></button>
                          ); })}
                        </div>
                      </fieldset>
                    )}

                    {!isPaidBill && detail.status === "bill_requested" && (
                      <button type="button" className={`${quiet} w-full`} disabled={offline} onClick={() => setSheet({ kind: "reopen" })}><RotateCcw className="size-4" aria-hidden="true" />{L("Guests want to add more — reopen bill", "और ऑर्डर करना है — बिल फिर खोलें")}</button>
                    )}
                  </div>
                </div>

                <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
                  <h3 className="mb-2 font-display text-section font-bold">{L("Payments and refunds", "भुगतान और रिफंड")}</h3>
                  {detail.payments.length === 0 && <p className="text-body text-muted">{L("No payment taken yet.", "अभी कोई भुगतान नहीं लिया।")}</p>}
                  <RefundPanel payments={detail.payments} needsApproval={detail.needsApproval} disabled={offline} hi={hi} onChanged={async () => { const d = await actions.detailAction(detail.sessionId); if (d.ok) setDetail(d.data); }} />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <Dialog open={!!sheet && !!detail} onOpenChange={(o) => { if (!o) closeSheet(); }}>
        <DialogContent className="no-scrollbar max-h-[92dvh] gap-0 overflow-y-auto p-5 sm:max-w-md">
          {sheet && detail && (<div>
            {sheet.kind === "pay" && done ? (
              <div className="text-center">
                <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--state-available-soft)] text-[var(--state-available-text)]"><Check className="size-8" aria-hidden="true" /></span>
                <h2 className="mt-3 font-display text-title font-bold">{L("Payment recorded", "भुगतान दर्ज हुआ")}</h2>
                {done.change > 0 && <div className="mt-4 rounded-card bg-brand-soft p-4"><p className="text-body text-muted">{L("Give back change", "वापस दें")}</p><p className="font-display text-[34px] leading-10 font-bold tabular">{rs(done.change)}</p></div>}
                <div className="mt-5 grid gap-2">
                  <button type="button" className={brand} onClick={() => print("receipt")}><Printer className="size-4" aria-hidden="true" />{L("Print receipt", "रसीद प्रिंट करें")}</button>
                  <button type="button" className={quiet} onClick={closeSheet}>{L("Done", "हो गया")}</button>
                </div>
              </div>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="font-display text-title font-bold">{sheet.kind === "pay" ? L("Take payment", "भुगतान लें") : sheet.kind === "reopen" ? L("Reopen the bill", "बिल फिर खोलें") : L("Remove this item", "यह आइटम हटाएँ")}</DialogTitle>
                  <DialogDescription>{L("Table", "टेबल")} {detail.tableCode}</DialogDescription>
                </DialogHeader>

                {sheet.kind === "pay" && (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-card bg-brand-soft p-4 text-center"><p className="text-body text-muted">{L("Amount to collect", "वसूलने की राशि")}{share ? ` · ${personName(share)}` : ""}</p><p className="font-display text-[36px] leading-10 font-bold tabular">{rs(dueNow)}</p></div>
                    <div className="grid grid-cols-2 gap-2">
                      {([["cash", Banknote, L("Cash", "नकद")], ["card", CreditCard, L("Card", "कार्ड")]] as const).map(([k, Icon, label]) => (
                        <button key={k} type="button" aria-pressed={method === k} onClick={() => setMethod(k)} className={`flex min-h-14 items-center justify-center gap-2 rounded-input border text-body font-semibold ${method === k ? "border-brand bg-brand-soft" : "border-line text-muted hover:text-ink"}`}><Icon className="size-5" aria-hidden="true" />{label}</button>
                      ))}
                    </div>
                    {method === "cash" ? (
                      <div>
                        <label className="block text-body font-semibold">{L("Cash received", "नकद मिला")}<input autoFocus className={`${field} text-xl font-bold tabular`} inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={String(dueNow / 100)} /></label>
                        <div className="mt-2 flex flex-wrap gap-2">{quick.map((v) => <button key={v} type="button" onClick={() => setReceived(String(v / 100))} className="min-h-10 rounded-full border border-line px-3.5 text-body font-semibold hover:border-ink/40">{v === dueNow ? L("Exact", "बराबर") : rs(v)}</button>)}</div>
                        <div className={`mt-3 flex items-center justify-between rounded-input px-3 py-2.5 ${receivedPaise >= dueNow && receivedPaise > 0 ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" : "bg-ink/5 text-muted"}`}><span className="text-body font-semibold">{receivedPaise > 0 && receivedPaise < dueNow ? L("Short by", "कम है") : L("Change to give", "वापस देना है")}</span><b className="font-display text-section tabular">{receivedPaise > 0 && receivedPaise < dueNow ? rs(dueNow - receivedPaise) : rs(change)}</b></div>
                      </div>
                    ) : (
                      <label className="block text-body font-semibold">{L("Slip or reference number", "स्लिप या रेफ़रेंस नंबर")} <span className="font-normal text-muted">({L("optional", "वैकल्पिक")})</span><input className={field} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. last 4 digits" /></label>
                    )}
                    {message?.tone === "bad" && <p role="alert" className="text-body font-semibold text-danger">{message.text}</p>}
                    <button type="button" className={`${brand} w-full text-button`} disabled={busy || offline || dueNow <= 0 || (method === "cash" && receivedPaise < dueNow)} onClick={pay}>{busy ? L("Saving…", "सहेज रहे हैं…") : `${L("Confirm", "पुष्टि करें")} · ${rs(dueNow)}`}</button>
                  </div>
                )}

                {sheet.kind === "void" && (
                  <div className="mt-4 space-y-3">
                    {voidLine && <p className="rounded-input bg-ink/5 px-3 py-2 text-body"><b>{voidLine.qty} × {voidLine.name}</b> · {rs(voidLine.qty * voidLine.unitPricePaise)}</p>}
                    <label className="block text-body font-semibold">{L("Why is it being removed?", "क्यों हटा रहे हैं?")}<textarea className={`${field} min-h-20`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></label>
                  </div>
                )}

                {(sheet.kind === "reopen" || sheet.kind === "void") && (
                  <div className="mt-3 space-y-3">
                    {sheet.kind === "reopen" && <p className="text-body text-muted">{L("The table goes back to ordering. Payments already taken stay.", "टेबल फिर से ऑर्डर पर चली जाएगी। लिए गए भुगतान बने रहेंगे।")}</p>}
                    {needApproval && <><p className="text-body text-muted">{L("A manager must approve this.", "इसके लिए मैनेजर की मंज़ूरी चाहिए।")}</p>
                      <label className="block text-body font-semibold">{L("Manager phone", "मैनेजर का फ़ोन")}<input className={field} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
                      <label className="block text-body font-semibold">{L("Manager PIN", "मैनेजर PIN")}<input className={field} type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} /></label></>}
                    {message?.tone === "bad" && <p role="alert" className="text-body font-semibold text-danger">{message.text}</p>}
                    <button type="button" className={`${brand} w-full`} disabled={busy || offline || (needApproval && !(phone && pin)) || (sheet.kind === "void" && !reason.trim())} onClick={sheet.kind === "reopen" ? doReopen : doVoid}>{L("Confirm", "पुष्टि करें")}</button>
                  </div>
                )}
              </>
            )}
          </div>)}
        </DialogContent>
      </Dialog>
      <Dialog open={closing && !!detail} onOpenChange={(o) => { if (!o) setClosing(false); }}>
        <DialogContent className="gap-3 p-5 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-title font-bold">{L("Close eating and get the bill?", "खाना बंद करके बिल लें?")}</DialogTitle>
            <DialogDescription>{L("No new orders can be added from the table after this. You can still reopen the bill if the guests want more.", "इसके बाद टेबल से नया ऑर्डर नहीं जुड़ेगा। मेहमान और माँगें तो बिल फिर खोल सकते हैं।")}</DialogDescription>
          </DialogHeader>
          {message?.tone === "bad" && <p role="alert" className="text-sm font-semibold text-destructive">{message.text}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={quiet} onClick={() => setClosing(false)}>{L("Not yet", "अभी नहीं")}</button>
            <button type="button" className={brand} disabled={busy || offline} onClick={() => detail && void run(() => actions.requestBillAction(detail.sessionId), async () => { setClosing(false); open(detail.sessionId); })}>{busy ? L("Please wait…", "रुकें…") : L("Yes, get the bill", "हाँ, बिल लें")}</button>
          </div>
        </DialogContent>
      </Dialog>
      {detail && <AddItemsDialog detail={detail} open={adding} hi={hi} onClose={() => setAdding(false)} onPlaced={async () => { await refresh(); }} />}
    </main>
  );
}
