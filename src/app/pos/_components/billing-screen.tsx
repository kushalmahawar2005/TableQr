"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Banknote, Bike, BellRing, Check, PackagePlus, Printer, ReceiptText, RotateCcw, Search, ShoppingBag, Smartphone, Trash2, Users, Wallet, WifiOff } from "lucide-react";
import type { PosBillDetail, PosQueue } from "@/server/staff/pos-read";
import * as actions from "@/server/staff/pos-actions";
import { connectRealtime } from "@/lib/realtime-client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PushAwareSignOutButton } from "@/components/push-aware-sign-out-button";
import { AddItemsDialog } from "./add-items-dialog";
import { usePrint } from "@/components/print/print-provider";
import { billHtml } from "./bill-print";
import { PaperToggle } from "./paper-toggle";
import { DISCOUNT_FREE_LIMIT_PERCENT, discountNeedsApproval } from "@/domain/discount-limit";
import { RefundPanel } from "./refund-panel";
import { columnHead, DetailHead, DetailSheet, Pill, primaryButton, QueuePanel, RowSelect, rowCells, rowTone, secondaryButton, Segmented, StatCards, waitText } from "@/app/(console)/console/(app)/orders/_components/orders-ui";
import { billMessage, whatsappLink, whatsappNumber } from "@/domain/bill-message";
import { isRoomCode } from "@/domain/rooms";
import { isDeliveryTable } from "@/domain/delivery";

type Card = { sessionId: string; itemCount?: number; tableCode: string; takeaway?: boolean; guestName?: string | null; status: string; totalPaise: number; paidPaise: number; balancePaise: number; partySize: number; requestedAt: number | null; pendingOnline: boolean; payAtCounter?: boolean; paidUpi?: boolean };
type Sheet = { kind: "pay" } | { kind: "reopen" } | { kind: "void"; lineId: string } | null;

const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const quiet = cn(secondaryButton, "h-11");
const brand = cn(primaryButton, "h-11");
const COLUMNS = { due: "lg:grid-cols-[minmax(0,1.3fr)_64px_72px_minmax(0,1.3fr)_72px_88px]", takeaway: "lg:grid-cols-[minmax(0,1.5fr)_80px_minmax(0,1fr)_88px]", paid: "lg:grid-cols-[minmax(0,1.5fr)_80px_minmax(0,1fr)_88px]" };
const SECTION = "border-b border-line px-5 py-4 last:border-b-0";
const SECTION_TITLE = "text-[11px] font-semibold uppercase tracking-wide text-muted";
const field = "mt-1 block min-h-11 w-full rounded-input border border-line bg-surface px-3 text-body text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-ink/20";

