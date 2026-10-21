"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, BellRing, BellOff, MonitorSmartphone, Check, ChefHat, ClipboardList, Droplets, LayoutGrid, Minus, Plus, Receipt, Search, ShoppingBag, Sparkles, Trash2, User, Utensils, Wallet, WifiOff } from "lucide-react";
import type { WaiterBoard, WaiterDetail, WaiterMenu } from "@/server/staff/waiter-read";
import { connectRealtime } from "@/lib/realtime-client";
import { priceLine } from "@/domain/pricing";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { copy, money, requestNames, requestUrgency } from "../_copy";
import * as actions from "../actions";
import { signOutAction } from "@/app/(console)/console/login/actions";

type Tab = "tasks" | "tables" | "order" | "me";
type Draft = { itemId: string; qty: number; modifierIds: string[]; note: string; name: string; paise: number };
type SheetState = { kind: "move" | "void" | "reopen" | "settle"; lineId?: string; status?: string };
type MenuItem = WaiterMenu[number];

const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-base font-semibold transition-colors hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-40";
const primary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-brand bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40";
const card = "rounded-2xl border border-line bg-surface p-4";
const fieldCls = "h-12 rounded-xl text-base";
const NOTES = [["Less spicy", "कम तीखा"], ["No onion", "बिना प्याज"], ["Extra spicy", "ज़्यादा तीखा"], ["Parcel", "पार्सल"]] as const;
const STATE_TONE: Record<string, { bg: string; fg: string; en: string; hi: string }> = {
  available: { bg: "var(--state-available-soft)", fg: "var(--state-available-text)", en: "Free", hi: "खाली" },
  held: { bg: "var(--state-held-soft)", fg: "var(--state-held-text)", en: "Held", hi: "रोका हुआ" },
  reserved: { bg: "var(--state-held-soft)", fg: "var(--state-held-text)", en: "Reserved", hi: "बुक" },
  seated: { bg: "var(--state-seated-soft)", fg: "var(--state-seated-text)", en: "Eating", hi: "खा रहे हैं" },
  bill_requested: { bg: "var(--state-bill-soft)", fg: "var(--state-bill-text)", en: "Bill asked", hi: "बिल माँगा" },
  paid: { bg: "var(--state-paid-soft)", fg: "var(--state-paid-text)", en: "Paid", hi: "भुगतान हुआ" },
  needs_cleaning: { bg: "var(--state-cleaning-soft)", fg: "var(--state-cleaning-text)", en: "Needs cleaning", hi: "सफ़ाई चाहिए" },
  blocked: { bg: "var(--state-blocked-soft, var(--state-held-soft))", fg: "var(--state-blocked-text, var(--state-held-text))", en: "Blocked", hi: "बंद" },
};
const REQUEST_ICON: Record<string, typeof Droplets> = { water: Droplets, cutlery: Utensils, call_waiter: BellRing, clean_table: Sparkles, request_bill: Receipt, pay_at_counter: Wallet };
const LINE_STATUS: Record<string, [string, string]> = { placed: ["Sent", "भेजा"], accepted: ["Accepted", "स्वीकार"], preparing: ["Cooking", "बन रहा है"], ready: ["Ready", "तैयार"], served: ["Served", "परोसा"], voided: ["Removed", "हटाया"], cancelled: ["Cancelled", "रद्द"] };