export function BillingScreen({ initial, realtimeUrl, embedded = false, openSession = null, preview = null }: { initial: PosQueue; realtimeUrl: string | null; embedded?: boolean; openSession?: string | null; /** Dev review board only: shows this bill and stays off the server */ preview?: PosBillDetail | null }) {
  const [queue, setQueue] = useState(initial);
  const [detail, setDetail] = useState<PosBillDetail | null>(preview);
  const [tab, setTab] = useState<"due" | "takeaway" | "paid">("due");
  const [search, setSearch] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [hi, setHi] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sheet, setSheet] = useState<Sheet>(null);
  const [method, setMethod] = useState<"cash" | "upi">("cash");
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
  /** What staff call the order: a delivery or takeaway by kind (their internal codes mean nothing), a room by number, else the table */
  const placeName = (code: string, takeaway?: boolean) => isDeliveryTable(code)
    ? <><Bike className="mr-1.5 inline size-4 align-[-2px]" aria-hidden="true" />{L("Delivery", "डिलीवरी")}</>
    : takeaway ? <><ShoppingBag className="mr-1.5 inline size-4 align-[-2px]" aria-hidden="true" />{L("Takeaway", "पार्सल")} {code.replace(/^TA-/, "")}</>
    : isRoomCode(code) ? code : `${L("Table", "टेबल")} ${code}`;

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
    if (preview) return;
    const stop = connectRealtime({ url: realtimeUrl, getToken: actions.tokenAction, pollMs: 20000, onResync: () => void refresh(), onEvents: () => void refresh(), onStatus: (s) => setOffline(s === "offline") });
    const poll = setInterval(() => void refresh(), 30000);
    const on = () => void refresh(); const off = () => setOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { stop(); clearInterval(poll); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [realtimeUrl, refresh, preview]);

  const run = async <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, ok?: (v: T) => void | Promise<void>) => {
    if (offline || busy) return;
    setBusy(true); setMessage(null);
    try { const r = await fn(); if (!r.ok) setMessage({ tone: "bad", text: r.error }); else { await ok?.(r.data); await refresh(); } }
    catch { setOffline(true); setMessage({ tone: "bad", text: L("Connection lost. It is safe to try again.", "कनेक्शन टूट गया। फिर से कोशिश करें।") }); }
    finally { setBusy(false); }
  };

  const open = (id: string) => void run(() => actions.detailAction(id), (d) => { setDetail(d); setShare(""); });
  // Sent here from the floor's "Take payment": that table's bill opens at once, asked for or not
  const opened = useRef(false);
  useEffect(() => {
    if (!openSession || opened.current) return;
    opened.current = true;
    void actions.detailAction(openSession).then((d) => { if (d.ok) setDetail(d.data); });
  }, [openSession]);
  // Wide screens have room for the bill beside the list, so the first one opens by itself
  useEffect(() => {
    if (openSession || preview || !window.matchMedia("(min-width: 1280px)").matches) return;
    const first = (initial.queue as Card[]).find((c) => !c.takeaway || c.status === "bill_requested");
    if (first) void actions.detailAction(first.sessionId).then((d) => { if (d.ok) setDetail((current) => current ?? d.data); });
  }, [initial, openSession, preview]);
  // A parcel for a guest at the counter: opens at once and goes straight to adding items
  const newTakeaway = () => void run(() => actions.startTakeawayAction(null), async (r) => { const d = await actions.detailAction(r.sessionId); if (d.ok) { setDetail(d.data); setShare(""); setAdding(true); } });
  const closeSheet = () => { setSheet(null); setPhone(""); setPin(""); setReason(""); setReceived(""); setReference(""); setDone(null); settleKey.current = null; };

  const dueAll = queue.queue as Card[];
  const paidAll = queue.recent as Card[];
  // Unbilled takeaways need item prep and tracking, not payment collection. Keep them in a
  // separate queue so “Bills waiting” and “To collect” only describe actual bills.
  const paymentQueue = dueAll.filter((c) => !c.takeaway || c.status === "bill_requested");
  const takeawayQueue = dueAll.filter((c) => c.takeaway && c.status !== "bill_requested");
  const due = paymentQueue.filter((c) => `${c.tableCode} ${c.guestName ?? ""} ${c.status}`.toLowerCase().includes(search.toLowerCase()));
  const takeaways = takeawayQueue.filter((c) => `${c.tableCode} ${c.guestName ?? ""} ${c.status}`.toLowerCase().includes(search.toLowerCase()));
  const paid = paidAll.filter((c) => `${c.tableCode} ${c.guestName ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const toCollect = paymentQueue.reduce((n, c) => n + c.balancePaise, 0);
  const counterCount = dueAll.filter((c) => c.payAtCounter).length;
  const shown = tab === "due" ? due : tab === "takeaway" ? takeaways : paid;
  const emptyTakeaways = takeawayQueue.filter((c) => !c.itemCount);
  const paidToday = paidAll.reduce((n, c) => n + c.totalPaise, 0);
  const asked = (c: Card) => (c.requestedAt ? Math.max(0, Math.floor((now - c.requestedAt) / 60_000)) : null);

  const pendingOnline = !!detail?.payments.some((p) => ["pending", "initiated"].includes(p.status));
  const dueNow = detail ? detail.shares.filter((s) => !share || s.participantId === share).reduce((n, s) => n + Math.max(0, s.amountPaise - s.paidPaise), 0) : 0;
  const canPay = !!detail?.bill && detail.status === "bill_requested" && !pendingOnline && dueNow > 0 && !offline;
  const paidSoFar = detail ? detail.payments.filter((p) => p.status === "success").reduce((n, p) => n + p.amountPaise + p.tipPaise, 0) : 0;
  const knownGuestPhones = detail ? [...new Set(detail.people.map((person) => whatsappNumber(person.phone ?? "")).filter((value): value is string => !!value))] : [];
  const defaultWhatsAppPhone = knownGuestPhones.length === 1 ? knownGuestPhones[0] : "";
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
  const printer = usePrint().manager;
  const print = (kind: "bill" | "receipt") => detail && void printer.print({ kind, subject: { type: "session", id: detail.sessionId }, build: (paper) => billHtml(detail, queue.identity.outlet, kind, paper) });

  const lines = detail?.lines ?? [];
  const live = lines.filter((l) => l.status !== "voided" && l.status !== "cancelled");
  const voidLine = sheet?.kind === "void" ? lines.find((l) => l.id === sheet.lineId) : null;
  const isPaidBill = detail?.bill?.status === "paid";
  // A takeaway with nothing on it has no bill to print, send or pay yet
  const emptyDraft = !!detail?.takeaway && detail.status === "open" && live.length === 0 && !isPaidBill;
  const canAddItems = !isPaidBill && !emptyDraft && !!detail && (detail.status === "open" || (detail.status === "bill_requested" && paidSoFar === 0 && !pendingOnline));
  // Until the bill is made its totals are zero, so an order in progress shows what its items add up to
  const billMade = !!detail?.bill && detail.bill.totalPaise > 0;
  const runningPaise = live.reduce((n, l) => n + l.qty * l.unitPricePaise, 0);
  const removeEmptyTakeaways = () => void run(async () => {
    for (const c of emptyTakeaways) { const r = await actions.cancelTakeawayAction(c.sessionId); if (!r.ok) return r; }
    return { ok: true as const, data: null };
  }, () => { if (emptyDraft) setDetail(null); });

  return (
    <main lang={hi ? "hi" : "en"} className={`console-ui text-ink ${embedded ? "" : "min-h-dvh"}`}>
      <div className={`dashboard-theme bg-dashboard-canvas ${embedded ? "min-h-[calc(100dvh-4rem)] sm:min-h-[calc(100dvh-4.5rem)]" : "min-h-dvh"}`}>
      <div className="mx-auto w-full max-w-[1440px] px-3 py-3 pb-6 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {!embedded && <p className="text-caption font-semibold text-muted">{queue.identity.outlet} · {queue.identity.name}</p>}
            <h1 className="flex items-center gap-3 font-display text-lg font-bold leading-6 tracking-tight sm:text-[28px] sm:leading-8">{L("Billing", "बिलिंग")}
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${offline ? "bg-[var(--state-seated-soft)] text-[var(--state-seated-text)]" : "bg-sage text-forest"}`}><span className={`size-1.5 rounded-full ${offline ? "bg-[var(--state-seated)]" : "animate-pulse bg-[var(--state-available)]"}`} aria-hidden="true" />{offline ? L("Offline", "ऑफ़लाइन") : L("Live", "लाइव")}</span>
            </h1>
            <p className="mt-1 text-sm font-medium text-muted">{L("Collect payments, print bills and settle takeaways.", "भुगतान लें, बिल प्रिंट करें और पार्सल पूरे करें।")}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className={quiet} onClick={() => setHi(!hi)}>{hi ? "EN" : "हिंदी"}</button>
            {!embedded && <PushAwareSignOutButton className={quiet}>{L("Sign out", "बाहर निकलें")}</PushAwareSignOutButton>}
            <button type="button" className={brand} disabled={busy || offline} onClick={newTakeaway}><ShoppingBag className="size-4" aria-hidden="true" />{L("New takeaway", "नया पार्सल")}</button>
          </div>
        </header>

        {offline && <p role="status" className="mt-4 flex items-center gap-2 rounded-input border border-warning bg-[var(--state-held-soft)] p-3 text-sm font-semibold text-[var(--state-held-text)]"><WifiOff className="size-4" aria-hidden="true" />{L("You are offline. Taking payments is paused until the connection is back.", "आप ऑफ़लाइन हैं। कनेक्शन आने तक भुगतान बंद हैं।")}</p>}
        {message && !sheet && <p role={message.tone === "bad" ? "alert" : "status"} className={`mt-4 rounded-input border p-3 text-sm font-semibold ${message.tone === "bad" ? "border-danger text-danger" : "border-line"}`}>{message.text}</p>}

        <StatCards stats={[
          { icon: Wallet, label: L("To collect", "वसूलना है"), value: rs(toCollect), note: L("Across open bills", "खुले बिलों में"), tone: "accent" },
          { icon: ReceiptText, label: L("Bills waiting", "बिल इंतज़ार में"), value: String(paymentQueue.length), note: L("Tables and takeaways", "टेबल और पार्सल") },
          { icon: BellRing, label: L("Want to pay at counter", "काउंटर पर भुगतान"), value: String(counterCount), note: L("Guests waiting for you", "मेहमान इंतज़ार में"), tone: counterCount > 0 ? "warn" : "forest" },
          { icon: Check, label: L("Paid recently", "हाल में भुगतान"), value: rs(paidToday), note: L("Last 24 hours", "पिछले 24 घंटे") },
        ]} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 sm:mt-5">
          <Segmented label={L("Bills", "बिल")} value={tab} onChange={setTab} options={[{ key: "due", label: L("Due", "बाकी"), count: due.length }, { key: "takeaway", label: L("Takeaway", "पार्सल"), count: takeaways.length }, { key: "paid", label: L("Paid", "भुगतान"), count: paid.length }]} />
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input aria-label={L("Search tables", "टेबल खोजें")} className="h-11 w-full rounded-input border border-line bg-surface pl-9 pr-3 text-sm outline-none focus:border-forest focus-visible:ring-2 focus-visible:ring-forest/20" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L("Search by table or name", "टेबल या नाम से खोजें")} />
          </div>
        </div>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <QueuePanel
            title={tab === "due" ? L("Bills to collect", "वसूलने वाले बिल") : tab === "takeaway" ? L("Open takeaways", "चालू पार्सल") : L("Recently paid", "हाल में भुगतान")}
            meta={tab === "takeaway" ? `${shown.length} ${L(shown.length === 1 ? "takeaway" : "takeaways", "पार्सल")}` : `${shown.length} ${L(shown.length === 1 ? "bill" : "bills", "बिल")}`}
            columns={shown.length > 0 && <div className={`${columnHead} ${COLUMNS[tab]}`}><span>{L("Bill", "बिल")}</span>{tab === "due" && <span>{L("Wait", "समय")}</span>}{tab === "takeaway" ? <span>{L("Items", "आइटम")}</span> : <span>{L("Value", "राशि")}</span>}<span>{L("Status", "स्थिति")}</span>{tab === "due" && <span>{L("Due", "बाकी")}</span>}<span className="text-right">{L("Action", "कार्य")}</span></div>}
          >
            {shown.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-sage text-forest"><ReceiptText className="size-6" aria-hidden="true" /></span>
                <p className="mt-3 font-display text-[15px] font-bold">{tab === "due" ? L("No bills to collect", "कोई बिल बाकी नहीं") : tab === "takeaway" ? L("No open takeaways", "कोई पार्सल ऑर्डर नहीं") : L("Nothing paid yet", "अभी कोई भुगतान नहीं")}</p>
                <p className="mt-1 text-sm text-muted">{tab === "due" ? L("Bills appear here when a table asks to pay.", "टेबल के बिल माँगने पर यहाँ दिखेंगे।") : tab === "takeaway" ? L("New takeaway orders appear here before their bill is ready.", "पार्सल ऑर्डर का बिल बनने से पहले वे यहाँ दिखेंगे।") : L("Bills paid in the last 24 hours show up here.", "पिछले 24 घंटे के भुगतान यहाँ दिखते हैं।")}</p>
              </div>
            ) : (
              <ul>
                {tab === "takeaway" && emptyTakeaways.length > 1 && !search && <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper/60 px-4 py-2.5 sm:px-5"><p className="text-[13px] font-medium text-muted">{emptyTakeaways.length} {L("takeaways have no items", "पार्सल में कोई आइटम नहीं")}</p><button type="button" disabled={busy || offline} onClick={removeEmptyTakeaways} className={cn(secondaryButton, "!min-h-9 !px-3 text-xs")}><Trash2 className="size-3.5" aria-hidden="true" />{L("Remove empty ones", "खाली हटाएँ")}</button></li>}
                {shown.map((c) => {
                  const mins = asked(c);
                  const sel = detail?.sessionId === c.sessionId;
                  return (
                    <li key={c.sessionId} className={`${rowCells} ${COLUMNS[tab]} ${rowTone(sel, false)}`}>
                      <span className="min-w-0 lg:order-1">
                        <RowSelect selected={sel} onSelect={() => open(c.sessionId)}>
                          <span className="block truncate text-sm font-bold text-ink">{placeName(c.tableCode, c.takeaway)}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs font-medium text-muted">{c.guestName ? c.guestName : isDeliveryTable(c.tableCode) ? L("Home delivery", "होम डिलीवरी") : c.takeaway ? L("Walk-in guest", "काउंटर ग्राहक") : <><Users className="size-3.5" aria-hidden="true" />{c.partySize} {L(c.partySize === 1 ? "guest" : "guests", "लोग")}</>}</span>
                        </RowSelect>
                      </span>
                      <span className={`justify-self-end text-sm font-bold tabular lg:order-5 lg:justify-self-start ${tab === "due" ? "" : "lg:hidden"}`}>{tab === "due" ? rs(c.balancePaise) : tab === "paid" ? <span className="lg:hidden">{rs(c.totalPaise)}</span> : <span className="lg:hidden">{c.itemCount ? `${c.itemCount} ${L(c.itemCount === 1 ? "item" : "items", "आइटम")}` : ""}</span>}</span>
                      {tab === "due" && <span className="col-span-2 text-xs font-semibold text-muted tabular empty:hidden lg:order-2 lg:col-auto lg:text-sm lg:text-ink">{mins !== null ? waitText(mins) : <span className="hidden lg:inline">—</span>}</span>}
                      <span className="hidden text-sm font-semibold tabular lg:order-3 lg:inline">{tab === "takeaway" ? (c.itemCount ? c.itemCount : "—") : c.totalPaise > 0 ? rs(c.totalPaise) : "—"}</span>
                      <span className="col-span-2 mt-1 flex flex-wrap gap-1 lg:order-4 lg:col-auto lg:mt-0">
                        {tab === "paid" && <Pill className="bg-[var(--state-paid-soft)] text-[var(--state-paid-text)]">{L("Paid", "भुगतान हुआ")}</Pill>}
                        {tab === "takeaway" && (c.itemCount ? <Pill className="bg-[var(--state-held-soft)] text-[var(--state-held-text)]">{L("Not billed yet", "बिल बाकी है")}</Pill> : <Pill className="bg-ink/5 text-muted">{L("No items yet", "अभी कोई आइटम नहीं")}</Pill>)}
                        {tab === "due" && c.status === "bill_requested" && <Pill className="bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]">{L("Bill asked", "बिल माँगा")}</Pill>}
                        {tab === "due" && c.status !== "bill_requested" && !c.takeaway && <Pill className="bg-ink/5 text-muted">{L("Still eating", "अभी खा रहे हैं")}</Pill>}
                        {tab === "due" && c.payAtCounter && !c.pendingOnline && <Pill className="bg-[var(--state-held-soft)] text-[var(--state-held-text)]"><BellRing className="size-3" aria-hidden="true" />{L("At counter", "काउंटर पर")}</Pill>}
                        {tab === "due" && c.paidUpi && <Pill className="bg-[var(--state-available-soft)] text-[var(--state-available-text)]"><BellRing className="size-3" aria-hidden="true" />{L("Says paid by UPI · check app", "UPI से भुगतान बताया · जाँचें")}</Pill>}
                        {c.pendingOnline && <Pill className="bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]">{L("Online payment being checked", "ऑनलाइन भुगतान जाँच में")}</Pill>}
                        {tab === "due" && c.paidPaise > 0 && <Pill className="bg-[var(--state-available-soft)] text-[var(--state-available-text)]">{L("Part paid", "आंशिक भुगतान")} {rs(c.paidPaise)}</Pill>}
                      </span>
                      <span className="relative z-10 hidden justify-end lg:order-6 lg:flex"><button type="button" onClick={() => open(c.sessionId)} className={cn(secondaryButton, "gap-1 px-3")}>{L("Open", "खोलें")}<ArrowRight className="size-3.5" aria-hidden="true" /></button></span>
                    </li>
                  );
                })}
              </ul>
            )}
          </QueuePanel>

          <DetailSheet label={L("Bill", "बिल")} open={!!detail} sticky>
            {!detail ? (
              <div className="px-6 py-12 text-center text-muted">
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-sage text-forest"><ReceiptText className="size-6" aria-hidden="true" /></span>
                <p className="mt-3 font-display text-[15px] font-bold text-ink">{L("Pick a bill", "बिल चुनें")}</p>
                <p className="mt-1 text-sm">{L("Open it to take payment, print it or fix an item.", "बिल खोलकर भुगतान लें, प्रिंट करें या आइटम ठीक करें।")}</p>
              </div>
            ) : (
              <>
                <DetailHead
                  title={placeName(detail.tableCode, detail.takeaway)}
                  badge={<Pill className={isPaidBill ? "bg-[var(--state-paid-soft)] text-[var(--state-paid-text)]" : detail.status === "bill_requested" ? "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]" : detail.takeaway ? "bg-[var(--state-held-soft)] text-[var(--state-held-text)]" : "bg-ink/5 text-muted"}>{isPaidBill ? L("Paid", "भुगतान हुआ") : detail.status === "bill_requested" ? L("Bill asked", "बिल माँगा") : detail.takeaway ? L("Order in progress", "ऑर्डर जारी है") : L("Still eating", "अभी खा रहे हैं")}</Pill>}
                  sub={detail.people.map((p) => p.name).join(", ")}
                  onClose={() => setDetail(null)}
                />
                <div className={SECTION}>
                  <div>
                    <div className="grid min-w-0 grid-cols-2 gap-2">
                      {canAddItems && <button type="button" className={cn(quiet, "w-full justify-center px-2")} disabled={offline} onClick={() => setAdding(true)}><PackagePlus className="size-4 shrink-0" aria-hidden="true" />{L("Add items", "आइटम जोड़ें")}</button>}
                      {!emptyDraft && <button type="button" className={cn(quiet, "w-full justify-center px-2")} onClick={() => print(isPaidBill ? "receipt" : "bill")}><Printer className="size-4 shrink-0" aria-hidden="true" />{isPaidBill ? L("Print receipt", "रसीद प्रिंट") : L("Print bill", "बिल प्रिंट")}</button>}
                      {!emptyDraft && <div className={`min-w-0 ${canAddItems ? "col-span-2" : ""}`}><WhatsAppBill
                        key={detail.sessionId}
                        hi={hi}
                        actionClassName="w-full justify-center px-2 sm:w-full"
                        defaultPhone={defaultWhatsAppPhone}
                        sendPdf={detail.pdfOnWhatsApp && detail.bill ? async (phone) => { const r = await actions.sendBillAction({ sessionId: detail.sessionId, phone }); return r.ok ? null : r.error; } : undefined}
                        onSend={(phone) => void actions.rememberCustomerAction({ sessionId: detail.sessionId, phone, name: detail.people.find((p) => p.name && !/^guest\b/i.test(p.name))?.name ?? null })}
                        text={billMessage({
                          outlet: queue.identity.outlet,
                          table: isDeliveryTable(detail.tableCode) ? L("Delivery", "डिलीवरी") : detail.tableCode,
                          kind: isPaidBill ? "receipt" : "bill",
                          phone: defaultWhatsAppPhone ? defaultWhatsAppPhone.slice(-10) : null,
                          date: detail.bill?.createdAt ?? null,
                          totalPaise: detail.bill?.totalPaise ?? 0,
                          paidPaise: paidSoFar,
                          link: detail.bill && typeof window !== "undefined" ? `${window.location.origin}/b/${detail.bill.shareToken}` : null,
                        })}
                      /></div>}
                      {!isPaidBill && detail.status === "bill_requested" && <button type="button" className={cn(brand, "order-first col-span-2 h-12 w-full justify-center")} disabled={!canPay} onClick={() => { setMethod("cash"); setSheet({ kind: "pay" }); }}><Banknote className="size-4 shrink-0" aria-hidden="true" />{L("Take payment", "भुगतान लें")}</button>}
                    </div>
                  </div>
                  {detail.takeaway && detail.status === "open" && !isPaidBill && (
                    <div className={`${emptyDraft ? "" : "mt-3 "}grid gap-2.5 rounded-input bg-sage px-3 py-2.5 text-sm`}>
                      <p className="min-w-0">{live.length ? L("Add everything the guest wants, then get the bill and take the payment.", "ग्राहक जो चाहे सब जोड़ें, फिर बिल लें और भुगतान लें।") : L("Add the items for this parcel.", "इस पार्सल के आइटम जोड़ें।")}</p>
                      <div className="flex flex-wrap gap-2">
                        {live.length === 0 ? (
                          <button type="button" className={cn(brand, "flex-1")} disabled={offline} onClick={() => setAdding(true)}><PackagePlus className="size-4" aria-hidden="true" />{L("Add items", "आइटम जोड़ें")}</button>
                        ) : (
                          <button type="button" className={cn(brand, "flex-1")} disabled={busy || offline} onClick={() => void run(() => actions.requestBillAction(detail.sessionId), async () => { open(detail.sessionId); })}><Check className="size-4" aria-hidden="true" />{L("Get the bill", "बिल लें")}</button>
                        )}
                        {live.length === 0 && <button type="button" className={cn(quiet, "flex-1")} disabled={busy || offline} onClick={() => void run(() => actions.cancelTakeawayAction(detail.sessionId), async () => { setDetail(null); })}>{L("Cancel takeaway", "पार्सल रद्द करें")}</button>}
                      </div>
                    </div>
                  )}
                  {!detail.takeaway && detail.status === "open" && !isPaidBill && (
                    <div className="mt-3 grid gap-2.5 rounded-input bg-[var(--state-held-soft)] px-3 py-2.5 text-sm text-[var(--state-held-text)]">
                      <p className="flex min-w-0 items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{L("The guests have not asked for the bill. If they are done, or the request did not reach you, close the table's eating stage here.", "मेहमानों ने बिल नहीं माँगा। अगर वे खा चुके हैं, या अनुरोध नहीं पहुँचा, तो यहाँ से खाना बंद करें।")}</span></p>
                      <button type="button" className={cn(quiet, "h-auto min-h-11 whitespace-normal")} disabled={offline} onClick={() => setClosing(true)}><Check className="size-4" aria-hidden="true" />{L("Guests are done · Get the bill", "खाना हो गया · बिल लें")}</button>
                    </div>
                  )}
                  {pendingOnline && (
                    <div className="mt-3 grid gap-2.5 rounded-input bg-[var(--state-cleaning-soft)] px-3 py-2.5 text-sm text-[var(--state-cleaning-text)]">
                      <p className="min-w-0">{L("An online payment is being checked. Wait a moment before taking cash. If it stays stuck, check the guest's UPI app: no money gone means it can be released.", "ऑनलाइन भुगतान जाँच में है। नकद लेने से पहले थोड़ा रुकें। अटका रहे तो ग्राहक का UPI ऐप देखें: पैसा नहीं कटा तो इसे हटा सकते हैं।")}</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={quiet} disabled={busy || offline} onClick={() => void run(() => actions.recheckPaymentAction(detail.sessionId), async (v) => { setMessage({ tone: "ok", text: v === "success" ? L("The payment went through.", "भुगतान हो गया।") : v === "failed" || v === "cancelled" ? L("That payment did not go through. Take the payment again.", "वह भुगतान नहीं हुआ। फिर से भुगतान लें।") : L("No answer from the payment company yet.", "पेमेंट कंपनी से अभी जवाब नहीं आया।") }); })}>{L("Check again", "फिर जाँचें")}</button>
                        {!detail.needsApproval && <button type="button" className={quiet} disabled={busy || offline} onClick={() => void run(() => actions.releasePaymentAction(detail.sessionId), async (r) => { setMessage({ tone: "ok", text: r.view === "success" ? L("The payment went through after all.", "भुगतान असल में हो गया था।") : L("Released. You can take the payment at the counter now.", "हटा दिया। अब काउंटर पर भुगतान ले सकते हैं।") }); })}>{L("Not paid, release", "नहीं हुआ, हटाएँ")}</button>}
                      </div>
                    </div>
                  )}
                </div>

                {!emptyDraft && <div>
                  <div className={SECTION}>
                    <h3 className={SECTION_TITLE}>{L("Items", "आइटम")}</h3>
                    <ul className="mt-2 divide-y divide-line">
                      {lines.map((l) => {
                        const gone = l.status === "voided" || l.status === "cancelled";
                        return (
                          <li key={l.id} className="flex items-start justify-between gap-3 py-2.5 text-body">
                            <div className={`min-w-0 ${gone ? "text-muted line-through" : ""}`}><p><b className="tabular">{l.qty}</b> × {hi ? l.nameHi || l.name : l.name}</p><p className="text-caption text-muted no-underline">{L("for", "के लिए")} {personName(l.participantId)}{gone ? ` · ${L("removed", "हटाया")}` : ""}{!gone && (l.personalForPickup || (l.note && /parcel|pack/i.test(l.note))) ? <span className="ml-2 rounded-full bg-[var(--state-held-soft)] px-2 py-0.5 text-label font-semibold text-[var(--state-held-text)]">{L("Parcel", "पार्सल")}</span> : null}</p></div>
                            <div className="flex shrink-0 items-center gap-2"><span className={`tabular ${gone ? "text-muted line-through" : ""}`}>{rs(l.qty * l.unitPricePaise)}</span>
                              {!gone && !isPaidBill && <button type="button" aria-label={`${L("Remove", "हटाएँ")} ${l.name}`} title={L("Remove this item", "यह आइटम हटाएँ")} disabled={offline} onClick={() => setSheet({ kind: "void", lineId: l.id })} className="grid size-9 place-items-center rounded-input text-muted hover:bg-[var(--state-seated-soft)] hover:text-danger disabled:opacity-40"><Trash2 className="size-4" aria-hidden="true" /></button>}</div>
                          </li>
                        );
                      })}
                      {lines.length === 0 && <li className="py-6 text-center text-body text-muted">{L("No items on this bill.", "इस बिल में कोई आइटम नहीं।")}</li>}
                    </ul>
                  </div>

                  <div>
                    <div className={SECTION}>
                      <h3 className={SECTION_TITLE}>{L("Bill total", "बिल का कुल")}</h3>
                      {!billMade && !isPaidBill ? (
                        <>
                          <p className="mt-2 flex justify-between font-display text-[15px] font-bold"><span>{L("Items so far", "अब तक के आइटम")} ({live.length})</span><span className="tabular">{rs(runningPaise)}</span></p>
                          <p className="mt-1 text-xs text-muted">{L("Tax and final total appear when you get the bill.", "बिल लेने पर टैक्स और कुल राशि दिखेगी।")}</p>
                        </>
                      ) : (
                      <dl className="mt-2 space-y-1.5 text-sm">
                        <div className="flex justify-between"><dt className="text-muted">{L("Items", "आइटम")} ({live.length})</dt><dd className="tabular">{rs(detail.bill?.subtotalPaise ?? 0)}</dd></div>
                        {!!detail.bill?.discountPaise && <div className="flex justify-between text-[var(--state-available-text)]"><dt>{L("Discount", "छूट")}{detail.bill.discount ? ` · ${detail.bill.discount.kind === "percent" ? `${detail.bill.discount.value / 100}%` : rs(detail.bill.discount.value)} · ${detail.bill.discount.reason}` : ""}</dt><dd className="tabular">− {rs(detail.bill.discountPaise)}</dd></div>}
                        <div className="flex justify-between"><dt className="text-muted">{L("Tax", "कर")}</dt><dd className="tabular">{rs(detail.bill?.taxPaise ?? 0)}</dd></div>
                        {!!detail.bill?.deliveryFeePaise && <div className="flex justify-between"><dt className="text-muted">{L("Delivery charge", "डिलीवरी शुल्क")}</dt><dd className="tabular">{rs(detail.bill.deliveryFeePaise)}</dd></div>}
                        {!!detail.bill?.serviceChargePaise && <div className="flex justify-between"><dt className="text-muted">{L("Service charge", "सर्विस चार्ज")}</dt><dd className="tabular">{rs(detail.bill.serviceChargePaise)}</dd></div>}
                        {!!detail.bill?.roundOffPaise && <div className="flex justify-between"><dt className="text-muted">{L("Round off", "राउंड ऑफ़")}</dt><dd className="tabular">{rs(detail.bill.roundOffPaise)}</dd></div>}
                        <div className="flex justify-between border-t border-line pt-2 font-display text-[15px] font-bold"><dt>{L("Total", "कुल")}</dt><dd className="tabular">{rs(detail.bill?.totalPaise ?? 0)}</dd></div>
                        {paidSoFar > 0 && <div className="flex justify-between text-[var(--state-available-text)]"><dt>{L("Paid so far", "अब तक भुगतान")}</dt><dd className="tabular">− {rs(paidSoFar)}</dd></div>}
                        {!isPaidBill && <div className="flex justify-between rounded-input bg-sage px-3 py-2 font-display text-[15px] font-bold"><dt>{L("Still to pay", "बाकी")}</dt><dd className="tabular">{rs(detail.shares.reduce((n, s) => n + Math.max(0, s.amountPaise - s.paidPaise), 0))}</dd></div>}
                      </dl>
                      )}
                    </div>

                    {!isPaidBill && paidSoFar === 0 && detail.discounts && (
                      <DiscountBox
                        key={detail.sessionId}
                        hi={hi}
                        current={detail.bill?.discount ?? null}
                        disabled={offline || busy}
                        needsApproval={detail.needsApproval}
                        subtotalPaise={detail.bill?.subtotalPaise ?? 0}
                        onApply={(kind, value, reason, approval) => void run(() => actions.discountAction({ sessionId: detail.sessionId, kind, value, reason, approval }), async () => { setMessage({ tone: "ok", text: L("Discount applied.", "छूट लग गई।") }); const d = await actions.detailAction(detail.sessionId); if (d.ok) setDetail(d.data); })}
                        onClear={() => void run(() => actions.clearDiscountAction(detail.sessionId), async () => { setMessage({ tone: "ok", text: L("Discount removed.", "छूट हटा दी।") }); const d = await actions.detailAction(detail.sessionId); if (d.ok) setDetail(d.data); })}
                      />
                    )}

                    {!isPaidBill && detail.shares.length > 1 && (
                      <fieldset className={SECTION}>
                        <legend className={`pt-4 ${SECTION_TITLE}`}>{L("Who is paying?", "कौन भुगतान कर रहा है?")}</legend>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" aria-pressed={!share} onClick={() => setShare("")} className={`min-h-11 rounded-input border px-3 text-body font-semibold ${!share ? "border-forest bg-sage" : "border-line text-muted hover:text-ink"}`}>{L("Whole table", "पूरी टेबल")}</button>
                          {detail.shares.map((s) => { const left = Math.max(0, s.amountPaise - s.paidPaise); return (
                            <button key={s.id} type="button" disabled={left === 0} aria-pressed={share === s.participantId} onClick={() => setShare(s.participantId ?? "")} className={`min-h-11 rounded-input border px-3 text-left leading-tight disabled:opacity-40 ${share === s.participantId ? "border-forest bg-sage" : "border-line hover:border-ink/40"}`}><span className="block text-body font-semibold">{personName(s.participantId)}</span><span className="block text-caption text-muted">{left ? rs(left) : L("Paid", "भुगतान हुआ")}</span></button>
                          ); })}
                        </div>
                      </fieldset>
                    )}

                    {!isPaidBill && detail.status === "bill_requested" && (
                      <div className={SECTION}><button type="button" className={`${quiet} h-auto min-h-11 w-full whitespace-normal`} disabled={offline} onClick={() => setSheet({ kind: "reopen" })}><RotateCcw className="size-4" aria-hidden="true" />{L("Guests want to add more — reopen bill", "और ऑर्डर करना है — बिल फिर खोलें")}</button></div>
                    )}
                  </div>
                </div>}

                {detail.payments.length > 0 && <div className={SECTION}>
                  <h3 className={`mb-2 ${SECTION_TITLE}`}>{L("Payments and refunds", "भुगतान और रिफंड")}</h3>
                  <RefundPanel payments={detail.payments} needsApproval={detail.needsApproval} disabled={offline} hi={hi} onChanged={async () => { const d = await actions.detailAction(detail.sessionId); if (d.ok) setDetail(d.data); }} />
                </div>}
                {!emptyDraft && <div className="px-5 py-3"><PaperToggle label={L("Receipt paper", "रसीद पेपर")} className="w-full text-xs [&>label]:flex-1 [&>label]:justify-between [&_select]:h-8 [&_select]:text-xs [&_summary]:size-8" /></div>}
              </>
            )}
          </DetailSheet>
        </div>
      </div>
      </div>

      <Dialog open={!!sheet && !!detail} onOpenChange={(o) => { if (!o) closeSheet(); }}>
        <DialogContent className="no-scrollbar max-h-[92dvh] gap-0 overflow-y-auto p-5 sm:max-w-md">
          {sheet && detail && (<div>
            {sheet.kind === "pay" && done ? (
              <div className="text-center">
                <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--state-available-soft)] text-[var(--state-available-text)]"><Check className="size-8" aria-hidden="true" /></span>
                <h2 className="mt-3 font-display text-title font-bold">{L("Payment recorded", "भुगतान दर्ज हुआ")}</h2>
                {done.change > 0 && <div className="mt-4 rounded-card bg-sage p-4"><p className="text-body text-muted">{L("Give back change", "वापस दें")}</p><p className="font-display text-[34px] leading-10 font-bold tabular">{rs(done.change)}</p></div>}
                <div className="mt-5 grid gap-2">
                  <button type="button" className={brand} onClick={() => print("receipt")}><Printer className="size-4" aria-hidden="true" />{L("Print receipt", "रसीद प्रिंट करें")}</button>
                  <button type="button" className={quiet} onClick={closeSheet}>{L("Done", "हो गया")}</button>
                </div>
              </div>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="font-display text-title font-bold">{sheet.kind === "pay" ? L("Take payment", "भुगतान लें") : sheet.kind === "reopen" ? L("Reopen the bill", "बिल फिर खोलें") : L("Remove this item", "यह आइटम हटाएँ")}</DialogTitle>
                  <DialogDescription>{placeName(detail.tableCode, detail.takeaway)}{detail.guestName && isDeliveryTable(detail.tableCode) ? ` · ${detail.guestName}` : ""}</DialogDescription>
                </DialogHeader>

                {sheet.kind === "pay" && (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-card bg-sage p-4 text-center"><p className="text-body text-muted">{L("Amount to collect", "वसूलने की राशि")}{share ? ` · ${personName(share)}` : ""}</p><p className="font-display text-[36px] leading-10 font-bold tabular">{rs(dueNow)}</p></div>
                    <div className="grid grid-cols-2 gap-2">
                      {([["cash", Banknote, L("Cash", "नकद")], ["upi", Smartphone, "UPI"]] as const).map(([k, Icon, label]) => (
                        <button key={k} type="button" aria-pressed={method === k} onClick={() => setMethod(k)} className={`flex min-h-14 items-center justify-center gap-2 rounded-input border text-body font-semibold ${method === k ? "border-forest bg-sage" : "border-line text-muted hover:text-ink"}`}><Icon className="size-5" aria-hidden="true" />{label}</button>
                      ))}
                    </div>
                    {method === "cash" ? (
                      <div>
                        <label className="block text-body font-semibold">{L("Cash received", "नकद मिला")}<input autoFocus className={`${field} text-xl font-bold tabular`} inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={String(dueNow / 100)} /></label>
                        <div className="mt-2 flex flex-wrap gap-2">{quick.map((v) => <button key={v} type="button" onClick={() => setReceived(String(v / 100))} className="min-h-10 rounded-full border border-line px-3.5 text-body font-semibold hover:border-ink/40">{v === dueNow ? L("Exact", "बराबर") : rs(v)}</button>)}</div>
                        <div className={`mt-3 flex items-center justify-between rounded-input px-3 py-2.5 ${receivedPaise >= dueNow && receivedPaise > 0 ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" : "bg-ink/5 text-muted"}`}><span className="text-body font-semibold">{receivedPaise > 0 && receivedPaise < dueNow ? L("Short by", "कम है") : L("Change to give", "वापस देना है")}</span><b className="font-display text-section tabular">{receivedPaise > 0 && receivedPaise < dueNow ? rs(dueNow - receivedPaise) : rs(change)}</b></div>
                      </div>
                    ) : (
                      <label className="block text-body font-semibold">{L("UPI reference", "UPI रेफ़रेंस")} <span className="font-normal text-muted">({L("optional", "वैकल्पिक")})</span><input className={field} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. last 4 digits" /></label>
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
      {detail && <AddItemsDialog detail={detail} open={adding} hi={hi} onClose={() => setAdding(false)} onDismiss={() => { if (emptyDraft) void run(() => actions.cancelTakeawayAction(detail.sessionId), () => setDetail(null)); }} onPlaced={async () => { await refresh(); }} />}
    </main>
  );
}

/** Give, change or remove the bill's discount: a percent or rupees, always with a reason */
export function DiscountBox({ hi, current, disabled, needsApproval, subtotalPaise, onApply, onClear }: {
  hi: boolean;
  current: { kind: string; value: number; amountPaise: number; reason: string } | null;
  disabled: boolean;
  /** This staff member is not a manager or owner */
  needsApproval: boolean;
  subtotalPaise: number;
  onApply: (kind: "percent" | "flat", value: number, reason: string, approval?: { phone: string; pin: string }) => void;
  onClear: () => void;
}) {
  const L = (en: string, hin: string) => (hi ? hin : en);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"percent" | "flat">("percent");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const n = Number(value);
  // Same rule as the server: above the free limit a manager approves with their PIN
  const amountPaise = kind === "percent" ? Math.round((subtotalPaise * Math.round(n * 100)) / 10000) : Math.min(subtotalPaise, Math.round(n * 100));
  const askManager = needsApproval && n > 0 && discountNeedsApproval(amountPaise, subtotalPaise);
  const valid = reason.trim().length >= 2 && (kind === "percent" ? n > 0 && n <= 100 : Number.isInteger(n) && n > 0) && (!askManager || (phone.trim().length >= 10 && pin.length >= 4));
  if (!open) {
    return (
      <div className={`${SECTION} flex flex-wrap items-center gap-2`}>
        <button type="button" className={quiet} disabled={disabled} onClick={() => setOpen(true)}>{current ? L("Change discount", "छूट बदलें") : L("Give discount", "छूट दें")}</button>
        {current && <button type="button" className="h-11 px-3 text-sm font-semibold text-danger" disabled={disabled} onClick={onClear}>{L("Remove discount", "छूट हटाएँ")}</button>}
      </div>
    );
  }
  return (
    <form
      className={SECTION}
      onSubmit={(e) => { e.preventDefault(); if (valid) { onApply(kind, n, reason.trim(), askManager ? { phone: phone.trim(), pin } : undefined); setOpen(false); setPin(""); } }}
    >
      <h3 className="font-display text-section font-bold">{L("Discount on this bill", "इस बिल पर छूट")}</h3>
      <div className="mt-3 flex gap-2">
        {(["percent", "flat"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("h-10 rounded-full border px-4 text-sm font-semibold", kind === k ? "border-ink bg-forest text-white" : "border-line")}>{k === "percent" ? L("Percent %", "प्रतिशत %") : L("Rupees ₹", "रुपये ₹")}</button>
        ))}
      </div>
      <label className="mt-3 block text-sm font-semibold">{kind === "percent" ? L("How much %", "कितना %") : L("How many rupees", "कितने रुपये")}
        <input className={field} type="number" inputMode="decimal" min={1} max={kind === "percent" ? 100 : undefined} step={kind === "percent" ? "0.5" : "1"} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <label className="mt-3 block text-sm font-semibold">{L("Reason", "कारण")}
        <input className={field} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={L("e.g. Regular guest, birthday, late food", "जैसे रेगुलर ग्राहक, जन्मदिन, खाना देर से")} />
      </label>
      {askManager && (
        <div className="mt-3 rounded-input bg-paper p-3">
          <p className="text-sm font-semibold">{L(`More than ${DISCOUNT_FREE_LIMIT_PERCENT}% off needs a manager's PIN`, `${DISCOUNT_FREE_LIMIT_PERCENT}% से ज़्यादा छूट के लिए मैनेजर का PIN चाहिए`)}</p>
          <label className="mt-2 block text-sm font-semibold">{L("Manager's phone", "मैनेजर का फ़ोन")}
            <input className={field} type="tel" inputMode="numeric" autoComplete="off" maxLength={13} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="mt-2 block text-sm font-semibold">{L("Manager's PIN", "मैनेजर का PIN")}
            <input className={field} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} />
          </label>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">{L("Replaces any earlier discount. Can only change before anyone pays.", "पहले वाली छूट की जगह लेगी। किसी के भुगतान से पहले ही बदल सकते हैं।")}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className={quiet} onClick={() => setOpen(false)}>{L("Cancel", "रद्द करें")}</button>
        <button type="submit" className={brand} disabled={!valid || disabled}>{L("Apply discount", "छूट लगाएँ")}</button>
      </div>
    </form>
  );
}

/**
 * Send this bill to the guest's WhatsApp. With WhatsApp Business connected, Send delivers the bill
 * PDF straight to their number; without it, WhatsApp opens with the bill filled in.
 */
export function WhatsAppBill({ hi, text, defaultPhone = "", onSend, sendPdf, actionClassName = "" }: { hi: boolean; text: string; defaultPhone?: string; onSend?: (phone: string) => void; sendPdf?: (phone: string) => Promise<string | null>; actionClassName?: string }) {
  const L = (en: string, hin: string) => (hi ? hin : en);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(defaultPhone);
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" } | { kind: "error"; text: string }>({ kind: "idle" });
  const ok = !!whatsappNumber(phone);
  if (!open && !sendPdf)
    return <a href={whatsappLink(text, ok ? phone : null)} target="_blank" rel="noreferrer noopener" onClick={() => { if (ok) onSend?.(phone); }} className={cn(quiet, "w-full sm:w-auto", actionClassName)}>{L("WhatsApp bill", "WhatsApp पर बिल")}</a>;
  if (!open)
    return (
        <span className="inline-flex w-full items-center gap-2 sm:w-auto">
        <button type="button" className={cn(quiet, "w-full sm:w-auto", actionClassName)} onClick={() => { setOpen(true); setState({ kind: "idle" }); }}>{L("WhatsApp bill", "WhatsApp पर बिल")}</button>
        {state.kind === "sent" && <span role="status" className="text-sm font-semibold text-[#1f8f4e]">{L("PDF sent", "PDF भेज दी")}</span>}
      </span>
    );
  const input = <input autoFocus aria-label={L("Guest's WhatsApp number", "ग्राहक का WhatsApp नंबर")} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className="h-11 w-40 rounded-input border border-line bg-surface px-3 text-body outline-none focus:border-ink" />;
  if (sendPdf) {
    const send = async () => {
      if (!ok || state.kind === "sending") return;
      setState({ kind: "sending" });
      const error = await sendPdf(phone);
      if (error) setState({ kind: "error", text: error });
      else { setState({ kind: "sent" }); setOpen(false); setPhone(""); }
    };
    return (
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        {input}
        <button type="button" disabled={!ok || state.kind === "sending"} onClick={() => void send()} className="inline-flex h-11 items-center gap-2 rounded-input bg-[#1f8f4e] px-4 text-sm font-semibold text-white disabled:bg-[#1f8f4e]/40">
          {state.kind === "sending" ? L("Sending…", "भेज रहे…") : L("Send PDF", "PDF भेजें")}
        </button>
        <button type="button" className="h-11 px-2 text-sm font-semibold text-muted" onClick={() => setOpen(false)}>{L("Cancel", "रद्द")}</button>
        {state.kind === "error" && <p role="alert" className="w-full text-sm font-semibold text-danger">{state.text}</p>}
      </div>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      {input}
      <a
        href={ok ? whatsappLink(text, phone) : undefined}
        target="_blank"
        rel="noreferrer noopener"
        aria-disabled={!ok}
        onClick={() => { if (!ok) return; onSend?.(phone); setOpen(false); }}
        className={cn("inline-flex h-11 items-center gap-2 rounded-input px-4 text-sm font-semibold text-white", ok ? "bg-[#1f8f4e]" : "pointer-events-none bg-[#1f8f4e]/40")}
      >
        {L("Send", "भेजें")}
      </a>
      <button type="button" className="h-11 px-2 text-sm font-semibold text-muted" onClick={() => setOpen(false)}>{L("Cancel", "रद्द")}</button>
    </div>
  );
}