export function WaiterScreen({
  initial, realtimeUrl = null, preview = false, initialTab = "tasks", initialDetail = null, initialMenu = [], initialSheet = null, initialOffline = false,
  initialLanguage = "en", initialStage = "person", initialDraft = [], initialMessage = "", initialItem = null, initialConnection = "polling", theme = "light",
}: {
  initial: WaiterBoard; realtimeUrl?: string | null; preview?: boolean; initialTab?: Tab; initialDetail?: WaiterDetail | null; initialMenu?: WaiterMenu; initialSheet?: SheetState | null;
  initialOffline?: boolean; initialLanguage?: "en" | "hi"; initialStage?: "person" | "menu" | "cart"; initialDraft?: Draft[]; initialMessage?: string; initialItem?: MenuItem | null;
  initialConnection?: string; theme?: "light" | "dark";
}) {
  const [board, setBoard] = useState(initial), [tab, setTab] = useState<Tab>(initialTab), [language, setLanguage] = useState(initialLanguage), [offline, setOffline] = useState(initialOffline);
  const [now, setNow] = useState(initial.renderedAt), [connection, setConnection] = useState(initialConnection), [busy, setBusy] = useState(false), [message, setMessage] = useState(initialMessage);
  const [detail, setDetail] = useState<WaiterDetail | null>(initialDetail), [menu, setMenu] = useState<WaiterMenu>(initialMenu), [stage, setStage] = useState(initialStage);
  const [person, setPerson] = useState(initialDetail?.people.find((p) => !p.paidOut)?.id ?? ""), [name, setName] = useState(""), [draft, setDraft] = useState<Draft[]>(initialDraft);
  const [item, setItem] = useState<MenuItem | null>(initialItem), [mods, setMods] = useState<string[]>([]), [qty, setQty] = useState(1), [note, setNote] = useState(""), [sheet, setSheet] = useState<SheetState | null>(initialSheet);
  const [destination, setDestination] = useState(""), [reason, setReason] = useState(""), [phone, setPhone] = useState(""), [pin, setPin] = useState("");
  const [method, setMethod] = useState<"cash" | "card">("cash"), [received, setReceived] = useState(""), [reference, setReference] = useState(""), [share, setShare] = useState("");
  const [search, setSearch] = useState(""), [dark, setDark] = useState(theme === "dark");
  // Shift status, set by the manager on the dashboard: only a waiter on duty is rung for new tasks
  const dutyRef = useRef(initial.identity.duty);
  const [alerts, setAlerts] = useState(true), [awake, setAwake] = useState(false), [notifState, setNotifState] = useState<string>("default");
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const alertsRef = useRef(true), pingRef = useRef<(text: string, quiet?: boolean) => void>(() => {}), audioRef = useRef<AudioContext | null>(null), seenReady = useRef(new Set(initial.ready.map((g) => g.id)));
  const seen = useRef(new Set(initial.requests.map((r) => r.id))), mutation = useRef(false), orderKey = useRef<string | null>(null), settleKey = useRef<string | null>(null);
  const detailId = useRef(initialDetail?.sessionId), refreshRef = useRef<() => Promise<void>>(async () => {});
  const c = copy[language], hi = language === "hi";
  const L = (en: string, h: string) => (hi ? h : en);

  // Alerts: remembered per phone. Sound needs one tap on the page first; the first tap anywhere unlocks it.
  useEffect(() => {
    try {
      const a = localStorage.getItem("tq_waiter_alerts") !== "off", w = localStorage.getItem("tq_waiter_awake") === "on";
      queueMicrotask(() => { setAlerts(a); alertsRef.current = a; setAwake(w); });
    } catch { /* storage blocked: keep defaults */ }
    try { const raw = JSON.parse(localStorage.getItem("tq_waiter_acked") ?? "[]"); if (Array.isArray(raw)) queueMicrotask(() => setAcked(new Set(raw.map(String)))); } catch { /* ignore */ }
    if (typeof Notification !== "undefined") queueMicrotask(() => setNotifState(Notification.permission));
    // Phones suspend sound when the screen locks or the app goes to the background, so wake it on every tap and on return
    const unlock = () => { try { audioRef.current ??= new AudioContext(); if (audioRef.current.state !== "running") void audioRef.current.resume(); } catch { /* no audio */ } };
    const back = () => { if (document.visibilityState === "visible" && audioRef.current) unlock(); };
    window.addEventListener("pointerdown", unlock);
    document.addEventListener("visibilitychange", back);
    return () => { window.removeEventListener("pointerdown", unlock); document.removeEventListener("visibilitychange", back); };
  }, []);
  useEffect(() => {
    pingRef.current = (text: string, quiet = false) => {
      if (!quiet) setMessage(text);
      if (!alertsRef.current || dutyRef.current !== "on") return;
      try { navigator.vibrate?.(quiet ? [600, 150, 600, 150, 600] : [220, 90, 220, 90, 420]); } catch { /* not supported, e.g. iPhone */ }
      try {
        const ctx = audioRef.current;
        const beep = () => {
          if (!ctx || ctx.state !== "running") return;
          [[880, 0], [1175, 0.18], [880, 0.36]].forEach(([f, at]) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
            const t = ctx.currentTime + at; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
            o.start(t); o.stop(t + 0.18);
          });
        };
        // Sound suspended since the last task (screen locked, app in background): wake it, then beep
        if (ctx && ctx.state !== "running") void ctx.resume().then(beep, () => {}); else beep();
      } catch { /* sound is a bonus */ }
      // renotify: a second task with the same tag must alert again, not silently replace the first
      try { if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden && text) new Notification("TableQR", { body: text, tag: "tableqr-task", requireInteraction: true, renotify: true } as NotificationOptions); } catch { /* ignore */ }
    };
  });
  // Keep the screen on while the waiter app is open, so alerts are not missed on a locked phone
  useEffect(() => {
    if (!awake || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const get = async () => { try { lock = await navigator.wakeLock.request("screen"); } catch { /* denied or hidden */ } };
    void get();
    const vis = () => { if (document.visibilityState === "visible") void get(); };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); void lock?.release(); };
  }, [awake]);

  // Dialogs render on <body>, so the staff theme must sit on <html> as well
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("console-ui");
    root.classList.toggle("theme-dark", dark);
    return () => root.classList.remove("console-ui", "theme-dark");
  }, [dark]);
  useEffect(() => { detailId.current = detail?.sessionId; }, [detail]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(t);
  }, [message]);

  useEffect(() => {
    if (preview) return;
    let alive = true, inflight = false, debounce: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (inflight || !navigator.onLine) return;
      inflight = true;
      try {
        const res = await actions.boardAction();
        if (!alive) return;
        if (res.ok) {
          setBoard(res.data); setOffline(false); setNow(res.data.renderedAt);
          const freshRequests = res.data.requests.filter((r) => !seen.current.has(r.id)), freshReady = res.data.ready.filter((g) => !seenReady.current.has(g.id));
          for (const r of res.data.requests) seen.current.add(r.id);
          for (const g of res.data.ready) seenReady.current.add(g.id);
          if (freshRequests.length) pingRef.current(copy[language].newTask);
          else if (freshReady.length) pingRef.current(`${freshReady[0].tableCode} · ${copy[language].ready}`);
          if (detailId.current) { const d = await actions.detailAction(detailId.current); if (alive && d.ok) setDetail(d.data); }
        } else { setMessage(res.error); if (res.code === "staff_signed_out" || res.code === "forbidden") setOffline(true); }
      } catch { if (alive) setOffline(true); } finally { inflight = false; }
    };
    refreshRef.current = refresh;
    const stop = connectRealtime({
      url: realtimeUrl, getToken: actions.tokenAction, pollMs: 25000, onResync: () => void refresh(), onStatus: (s) => setConnection(s),
      onEvents: (events) => {
        for (const e of events) {
          const id = e.data?.requestId;
          if (e.type === "service_request.created" && typeof id === "string" && !seen.current.has(id)) { seen.current.add(id); pingRef.current(copy[language].newTask); }
        }
        clearTimeout(debounce); debounce = setTimeout(() => void refresh(), 350);
      },
    });
    const tick = setInterval(() => setNow(Date.now()), 1000), poll = setInterval(() => void refresh(), 15000);
    const online = () => void refresh(), off = () => setOffline(true);
    window.addEventListener("online", online); window.addEventListener("offline", off);
    if (!navigator.onLine) queueMicrotask(off);
    return () => { alive = false; stop(); clearInterval(tick); clearInterval(poll); clearTimeout(debounce); window.removeEventListener("online", online); window.removeEventListener("offline", off); };
  }, [preview, realtimeUrl, language]);

  async function perform<T>(work: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: (data: T) => void) {
    if (offline || mutation.current) return;
    mutation.current = true; setBusy(true); setMessage("");
    try {
      if (preview) { setMessage(c.saved); setSheet(null); return; }
      const res = await work();
      if (!res.ok) { setMessage(res.error); return; }
      setMessage(c.saved); success?.(res.data); await refreshRef.current();
    } catch { setMessage("Connection lost. Retry the same action safely."); setOffline(true); } finally { mutation.current = false; setBusy(false); }
  }
  // A new task keeps buzzing and beeping until the waiter taps Accept. Tasks older than 30 minutes stay on the list but stop ringing.
  const FRESH_MS = 30 * 60_000;
  const pending = [
    ...board.requests.filter((r) => !acked.has(r.id) && now - r.createdAt < FRESH_MS).map((r) => ({ id: r.id, label: `${r.tableCode} · ${requestNames[r.kind]?.[hi ? 1 : 0] ?? r.kind}` })),
    ...board.ready.filter((g) => !acked.has(g.id) && now - g.readyAt < FRESH_MS).map((g) => ({ id: g.id, label: `${g.tableCode} · ${c.ready}` })),
  ];
  const duty = board.identity.duty;
  const ringing = pending.length > 0 && alerts && duty === "on" && !preview;
  useEffect(() => {
    if (!ringing) return;
    // Buzz and beep about every 2.5 seconds until someone taps Accept
    const t = setInterval(() => pingRef.current("", true), 2500);
    return () => clearInterval(t);
  }, [ringing]);
  useEffect(() => { dutyRef.current = board.identity.duty; }, [board.identity.duty]);
  function accept(ids: string[]) {
    setAcked((prev) => {
      const next = new Set([...prev, ...ids]);
      try { localStorage.setItem("tq_waiter_acked", JSON.stringify([...next].slice(-300))); } catch { /* ignore */ }
      return next;
    });
  }
  const isNew = (id: string) => pending.some((p) => p.id === id);
  const disabled = offline || busy;
  /** "just now", "7 min", "2h 5m": never a raw 1074 minutes */
  const age = (t: number) => {
    const m = Math.max(0, Math.floor((now - t) / 60000));
    if (m < 1) return L("just now", "अभी");
    if (m < 60) return `${m} ${c.minutes}`;
    const h = Math.floor(m / 60);
    return h >= 24 ? L("1d+", "1 दिन+") : `${h}h ${m % 60}m`;
  };
  async function openTable(sessionId: string, ordering = false) {
    if (preview) { setTab(ordering ? "order" : "tables"); return; }
    await perform(() => actions.detailAction(sessionId), (d) => { setDetail(d); setPerson(""); setStage("person"); setTab(ordering ? "order" : "tables"); setDraft([]); orderKey.current = null; });
  }
  async function showMenu() { await perform(actions.menuAction, (m) => { setMenu(m); setStage("menu"); }); if (preview) setStage("menu"); }
  function closeSheet() { setSheet(null); setPin(""); setPhone(""); setReason(""); settleKey.current = null; }
  const total = draft.reduce((n, l) => n + l.paise, 0);
  const balance = detail?.shares.filter((s) => !share || s.participantId === share).reduce((n, s) => n + Math.max(0, s.amount - s.paid), 0) ?? 0;
  const receivedPaise = Math.round(Number(received || "0") * 100);
  const quick = useMemo(() => [...new Set([balance, Math.ceil(balance / 10000) * 10000, Math.ceil(balance / 50000) * 50000, Math.ceil(balance / 100000) * 100000])].filter((v) => v >= balance && v > 0).slice(0, 4), [balance]);
  const isManager = board.identity.roles.some((r) => r === "manager" || r === "owner");

  async function submitSheet() {
    if (!sheet || !detail) return;
    const approval = phone && pin ? { phone, pin } : undefined;
    if (sheet.kind === "move") await perform(() => actions.lineAction({ sessionId: detail.sessionId, lineId: sheet.lineId!, destinationId: destination }), closeSheet);
    if (sheet.kind === "void") await perform(() => actions.lineAction({ sessionId: detail.sessionId, lineId: sheet.lineId!, reason, approval }), closeSheet);
    if (sheet.kind === "reopen") await perform(() => actions.reopenAction(detail.sessionId, approval), closeSheet);
    if (sheet.kind === "settle") {
      settleKey.current ??= crypto.randomUUID();
      await perform(() => actions.settleAction({ sessionId: detail.sessionId, method, forParticipantIds: share ? [share] : undefined, receivedPaise: method === "cash" ? receivedPaise : undefined, externalReference: reference, clientRequestId: settleKey.current! }), (res) => { closeSheet(); setMessage(`${c.saved} · ${c.change} ${money(res.changePaise)}`); });
    }
  }

  // Item sheet: which required choice is still missing
  const missingGroup = item?.pricing.groups.find((g) => g.minSelect > 0 && g.modifiers.filter((m) => mods.includes(m.id)).length < g.minSelect);
  const pickMod = (g: MenuItem["pricing"]["groups"][number], id: string, on: boolean) => {
    setMods((cur) => {
      const mine = cur.filter((x) => g.modifiers.some((m) => m.id === x)), others = cur.filter((x) => !g.modifiers.some((m) => m.id === x));
      const next = g.maxSelect === 1 ? (on ? [id] : []) : on ? [...mine, id].slice(0, g.maxSelect) : mine.filter((x) => x !== id);
      return [...others, ...next];
    });
  };
  const itemPrice = item ? priceLine(item.pricing, qty, mods) : null;
  const shownMenu = menu.filter((m) => !search.trim() || `${m.name} ${m.nameHi ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const sortedRequests = [...board.requests].sort((a, b) => a.createdAt - b.createdAt);
  const taskCount = board.requests.length + board.ready.length;
  const personName = (id: string | null) => detail?.people.find((p) => p.id === id)?.name ?? "";
  const stageTitle = !detail ? c.chooseTable : stage === "person" ? c.choosePerson : stage === "menu" ? c.menu : L("Review order", "ऑर्डर देखें");
  const NAV = [["tasks", ClipboardList], ["tables", LayoutGrid], ["order", ShoppingBag], ["me", User]] as const;

  return (
    <main lang={hi ? "hi" : "en"} className={`${dark ? "theme-dark " : ""}min-h-dvh bg-paper pb-28 text-ink [overflow-wrap:anywhere]`}>
      <div className="mx-auto w-full max-w-xl px-4 pt-5">
        <header className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-soft font-display text-xl font-bold text-brand-strong">{board.identity.name.trim().slice(0, 1).toUpperCase()}</span>
          {/* Status chips sit under the name so the name keeps the row's width on small phones */}
          <div className="min-w-0 flex-1 [overflow-wrap:normal]">
            <p className="truncate text-xs font-semibold text-muted">{board.identity.outlet}</p>
            <h1 className="truncate font-display text-xl font-bold leading-tight">{L("Hi", "नमस्ते")}, {board.identity.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${offline ? "bg-[var(--state-seated-soft)] text-[var(--state-seated-text)]" : "bg-[var(--state-available-soft)] text-[var(--state-available-text)]"}`}>
                <span className={`size-1.5 rounded-full ${offline ? "bg-[var(--state-seated)]" : "animate-pulse bg-[var(--state-available)]"}`} aria-hidden="true" />{offline ? L("Offline", "ऑफ़लाइन") : L("Live", "लाइव")}
              </span>
              {duty !== "on" && <button type="button" onClick={() => setTab("me")} className="rounded-full bg-[var(--state-held-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--state-held-text)]">{duty === "break" ? L("On break", "ब्रेक पर") : L("Off duty", "ड्यूटी ख़त्म")}</button>}
            </div>
          </div>
          {/* Bell: requests and ready food waiting for this waiter; tap opens Tasks */}
          <button type="button" aria-label={L(`${taskCount} tasks waiting`, `${taskCount} काम बाकी`)} className={`relative grid size-10 shrink-0 place-items-center rounded-lg border bg-surface ${pending.length ? "animate-pulse border-danger text-danger" : "border-line"}`} onClick={() => setTab("tasks")}>
            {alerts ? <BellRing className="size-5" aria-hidden="true" /> : <BellOff className="size-5" aria-hidden="true" />}
            {taskCount > 0 && <span className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold leading-5 text-white tabular">{taskCount > 99 ? "99+" : taskCount}</span>}
          </button>
          <button className="min-h-10 shrink-0 rounded-lg border border-line bg-surface px-3 text-sm font-semibold" onClick={() => setLanguage(hi ? "en" : "hi")}>{hi ? "EN" : "हिंदी"}</button>
        </header>

        {offline && <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-warning bg-[var(--state-held-soft)] p-3 text-sm font-semibold text-[var(--state-held-text)]"><WifiOff className="size-4 shrink-0" aria-hidden="true" />{c.offline}</p>}
        {!offline && connection === "connecting" && <p role="status" className="mt-3 text-sm text-muted">{c.reconnecting}</p>}

        {pending.length > 0 && (
          <div role="alert" className={`sticky top-2 z-30 mt-4 rounded-2xl border-2 border-danger bg-[var(--state-seated-soft)] p-3 shadow-lg ${ringing ? "animate-pulse" : ""}`}>
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-danger text-white"><BellRing className="size-6" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wider text-danger">{pending.length > 1 ? `${pending.length} ${L("new tasks", "नए काम")}` : L("New task", "नया काम")}</p><p className="truncate font-display text-lg font-bold text-ink">{pending[0].label}</p></div>
              <button className={`${primary} shrink-0`} onClick={() => { accept([pending[0].id]); setTab("tasks"); }}>{L("Accept", "स्वीकारें")}</button>
            </div>
            {pending.length > 1 && <button className="mt-2 w-full text-center text-sm font-semibold text-danger underline" onClick={() => accept(pending.map((p) => p.id))}>{L("Accept all", "सभी स्वीकारें")}</button>}
          </div>
        )}

        {tab === "tasks" && (
          <div className="mt-5 space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <div className={card}><p className="font-display text-3xl font-bold tabular-nums">{board.requests.length}</p><p className="text-sm text-muted">{c.requests}</p></div>
              <div className={card}><p className="font-display text-3xl font-bold tabular-nums">{board.ready.length}</p><p className="text-sm text-muted">{c.ready}</p></div>
            </div>
            {taskCount === 0 && (
              <div className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--state-available-soft)] text-[var(--state-available-text)]"><Check className="size-7" aria-hidden="true" /></span>
                <p className="mt-3 font-display text-xl font-bold">{c.empty}</p><p className="mt-1 text-sm text-muted">{L("New requests show up here with a buzz.", "नए अनुरोध यहाँ दिखेंगे।")}</p>
              </div>
            )}
            {board.requests.length > 0 && (
              <section aria-label={c.requests}>
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">{c.requests}</h2>
                <div className="space-y-3">
                  {sortedRequests.map((r) => {
                    const urgency = requestUrgency(r.createdAt, now, r.escalated);
                    const Icon = REQUEST_ICON[r.kind] ?? BellRing;
                    return (
                      <article key={r.id} className={`${card} ${urgency === "urgent" ? "border-danger bg-[var(--state-seated-soft)]" : urgency === "warning" ? "border-warning bg-[var(--state-held-soft)]" : ""}`}>
                        <div className="flex items-center gap-3">
                          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-ink/5"><Icon className="size-6" aria-hidden="true" /></span>
                          <div className="min-w-0 flex-1">
                            <p className="font-display text-2xl font-bold leading-tight">{r.tableCode}</p>
                            <p className="text-base">{requestNames[r.kind]?.[hi ? 1 : 0] ?? r.kind}</p>
                          </div>
                          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${urgency === "urgent" ? "bg-danger text-white" : urgency === "warning" ? "bg-warning text-black" : "bg-ink/10 text-muted"}`}>{urgency !== "waiting" && <AlertTriangle className="size-3" aria-hidden="true" />}{age(r.createdAt)}</span>
                        </div>
                        {isNew(r.id) ? <button className={`${primary} mt-3 w-full`} onClick={() => accept([r.id])}><BellRing className="size-5" aria-hidden="true" />{L("Accept", "स्वीकारें")}</button> : <button disabled={disabled} className={`${primary} mt-3 w-full`} onClick={() => perform(() => actions.doneAction(r.id))}><Check className="size-5" aria-hidden="true" />{c.done}</button>}
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
            {board.ready.length > 0 && (
              <section aria-label={c.ready}>
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">{c.ready}</h2>
                <div className="space-y-3">
                  {[...board.ready].sort((a, b) => a.readyAt - b.readyAt).map((g) => (
                    <article key={g.id} className={card}>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="flex items-center gap-2 font-display text-xl font-bold"><ChefHat className="size-5 text-[var(--state-available-text)]" aria-hidden="true" />{g.tableCode} <span className="text-sm font-normal text-muted">· {c.round} {g.roundNo}</span></h3>
                        <span className="rounded-full bg-ink/10 px-2.5 py-1 text-xs font-bold text-muted">{age(g.readyAt)}</span>
                      </div>
                      <ul className="my-3 space-y-1.5">{g.lines.map((l) => <li key={l.id} className="flex items-baseline gap-2 text-base"><b className="min-w-6 tabular-nums">{l.qty}×</b>{hi ? l.nameHi || l.name : l.name}</li>)}</ul>
                      {isNew(g.id) ? <button className={`${primary} w-full`} onClick={() => accept([g.id])}><BellRing className="size-5" aria-hidden="true" />{L("Accept", "स्वीकारें")}</button> : <button disabled={disabled} className={`${primary} w-full`} onClick={() => perform(() => actions.servedAction(g.lines.map((l) => l.id)))}><Utensils className="size-5" aria-hidden="true" />{c.served}</button>}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === "tables" && !detail && (
          <section className="mt-5">
            <h2 className="font-display text-2xl font-bold">{c.tables}</h2>
            {!board.tables.length && <p className={`${card} mt-3 text-center text-muted`}>{c.noTables}</p>}
            <div className="mt-3 grid grid-cols-2 gap-3">
              {board.tables.map((t) => {
                const tone = STATE_TONE[t.state] ?? STATE_TONE.available;
                return (
                  <article key={t.id} className="flex flex-col rounded-2xl border border-line bg-surface p-3">
                    <button disabled={disabled || !t.sessionId} onClick={() => openTable(t.sessionId!)} className="flex-1 text-left disabled:cursor-default">
                      <span className="flex items-start justify-between gap-2"><span className="font-display text-2xl font-bold leading-tight">{t.label}</span>
                        {t.sessionId && (t.requestCount > 0 || t.readyCount > 0) && <span className="flex gap-1">{t.requestCount > 0 && <span className="grid size-6 place-items-center rounded-full bg-danger text-xs font-bold text-white">{t.requestCount}</span>}{t.readyCount > 0 && <span className="grid size-6 place-items-center rounded-full bg-[var(--state-available)] text-xs font-bold text-white">{t.readyCount}</span>}</span>}
                      </span>
                      <span className="mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: tone.bg, color: tone.fg }}>{hi ? tone.hi : tone.en}</span>
                      {t.sessionId && <p className="mt-2 text-sm text-muted">{t.partySize} {t.partySize === 1 ? L("guest", "व्यक्ति") : L("guests", "लोग")}{t.openedAt ? ` · ${age(t.openedAt)}` : ""}</p>}
                      {t.unpaidPaise !== null && t.unpaidPaise > 0 && <p className="mt-1 text-sm font-semibold">{c.unpaid} {money(t.unpaidPaise)}</p>}
                    </button>
                    {t.state === "needs_cleaning" && <button className={`${primary} mt-2 min-h-11 w-full text-sm`} disabled={disabled} onClick={() => perform(() => actions.cleanAction(t.id))}><Sparkles className="size-4" aria-hidden="true" />{c.clean}</button>}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {tab === "tables" && detail && (
          <section className="mt-4 space-y-4">
            <button className="inline-flex min-h-11 items-center gap-1.5 text-base font-semibold text-muted hover:text-ink" onClick={() => setDetail(null)}><ArrowLeft className="size-5" aria-hidden="true" />{c.back}</button>
            <div className={card}>
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="font-display text-2xl font-bold">{board.tables.find((t) => t.sessionId === detail.sessionId)?.label ?? c.details}</h2>
                  <span className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: (STATE_TONE[detail.status === "open" ? "seated" : detail.status] ?? STATE_TONE.seated).bg, color: (STATE_TONE[detail.status === "open" ? "seated" : detail.status] ?? STATE_TONE.seated).fg }}>{detail.status === "open" ? L("Eating", "खा रहे हैं") : detail.status === "bill_requested" ? L("Bill asked", "बिल माँगा") : detail.status.replaceAll("_", " ")}</span></div>
                <div className="text-right"><p className="text-xs text-muted">{c.unpaid}</p><p className="font-display text-2xl font-bold tabular-nums">{money(balance)}</p></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{detail.people.map((p) => <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-3 py-1 text-sm font-semibold">{p.name}{p.paidOut && <Check className="size-3.5 text-[var(--state-available-text)]" aria-label="Paid" />}</span>)}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className={primary} disabled={disabled || detail.status !== "open"} onClick={() => { setTab("order"); setStage("person"); }}><Plus className="size-5" aria-hidden="true" />{c.takeOrder}</button>
              <button className={btn} disabled={disabled || detail.status === "closed"} onClick={() => (detail.status === "bill_requested" ? setSheet({ kind: "reopen" }) : perform(() => actions.billAction(detail.sessionId)))}><Receipt className="size-5" aria-hidden="true" />{detail.status === "bill_requested" ? c.reopen : c.bill}</button>
              <button className={`${btn} col-span-2`} disabled={disabled || detail.status !== "bill_requested"} onClick={() => { setMethod("cash"); setSheet({ kind: "settle" }); }}><Wallet className="size-5" aria-hidden="true" />{c.settle}</button>
            </div>
            {detail.requests.map((r) => {
              const Icon = REQUEST_ICON[r.kind] ?? BellRing;
              return <div key={r.id} className={`${card} flex items-center gap-3`}><Icon className="size-5 shrink-0 text-brand-strong" aria-hidden="true" /><span className="flex-1 font-semibold">{requestNames[r.kind]?.[hi ? 1 : 0]}</span><button disabled={disabled} className={`${btn} min-h-11`} onClick={() => perform(() => actions.doneAction(r.id))}>{c.done}</button></div>;
            })}
            {[...new Set(detail.lines.map((l) => l.roundNo))].sort((a, b) => a - b).map((round) => (
              <div key={round}>
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">{c.round} {round}</h3>
                <div className="space-y-2">
                  {detail.lines.filter((l) => l.roundNo === round).map((l) => {
                    const gone = ["voided", "cancelled"].includes(l.status);
                    const st = LINE_STATUS[l.status];
                    return (
                      <article key={l.id} className={`${card} ${gone ? "opacity-60" : ""}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0"><p className={`font-semibold ${gone ? "line-through" : ""}`}><b className="tabular-nums">{l.qty}×</b> {hi ? l.nameHi || l.name : l.name}</p><p className="text-sm text-muted">{personName(l.participantId)}</p></div>
                          <span className="shrink-0 rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-bold">{st ? st[hi ? 1 : 0] : l.status}</span>
                        </div>
                        {!gone && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {l.status === "ready" && <button className={`${primary} min-h-11 text-sm`} disabled={disabled} onClick={() => perform(() => actions.servedAction([l.id]))}>{c.served}</button>}
                            <button className={`${btn} min-h-11 text-sm`} disabled={disabled} onClick={() => { setSheet({ kind: "move", lineId: l.id }); setDestination(""); }}>{c.move}</button>
                            <button className={`${btn} min-h-11 text-sm text-danger`} disabled={disabled} onClick={() => setSheet({ kind: "void", lineId: l.id, status: l.status })}><Trash2 className="size-4" aria-hidden="true" />{c.void}</button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}

        {tab === "order" && (
          <section className="mt-5 space-y-4">
            <div className="flex items-center gap-3">
              {detail && <button aria-label={c.back} className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-surface" onClick={() => { if (stage === "person") { setDetail(null); setDraft([]); } else setStage(stage === "cart" ? "menu" : "person"); }}><ArrowLeft className="size-5" aria-hidden="true" /></button>}
              <div className="min-w-0"><h2 className="font-display text-2xl font-bold leading-tight">{stageTitle}</h2>
                {detail && <p className="text-sm text-muted">{board.orderTables.find((t) => t.sessionId === detail.sessionId)?.label ?? board.tables.find((t) => t.sessionId === detail.sessionId)?.label}{person ? ` · ${personName(person)}` : ""}</p>}</div>
            </div>
            {!detail ? (
              <div className="grid grid-cols-2 gap-3">
                {board.orderTables.map((t) => <button key={t.id} className="rounded-2xl border border-line bg-surface p-4 text-left hover:border-ink/40 disabled:opacity-40" disabled={disabled} onClick={() => openTable(t.sessionId!, true)}><span className="font-display text-2xl font-bold">{t.label}</span><span className="mt-1 block text-sm text-muted">{t.partySize} {t.partySize === 1 ? L("guest", "व्यक्ति") : L("guests", "लोग")}</span></button>)}
                {!board.orderTables.length && <p className={`${card} col-span-2 text-center text-muted`}>{L("No table is seated right now.", "अभी कोई टेबल नहीं बैठी है।")}</p>}
              </div>
            ) : detail.status !== "open" ? (
              <p className={`${card} text-center`}>{c.blocked}</p>
            ) : (
              <>
                {detail.orderingPaused && <p className="rounded-xl bg-[var(--state-held-soft)] p-3 text-sm font-semibold text-[var(--state-held-text)]">{c.paused}</p>}
                {stage === "person" && (
                  <>
                    <div className="space-y-2">{detail.people.filter((p) => !p.paidOut).map((p) => (
                      <button key={p.id} disabled={disabled} className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 text-left text-lg font-semibold hover:border-ink/40 disabled:opacity-40" onClick={() => { setPerson(p.id); setDraft([]); orderKey.current = null; void showMenu(); }}>
                        <span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-ink/5 text-sm font-bold">{p.name.trim().slice(0, 1).toUpperCase()}</span>{p.name}</span><span className="text-muted">→</span>
                      </button>
                    ))}</div>
                    <div className={card}>
                      <label className="mb-2 block font-semibold" htmlFor="diner-name">{c.addDiner}</label>
                      {/* A name is required: orders, bills and the customer list all show who ordered */}
                      <Input id="diner-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={c.dinerName} className={fieldCls} maxLength={40} required aria-required="true" />
                      <button className={`${primary} mt-3 w-full`} disabled={disabled || !name.trim()} onClick={() => perform(() => actions.addDinerAction(detail.sessionId, name.trim()), (p) => { setPerson(p.id); setName(""); })}><Plus className="size-5" aria-hidden="true" />{c.add}</button>
                    </div>
                  </>
                )}
                {stage === "menu" && (
                  <>
                    <div className="relative"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden="true" /><Input aria-label={L("Search the menu", "मेन्यू खोजें")} className={`${fieldCls} pl-11`} placeholder={L("Search the menu", "मेन्यू खोजें")} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
                    <ul className="space-y-2">
                      {shownMenu.map((m) => {
                        const hasChoice = m.pricing.groups.some((g) => g.minSelect > 0);
                        return (
                          <li key={m.id}>
                            <button disabled={disabled || !m.pricing.isAvailable} onClick={() => { setItem(m); setMods([]); setQty(1); setNote(""); }} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left hover:border-ink/40 disabled:opacity-50">
                              <span className="min-w-0"><span className="block truncate text-base font-semibold">{hi ? m.nameHi || m.name : m.name}</span><span className="text-sm text-muted tabular-nums">{hasChoice ? L("from ", "से ") : ""}{money(m.pricing.pricePaise)}{!m.pricing.isAvailable ? ` · ${c.soldOut}` : ""}</span></span>
                              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand bg-brand text-white"><Plus className="size-5" aria-hidden="true" /></span>
                            </button>
                          </li>
                        );
                      })}
                      {shownMenu.length === 0 && <li className={`${card} text-center text-muted`}>{L("Nothing matches.", "कुछ नहीं मिला।")}</li>}
                    </ul>
                    {draft.length > 0 && <button className={`${primary} sticky bottom-20 z-10 w-full shadow-lg`} onClick={() => setStage("cart")}><ShoppingBag className="size-5" aria-hidden="true" />{L("Review order", "ऑर्डर देखें")} · {draft.length} · {money(total)}</button>}
                  </>
                )}
                {stage === "cart" && (
                  <>
                    <ul className="space-y-2">
                      {draft.map((l, i) => (
                        <li key={i} className={`${card} flex items-start justify-between gap-3`}>
                          <div className="min-w-0"><p className="font-semibold"><b className="tabular-nums">{l.qty}×</b> {l.name}</p>{l.note && <p className="mt-0.5 text-sm text-muted">{l.note}</p>}<p className="mt-1 text-sm font-semibold tabular-nums">{money(l.paise)}</p></div>
                          <button aria-label={c.remove} className="grid size-10 shrink-0 place-items-center rounded-lg border border-line text-muted hover:text-danger" onClick={() => { setDraft((d) => d.filter((_, j) => i !== j)); orderKey.current = null; }}><Trash2 className="size-4" aria-hidden="true" /></button>
                        </li>
                      ))}
                    </ul>
                    <button className={`${btn} w-full`} onClick={() => setStage("menu")}><Plus className="size-5" aria-hidden="true" />{L("Add more", "और जोड़ें")}</button>
                    <button className={`${primary} w-full`} disabled={disabled || !draft.length} onClick={() => { orderKey.current ??= crypto.randomUUID(); void perform(() => actions.orderAction({ sessionId: detail.sessionId, tableId: detail.tableId, participantId: person, clientRequestId: orderKey.current!, lines: draft }), () => { setDraft([]); orderKey.current = null; setMessage(c.placed); setStage("person"); }); }}>{c.place} · {money(total)}</button>
                  </>
                )}
              </>
            )}
          </section>
        )}

        {tab === "me" && (
          <section className="mt-5 space-y-3">
            <div className={`${card} flex items-center gap-4`}>
              <span className="grid size-16 place-items-center rounded-full bg-brand-soft font-display text-3xl font-bold text-brand-strong">{board.identity.name.trim().slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0"><h2 className="truncate font-display text-xl font-bold">{board.identity.name}</h2><p className="text-sm text-muted">{board.identity.roles.join(", ")} · {board.identity.outlet}</p></div>
            </div>
            <div className={card}>
              <h3 className="font-display text-lg font-bold">{L("My shift", "मेरी शिफ़्ट")}</h3>
              <p className="mt-1 text-sm text-muted">{L("Your manager sets this on the dashboard. New tasks ring only while you are on duty.", "इसे आपके मैनेजर डैशबोर्ड से बदलते हैं। नए काम की घंटी सिर्फ़ ड्यूटी पर रहते बजती है।")}</p>
              <p className={`mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-base font-semibold ${duty === "on" ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" : duty === "break" ? "bg-[var(--state-held-soft)] text-[var(--state-held-text)]" : "bg-ink/10 text-muted"}`}>{duty === "on" ? L("On duty", "ड्यूटी पर") : duty === "break" ? L("On break", "ब्रेक पर") : L("Off duty", "ड्यूटी ख़त्म")}</p>
            </div>
            <div className={card}>
              <p className="text-sm font-bold">{L("Alerts", "अलर्ट")}</p>
              <p className="mt-0.5 text-sm text-muted">{L("A new request or ready food keeps buzzing and beeping until you tap Accept. Keep this page open.", "नया अनुरोध या तैयार खाना तब तक वाइब्रेट और बीप करेगा जब तक आप स्वीकारें न दबाएँ। यह पेज खुला रखें।")}</p>
              <div className="mt-3 grid gap-2">
                <button type="button" role="switch" aria-checked={alerts} className={`${btn} justify-between`} onClick={() => { const v = !alerts; setAlerts(v); alertsRef.current = v; try { localStorage.setItem("tq_waiter_alerts", v ? "on" : "off"); } catch { /* ignore */ } }}>
                  <span className="flex items-center gap-2">{alerts ? <BellRing className="size-5" aria-hidden="true" /> : <BellOff className="size-5" aria-hidden="true" />}{L("Vibrate and beep", "वाइब्रेट और बीप")}</span><b className={alerts ? "text-[var(--state-available-text)]" : "text-muted"}>{alerts ? L("On", "चालू") : L("Off", "बंद")}</b>
                </button>
                <button type="button" role="switch" aria-checked={awake} className={`${btn} justify-between`} onClick={() => { const v = !awake; setAwake(v); try { localStorage.setItem("tq_waiter_awake", v ? "on" : "off"); } catch { /* ignore */ } }}>
                  <span className="flex items-center gap-2"><MonitorSmartphone className="size-5" aria-hidden="true" />{L("Keep screen on", "स्क्रीन चालू रखें")}</span><b className={awake ? "text-[var(--state-available-text)]" : "text-muted"}>{awake ? L("On", "चालू") : L("Off", "बंद")}</b>
                </button>
                {notifState !== "granted" && notifState !== "denied" && notifState !== "unsupported" && typeof Notification !== "undefined" && (
                  <button type="button" className={btn} onClick={() => void Notification.requestPermission().then((r) => setNotifState(r))}>{L("Allow notifications", "नोटिफिकेशन की अनुमति दें")}</button>
                )}
                <button type="button" className={btn} onClick={() => pingRef.current(L("Test alert: new request", "टेस्ट अलर्ट: नया अनुरोध"))}>{L("Test alert", "अलर्ट टेस्ट करें")}</button>
              </div>
              <p className="mt-2 text-xs text-muted">{L("iPhone does not vibrate in a browser; the beep and notification still work. Alerts stop if the phone is locked and the page is closed.", "iPhone ब्राउज़र में वाइब्रेट नहीं करता; बीप और नोटिफिकेशन चलते हैं। फ़ोन लॉक हो और पेज बंद हो तो अलर्ट नहीं आएँगे।")}</p>
            </div>
            <ThemeToggle dark={dark} onChange={setDark} showLabel className={`${btn} w-full justify-start`} />
            <button className={`${btn} w-full justify-start`} onClick={() => setLanguage(hi ? "en" : "hi")}>{c.language}: {hi ? "हिंदी" : "English"}</button>
            <form action={preview ? undefined : signOutAction}><button className={`${btn} w-full justify-start text-danger`} disabled={disabled || preview}>{c.signOut}</button></form>
          </section>
        )}
      </div>

      {message && <p role="status" className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md rounded-xl border border-line bg-ink px-4 py-3 text-center text-sm font-semibold text-paper shadow-lg">{message}</p>}

      <nav aria-label="Waiter navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {NAV.map(([key, Icon]) => (
            <button key={key} aria-current={tab === key ? "page" : undefined} className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-xs font-semibold ${tab === key ? "text-brand-strong" : "text-muted"}`} onClick={() => { setTab(key); if (key === "tables") setDetail(null); }}>
              <span className={`relative grid h-7 w-12 place-items-center rounded-full ${tab === key ? "bg-brand-soft" : ""}`}><Icon className="size-5" aria-hidden="true" />{key === "tasks" && taskCount > 0 && <span className="absolute -right-0.5 -top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">{taskCount}</span>}</span>
              {c[key]}
            </button>
          ))}
        </div>
      </nav>

      <Sheet open={!!item} onOpenChange={(o) => !o && setItem(null)}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-background">
          {item && (
            <>
              <SheetHeader><SheetTitle className="font-display text-2xl font-bold">{hi ? item.nameHi || item.name : item.name}</SheetTitle><SheetDescription>{money(item.pricing.pricePaise)}</SheetDescription></SheetHeader>
              <div className="space-y-5 px-4 pb-6">
                {item.pricing.groups.filter((g) => g.modifiers.length > 0).map((g) => {
                  const need = g.minSelect > 0 && g.modifiers.filter((m) => mods.includes(m.id)).length < g.minSelect;
                  return (
                    <fieldset key={g.id}>
                      <legend className={`mb-2 text-sm font-bold ${need ? "text-danger" : ""}`}>{hi ? g.nameHi || g.nameEn : g.nameEn} <span className="font-normal text-muted">· {g.minSelect > 0 ? (need ? L("choose one", "एक चुनें") : L("required", "ज़रूरी")) : L("optional", "वैकल्पिक")}</span></legend>
                      <div className="flex flex-wrap gap-2">
                        {g.modifiers.map((m) => {
                          const on = mods.includes(m.id);
                          return <button key={m.id} type="button" role={g.maxSelect === 1 ? "radio" : "checkbox"} aria-checked={on} disabled={!m.isAvailable} onClick={() => pickMod(g, m.id, g.maxSelect === 1 && g.minSelect > 0 ? true : !on)} className={`min-h-12 rounded-xl border px-4 text-base font-semibold disabled:opacity-40 ${on ? "border-ink bg-ink text-paper" : need ? "border-danger/50" : "border-line bg-surface"}`}>{hi ? m.nameHi || m.nameEn : m.nameEn}{m.priceDeltaPaise ? ` +${money(m.priceDeltaPaise)}` : ""}</button>;
                        })}
                      </div>
                    </fieldset>
                  );
                })}
                <div className="flex items-center justify-between"><span className="text-sm font-bold">{c.qty}</span>
                  <span className="flex items-center gap-3"><button aria-label={L("One less", "एक कम")} className="grid size-12 place-items-center rounded-xl border border-line bg-surface" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus className="size-5" aria-hidden="true" /></button><b className="w-8 text-center text-xl tabular-nums">{qty}</b><button aria-label={L("One more", "एक और")} className="grid size-12 place-items-center rounded-xl border border-line bg-surface" onClick={() => setQty((q) => Math.min(50, q + 1))}><Plus className="size-5" aria-hidden="true" /></button></span></div>
                <div className="space-y-2"><label htmlFor="line-note" className="text-sm font-bold">{c.note}</label>
                  <div className="flex flex-wrap gap-1.5">{NOTES.map(([en, h]) => { const t = hi ? h : en; const on = note.includes(t); return <button key={en} type="button" aria-pressed={on} onClick={() => setNote((n) => (on ? n.replace(t, "").replace(/^[,\s]+|[,\s]+$/g, "").replace(/,\s*,/g, ",") : [n, t].filter(Boolean).join(", ")))} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${on ? "border-ink bg-ink text-paper" : "border-line"}`}>{t}</button>; })}</div>
                  <Input id="line-note" className={fieldCls} value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} /></div>
                <button disabled={disabled || !!missingGroup || !itemPrice?.ok} className={`${primary} w-full`} onClick={() => {
                  const priced = priceLine(item.pricing, qty, mods);
                  if (!priced.ok) { setMessage(L("Choose the required option first.", "पहले ज़रूरी विकल्प चुनें।")); return; }
                  setDraft((d) => [...d, { itemId: item.id, qty, modifierIds: mods, note, name: hi ? item.nameHi || item.name : item.name, paise: priced.line.linePaise }]);
                  orderKey.current = null; setItem(null);
                }}>{missingGroup ? L(`Choose ${missingGroup.nameEn}`, "ज़रूरी विकल्प चुनें") : `${c.add} · ${itemPrice?.ok ? money(itemPrice.line.linePaise) : ""}`}</button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!sheet && !!detail} onOpenChange={(o) => !o && closeSheet()}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-background">
          {sheet && detail && (
            <>
              <SheetHeader><SheetTitle className="font-display text-2xl font-bold">{sheet.kind === "settle" ? c.settle : c[sheet.kind]}</SheetTitle>{sheet.kind === "settle" && <SheetDescription>{L("Take cash or card at the table.", "टेबल पर नकद या कार्ड लें।")}</SheetDescription>}</SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                {sheet.kind === "move" && (
                  <div className="space-y-2"><p className="text-sm font-bold">{c.choosePerson}</p><div className="flex flex-wrap gap-2">{detail.people.filter((p) => !p.paidOut).map((p) => <button key={p.id} type="button" aria-pressed={destination === p.id} onClick={() => setDestination(p.id)} className={`min-h-12 rounded-xl border px-4 text-base font-semibold ${destination === p.id ? "border-ink bg-ink text-paper" : "border-line bg-surface"}`}>{p.name}</button>)}</div></div>
                )}
                {sheet.kind === "void" && <div className="space-y-2"><label className="text-sm font-bold" htmlFor="void-reason">{c.reason}</label><textarea id="void-reason" className="min-h-24 w-full rounded-xl border border-line bg-surface p-3 text-base" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></div>}
                {(sheet.kind === "reopen" || (sheet.kind === "void" && sheet.status !== "placed")) && !isManager && (
                  <fieldset className="space-y-3 rounded-xl border border-line p-3"><legend className="px-1 text-sm font-bold">{c.manager}</legend>
                    <div className="space-y-1.5"><label className="text-sm" htmlFor="m-phone">{c.phone}</label><Input id="m-phone" className={fieldCls} inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                    <div className="space-y-1.5"><label className="text-sm" htmlFor="m-pin">{c.pin}</label><Input id="m-pin" className={fieldCls} type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} /></div>
                  </fieldset>
                )}
                {sheet.kind === "settle" && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" aria-pressed={!share} onClick={() => { setShare(""); settleKey.current = null; }} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold ${!share ? "border-ink bg-ink text-paper" : "border-line bg-surface"}`}>{c.all}</button>
                      {detail.people.map((p) => <button key={p.id} type="button" aria-pressed={share === p.id} onClick={() => { setShare(p.id); settleKey.current = null; }} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold ${share === p.id ? "border-ink bg-ink text-paper" : "border-line bg-surface"}`}>{p.name}</button>)}
                    </div>
                    <div className="rounded-2xl bg-brand-soft p-4 text-center"><p className="text-sm text-muted">{L("Amount to collect", "वसूलने की राशि")}</p><p className="font-display text-4xl font-bold tabular-nums">{money(balance)}</p></div>
                    <div className="grid grid-cols-2 gap-2">{(["cash", "card"] as const).map((m) => <button key={m} className={method === m ? primary : btn} onClick={() => { setMethod(m); settleKey.current = null; }}>{c[m]}</button>)}</div>
                    {method === "cash" ? (
                      <div className="space-y-2">
                        <label className="text-sm font-bold" htmlFor="cash-in">{c.received}</label>
                        <Input id="cash-in" className="h-14 rounded-xl text-2xl font-bold tabular-nums" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={String(balance / 100)} />
                        <div className="flex flex-wrap gap-2">{quick.map((v) => <button key={v} type="button" onClick={() => setReceived(String(v / 100))} className="min-h-10 rounded-full border border-line px-3.5 text-sm font-semibold">{v === balance ? L("Exact", "बराबर") : money(v)}</button>)}</div>
                        <p className="flex justify-between rounded-xl bg-ink/5 px-3 py-2 text-base"><span>{receivedPaise > 0 && receivedPaise < balance ? L("Short by", "कम है") : c.change}</span><b className="tabular-nums">{money(receivedPaise > 0 && receivedPaise < balance ? balance - receivedPaise : Math.max(0, receivedPaise - balance))}</b></p>
                      </div>
                    ) : (
                      <div className="space-y-2"><label className="text-sm font-bold" htmlFor="card-ref">{c.reference}</label><Input id="card-ref" className={fieldCls} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></div>
                    )}
                  </>
                )}
                {message && <p role="alert" className="text-sm font-semibold text-danger">{message}</p>}
                <button className={`${primary} w-full`} disabled={disabled || (sheet.kind === "move" && !destination) || (sheet.kind === "void" && !reason.trim()) || (sheet.kind === "settle" && method === "cash" && (!received || receivedPaise < balance))} onClick={submitSheet}>{c.confirm}</button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
