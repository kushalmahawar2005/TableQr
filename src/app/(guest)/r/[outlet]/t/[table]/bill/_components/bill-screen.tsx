"use client";

import {
  AlertCircleIcon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CreditCardIcon,
  CrownIcon,
  InformationCircleIcon,
  Invoice01Icon,
  Loading03Icon,
  LockIcon,
  MoreHorizontalIcon,
  RefreshIcon,
  SmartPhone01Icon,
  Store01Icon,
  Wallet01Icon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import { formatRupees } from "@/domain/menu-price";
import { roundHalfUp } from "@/domain/money";
import type { Lang } from "@/lib/i18n";
import type { BillScreenData } from "@/server/guest/bill-screen";
import { DiningNav } from "../../_components/dining-nav";
import { LanguageToggle } from "../../_components/language-toggle";
import { OutletLogo } from "../../_components/outlet-logo";
import { focusRing, Sheet } from "../../_components/sheet";
import { serviceRequestAction } from "../../orders/actions";
import {
  assignLineAction,
  paidAndLeftAction,
  payAtCounterAction,
  paymentStatusAction,
  reopenAction,
  serviceChargeAction,
  splitModeAction,
  startPaymentAction,
  type BillError,
} from "../actions";
import { g8Copy, type G8Copy } from "../_copy";
import { useBillSync } from "../_hooks/use-bill-sync";

type Person = BillScreenData["people"][number];
type Mode = BillScreenData["bill"]["mode"];
type Method = "upi" | "card" | "wallet";
export type PayState = "ready" | "starting" | "verifying" | "unknown" | "success" | "failed" | "gateway_down" | "cancelled";
type Tip = { kind: "none" } | { kind: "bp"; bp: number } | { kind: "custom"; rupees: string };
type Notice = { text: string; error?: boolean };

/** A frozen state for the dev review board */
export type BillPreview = {
  offline?: boolean;
  failed?: boolean;
  pay?: PayState;
  sheet?: "method" | "others" | "request" | "reopen";
  tip?: Tip;
  payFor?: string[];
  notice?: Notice;
};

const button = `inline-flex min-h-12 items-center justify-center gap-2 rounded-cta px-4 py-2.5 text-button font-semibold transition-colors duration-150 ease-natural disabled:cursor-not-allowed disabled:opacity-55 ${focusRing}`;
const outline = `${button} border border-line bg-surface text-ink hover:border-ink/40`;
const primary = `${button} bg-brand text-brand-on hover:bg-brand-hover active:bg-brand-pressed`;

const exact = (paise: number) =>
  `${paise < 0 ? "−" : ""}₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bp: number) => `${(bp / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

function submitCheckout(checkout: { method: "GET" | "POST"; action: string; fields: Record<string, string> }) {
  // A plain form to the gateway's hosted page: no gateway script ever runs on our pages
  const form = document.createElement("form");
  form.method = checkout.method;
  form.action = checkout.action;
  for (const [name, value] of Object.entries(checkout.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export function BillScreen({
  data: initial,
  lang,
  shortCode,
  realtimeUrl,
  returningPaymentId,
  preview,
}: {
  data: BillScreenData;
  lang: Lang;
  shortCode: string;
  realtimeUrl: string | null;
  returningPaymentId?: string | null;
  preview?: BillPreview;
}) {
  const c = g8Copy[lang];
  const router = useRouter();
  const { data, online, failed, refresh } = useBillSync(initial, shortCode, realtimeUrl, !!preview, preview?.offline);
  const { session, bill } = data;
  const base = `/r/${encodeURIComponent(data.outlet.code)}/t/${encodeURIComponent(shortCode)}`;
  const me = data.people.find((p) => p.isMe);
  const myDue = me?.duePaise ?? 0;

  const [notice, setNotice] = useState<Notice | null>(() => preview?.notice ?? null);
  const [sheet, setSheet] = useState<BillPreview["sheet"] | "left" | null>(() => preview?.sheet ?? null);
  const [leaving, setLeaving] = useState<Person | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [tip, setTip] = useState<Tip>(() => preview?.tip ?? { kind: "none" });
  const [payFor, setPayFor] = useState<string[]>(() => preview?.payFor ?? (me && myDue > 0 ? [me.id] : []));
  const [pay, setPay] = useState<{ state: PayState; paymentId: string | null }>(() => {
    if (preview?.pay) return { state: preview.pay, paymentId: null };
    if (returningPaymentId) return { state: "verifying", paymentId: returningPaymentId };
    const latest = initial.latestPayment;
    if (latest?.status === "pending") return { state: "unknown", paymentId: latest.id };
    return { state: "ready", paymentId: null };
  });
  const requests = useRef(new Map<string, string>());

  const nameOf = (p: Person) => (p.isMe ? (p.name ? `${p.name} ${c.youSuffix}` : c.you) : (p.name ?? c.anotherGuest));
  const shortName = (p: Person) => p.name ?? (p.isMe ? c.you : c.anotherGuest);
  const lineName = (l: { nameEn: string; nameHi: string | null }) => (lang === "hi" && l.nameHi ? l.nameHi : l.nameEn);
  const itemName = (l: { en: string; hi: string | null }) => (lang === "hi" && l.hi ? l.hi : l.en);
  const due = new Map(data.people.map((p) => [p.id, p.duePaise]));
  const selected = payFor.filter((id) => (due.get(id) ?? 0) > 0);
  const payBase = selected.reduce((n, id) => n + (due.get(id) ?? 0), 0);
  const tipPaise =
    tip.kind === "bp" ? roundHalfUp((payBase * tip.bp) / 10000 / 100) * 100 : tip.kind === "custom" ? Math.max(0, Math.round(Number(tip.rupees || 0)) * 100) : 0;
  const tipValid = tipPaise <= payBase;
  const others = data.people.filter((p) => !p.isMe && p.duePaise > 0);
  const canPay = session.requested && online && !busy && pay.state !== "starting" && pay.state !== "verifying" && pay.state !== "unknown";

  // Coming back from the gateway: ask the server (which asks the gateway) until there is an answer
  useEffect(() => {
    if (preview || !pay.paymentId || (pay.state !== "verifying" && pay.state !== "unknown")) return;
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (stopped) return;
      if (navigator.onLine) {
        const res = await paymentStatusAction(data.outlet.code, shortCode, pay.paymentId!).catch(() => null);
        if (stopped) return;
        if (res?.ok && res.status === "success") {
          setPay((p) => ({ ...p, state: "success" }));
          setTimeout(() => router.push(`${base}/paid`), 1200);
          return;
        }
        if (res?.ok && (res.status === "failed" || res.status === "cancelled")) {
          setPay((p) => ({ ...p, state: res.status === "failed" ? "failed" : "cancelled" }));
          void refresh();
          return;
        }
        if (res && !res.ok && res.error === "gone") {
          router.replace(`${base}/paid`);
          return;
        }
        // Not known yet: say so honestly after a few seconds, never call it failed
        if (Date.now() - started > 8000) setPay((p) => (p.state === "verifying" ? { ...p, state: "unknown" } : p));
      }
      timer = setTimeout(check, Date.now() - started > 120_000 ? 15_000 : 3000);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pay.paymentId, pay.state, preview, data.outlet.code, shortCode, base, router, refresh]);

  // Drop the ?p= from the address once read, so a reload starts clean
  useEffect(() => {
    if (!preview && returningPaymentId) window.history.replaceState(null, "", `${base}/bill`);
  }, [preview, returningPaymentId, base]);

  function errorText(error: BillError) {
    return error === "host_only"
      ? c.hostOnly
      : error === "locked"
        ? c.splitLocked
        : error === "being_paid"
          ? c.beingPaid
          : error === "payment_in_flight"
            ? c.reopenBlocked
            : error === "no_gateway"
              ? c.noOnline
              : error === "changed" || error === "nothing_due"
                ? c.changed
                : c.failed;
  }

  async function act(key: string, call: () => Promise<{ ok: true } | { ok: false; error: BillError }>, success?: string) {
    if (preview) {
      setSheet(null);
      return;
    }
    if (busyRef.current || !online) return;
    busyRef.current = true;
    setBusy(key);
    setNotice(null);
    try {
      const res = await call();
      if (!res.ok) {
        if (res.error === "gone") return router.replace(`${base}/paid`);
        setNotice({ text: errorText(res.error), error: res.error === "failed" });
      } else if (success) setNotice({ text: success });
      await refresh();
    } catch {
      setNotice({ text: c.failed, error: true });
    } finally {
      busyRef.current = false;
      setBusy(null);
      setSheet(null);
      setLeaving(null);
    }
  }

  async function begin(method: Method) {
    if (preview) {
      setSheet(null);
      return;
    }
    if (!canPay || busyRef.current || selected.length === 0 || !tipValid) return;
    busyRef.current = true;
    setSheet(null);
    setNotice(null);
    setPay({ state: "starting", paymentId: null });
    // One id per intent: a double tap or retry of the same intent returns the same attempt
    const intent = JSON.stringify([selected.slice().sort(), tipPaise, method]);
    let requestId = requests.current.get(intent);
    if (!requestId) {
      requestId = crypto.randomUUID();
      requests.current.set(intent, requestId);
    }
    try {
      const res = await startPaymentAction(data.outlet.code, shortCode, { forParticipantIds: selected, tipPaise, method, requestId });
      if (res.ok) {
        submitCheckout(res.checkout);
        return;
      }
      requests.current.delete(intent);
      if (res.error === "gone") return router.replace(`${base}/paid`);
      if (res.error === "gateway_down") setPay({ state: "gateway_down", paymentId: res.paymentId });
      else {
        setPay({ state: "ready", paymentId: null });
        setNotice({ text: errorText(res.error), error: true });
      }
      await refresh();
    } catch {
      requests.current.delete(intent);
      setPay({ state: "ready", paymentId: null });
      setNotice({ text: c.failed, error: true });
    } finally {
      busyRef.current = false;
    }
  }

  const counter = () =>
    act("counter", () => payAtCounterAction(data.outlet.code, shortCode, `counter-${session.key}`.slice(0, 64)), c.counterDone);
  const requestBill = () =>
    act("request", async () => {
      const res = await serviceRequestAction(data.outlet.code, shortCode, "request_bill", `bill-${session.key}`.slice(0, 64));
      return res.ok ? { ok: true as const } : { ok: false as const, error: (res.error === "gone" ? "gone" : res.error === "host_only" ? "host_only" : "failed") as BillError };
    });

  const total = bill.totals.totalPaise;
  const taxRates = Object.keys(bill.totals.taxBreakup);
  const gstLabel = taxRates.length === 1 ? c.gst(pct(Number(taxRates[0]))) : c.gstMixed;

  return (
    <div lang={lang} style={brandStyle(deriveBrandTokens(data.outlet.accentColor)) as CSSProperties} className={`relative flex flex-1 flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}>
      <header className="flex items-center gap-3 pt-4">
        <OutletLogo name={data.outlet.name} logoUrl={data.outlet.logoUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-section font-bold break-words text-ink">{data.outlet.name}</p>
          <p className="text-caption text-muted">{c.tableLine(data.table.code)}</p>
        </div>
        <LanguageToggle lang={lang} label={c.language} preview={!!preview} />
      </header>

      <main className="pb-6">
        <h1 className="mt-5 font-display text-title font-bold text-ink">{c.title}</h1>

        {!online && <Banner icon={WifiOff01Icon} tone="offline" title={c.offline} body={c.offlineBody} />}
        {bill.reopened && <Banner icon={RefreshIcon} tone="info" title={c.changedTitle} body={session.requested ? c.changedBody : c.reopenedOpenBody} />}
        {data.refundPendingPaise > 0 && <Banner icon={Clock01Icon} tone="info" title={c.refundTitle} body={c.refundBody(formatRupees(data.refundPendingPaise))} />}
        {(failed || preview?.failed) && (
          <div role="alert" className="mt-4 rounded-guest border border-line bg-surface p-4 text-body">
            <p>{c.refreshFailed}</p>
            <button type="button" onClick={() => void refresh()} disabled={!online} className={`mt-1 inline-flex min-h-11 items-center font-semibold text-brand-strong underline underline-offset-4 ${focusRing}`}>
              {c.retry}
            </button>
          </div>
        )}
        {notice && (
          <p role={notice.error ? "alert" : "status"} className={`mt-4 flex items-start gap-2.5 rounded-guest border p-3.5 text-body font-semibold ${notice.error ? "border-danger/25 bg-[var(--state-seated-soft)] text-danger" : "border-success/25 bg-[var(--state-available-soft)] text-[var(--state-available-text)]"}`}>
            <HugeiconsIcon icon={notice.error ? AlertCircleIcon : CheckmarkCircle02Icon} size={20} className="mt-px shrink-0" aria-hidden />
            {notice.text}
          </p>
        )}

        <PaymentPanel
          state={pay.state}
          c={c}
          dueText={formatRupees(myDue)}
          online={online}
          onRetry={() => setSheet("method")}
          onCounter={() => void counter()}
          onDismiss={() => setPay({ state: "ready", paymentId: null })}
        />

        {/* Table total */}
        <section aria-label={c.tableTotal} className="mt-4 rounded-guest border border-line bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-body font-semibold text-ink">{session.requested ? c.tableTotal : c.currentBill}</p>
            <p className="font-display text-title font-bold text-ink tabular">{formatRupees(total)}</p>
          </div>
          {session.requested ? (
            <p className="mt-1 text-caption text-muted">
              {lang === "hi" ? `${bill.paidCount} / ${data.people.length} ने चुकाया` : `${bill.paidCount} of ${data.people.length} paid`}
            </p>
          ) : (
            <>
              <p className="mt-1 text-caption text-muted">{c.previewNote}</p>
              {session.isHost ? (
                <button type="button" onClick={() => setSheet("request")} disabled={!online || !!busy || data.people.length === 0} className={`${primary} mt-3 w-full`}>
                  <HugeiconsIcon icon={Invoice01Icon} size={18} aria-hidden />
                  {c.requestBill}
                </button>
              ) : (
                <p className="mt-3 text-caption font-semibold text-ink">{c.hostRequests(session.hostName)}</p>
              )}
            </>
          )}
        </section>

        {session.requested && (
          <>
            {/* Split mode */}
            <section aria-labelledby="g8-split" className="mt-6">
              <h2 id="g8-split" className="font-display text-section font-bold text-ink">
                {c.split}
              </h2>
              <div role="radiogroup" aria-labelledby="g8-split" className="mt-2 grid grid-cols-3 gap-1 rounded-cta border border-line bg-surface p-1">
                {(["my_items", "equal", "custom"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={bill.mode === m}
                    disabled={!bill.canEdit || !online || !!busy}
                    onClick={() => bill.mode !== m && void act(`mode-${m}`, () => splitModeAction(data.outlet.code, shortCode, m))}
                    className={`min-h-11 rounded-input px-1 text-caption font-semibold break-words transition-colors ${focusRing} ${bill.mode === m ? "bg-ink text-white" : "text-ink disabled:text-muted"}`}
                  >
                    {c.modes[m]}
                  </button>
                ))}
              </div>
              {(bill.locked || !session.isHost) && (
                <p className="mt-2 flex items-start gap-1.5 text-caption text-muted">
                  <HugeiconsIcon icon={bill.locked ? LockIcon : CrownIcon} size={14} className="mt-px shrink-0" aria-hidden />
                  {bill.locked ? c.splitLocked : c.splitHostOnly(session.hostName)}
                </p>
              )}
            </section>

            {/* Everyone */}
            <section aria-labelledby="g8-people" className="mt-6">
              <h2 id="g8-people" className="font-display text-section font-bold text-ink">
                {c.people}
              </h2>
              <ul className="mt-1 divide-y divide-line/70">
                {data.people.map((p) => (
                  <li key={p.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <div className="min-w-0 flex-1">
                      <p className={`text-body font-semibold break-words ${p.removed || p.paidAndLeft ? "text-muted" : "text-ink"}`}>
                        {nameOf(p)}
                        {p.isHost && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[var(--state-held-soft)] px-2 py-0.5 align-middle text-label font-semibold text-[var(--state-held-text)]">
                            <HugeiconsIcon icon={CrownIcon} size={12} aria-hidden />
                            {c.host}
                          </span>
                        )}
                      </p>
                      {(p.removed || p.paidAndLeft || p.paidBy || p.paidByMe) && (
                        <p className="text-caption text-muted">
                          {[p.removed ? c.removed : null, p.paidAndLeft ? c.paidAndLeft : null, p.paidByMe ? c.paidByYou : p.paidBy ? c.paidBy(p.paidBy) : null].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <span className="font-semibold text-ink tabular">{formatRupees(p.amountPaise)}</span>
                    <StatusChip status={p.status} c={c} />
                    {session.isHost && !p.isHost && p.status === "paid" && !p.paidAndLeft && !p.removed && (
                      <button type="button" onClick={() => setLeaving(p)} aria-label={c.moreFor(shortName(p))} className={`-mr-2 grid size-11 place-items-center rounded-full text-muted hover:bg-ink/5 ${focusRing}`}>
                        <HugeiconsIcon icon={MoreHorizontalIcon} size={20} aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {bill.mode === "custom" && (
              <CustomItems
                data={data}
                c={c}
                lineName={lineName}
                shortName={shortName}
                disabled={!bill.canEdit || !online || !!busy}
                onAssign={(lineId, ids) =>
                  ids.length === 0 ? setNotice({ text: c.atLeastOne, error: true }) : void act(`line-${lineId}`, () => assignLineAction(data.outlet.code, shortCode, lineId, ids))
                }
              />
            )}
          </>
        )}

        {/* Your share */}
        {data.mine && (
          <section aria-labelledby="g8-mine" className="mt-6 rounded-guest border border-line bg-surface p-4">
            <h2 id="g8-mine" className="font-display text-section font-bold text-ink">
              {c.yourShare}
            </h2>
            <dl className="mt-2 space-y-1.5 text-body">
              {data.mine.detail ? (
                <>
                  <Row label={c.yourDishes} hint={data.mine.ownItems.map(itemName).join(", ")} value={exact(data.mine.detail.ownItemsPaise)} />
                  {data.mine.detail.sharedItemsPaise > 0 && <Row label={c.shared} hint={data.mine.sharedItems.map(itemName).join(", ")} value={exact(data.mine.detail.sharedItemsPaise)} />}
                  {data.mine.detail.discountPaise > 0 && <Row label={c.discount} value={exact(-data.mine.detail.discountPaise)} />}
                  <Row label={c.subtotal} value={exact(data.mine.detail.subtotalPaise - data.mine.detail.discountPaise)} strong />
                  {bill.totals.serviceChargeBp > 0 && (
                    <ServiceChargeRow c={c} bill={bill} value={exact(data.mine.detail.serviceChargePaise)} canEdit={bill.canEdit && online && !busy} onToggle={(w) => void act("sc", () => serviceChargeAction(data.outlet.code, shortCode, w))} />
                  )}
                  <Row label={gstLabel} value={exact(data.mine.detail.taxPaise)} />
                  <Row label={c.roundOff} value={exact(data.mine.detail.roundOffPaise)} />
                </>
              ) : (
                <>
                  <Row label={c.subtotal} value={exact(bill.totals.subtotalPaise - bill.totals.discountPaise)} />
                  {bill.totals.serviceChargeBp > 0 && (
                    <ServiceChargeRow c={c} bill={bill} value={exact(bill.totals.serviceChargePaise)} canEdit={bill.canEdit && online && !busy} onToggle={(w) => void act("sc", () => serviceChargeAction(data.outlet.code, shortCode, w))} />
                  )}
                  <Row label={gstLabel} value={exact(bill.totals.taxPaise)} />
                  <Row label={c.roundOff} value={exact(bill.totals.roundOffPaise)} />
                  <Row label={c.tableTotal} value={exact(total)} strong />
                  <Row label={c.equalShare(data.mine.equalBetween)} value="" />
                </>
              )}
              {data.mine.paidPaise > 0 && data.mine.duePaise > 0 && <Row label={c.alreadyPaid} value={exact(-data.mine.paidPaise)} />}
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                <dt className="font-semibold text-ink">{data.mine.duePaise === 0 && data.mine.amountPaise > 0 ? c.settledShare : c.amountDue}</dt>
                <dd className="font-display text-section font-bold text-ink tabular">{formatRupees(data.mine.duePaise || data.mine.amountPaise)}</dd>
              </div>
            </dl>
          </section>
        )}

        {/* Tip and pay */}
        {session.requested && (selected.length > 0 || others.length > 0) && (
          <section aria-label={c.pay("")} className="mt-6">
            {selected.length > 0 && (
              <>
                <h2 className="font-display text-section font-bold text-ink">{c.tip}</h2>
                <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(max(64px,5.5em),1fr))] gap-2 text-caption">
                  {([{ kind: "none" }, ...data.tipPresetsBp.map((bp) => ({ kind: "bp" as const, bp })), { kind: "custom", rupees: "" }] as Tip[]).map((t) => {
                    const active = t.kind === tip.kind && (t.kind !== "bp" || (tip.kind === "bp" && tip.bp === t.bp));
                    return (
                      <button
                        key={t.kind === "bp" ? t.bp : t.kind}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setTip(t.kind === "custom" && tip.kind === "custom" ? tip : t)}
                        className={`min-h-11 rounded-cta border px-2 text-caption font-semibold break-words ${focusRing} ${active ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink"}`}
                      >
                        {t.kind === "none" ? c.noTip : t.kind === "bp" ? pct(t.bp) : c.customTip}
                      </button>
                    );
                  })}
                </div>
                {tip.kind === "custom" && (
                  <label className="mt-2 flex items-center gap-2 rounded-input border border-line bg-surface px-3 focus-within:border-brand">
                    <span className="text-body text-muted">₹</span>
                    <input
                      inputMode="numeric"
                      aria-label={c.tipAmount}
                      value={tip.rupees}
                      onChange={(e) => setTip({ kind: "custom", rupees: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                      className="h-12 min-w-0 flex-1 bg-transparent text-body text-ink outline-none"
                    />
                  </label>
                )}
                {tipPaise > 0 && <p className={`mt-1.5 text-caption ${tipValid ? "text-muted" : "text-danger"}`}>{c.tipLine}: {formatRupees(tipPaise)}</p>}

                {selected.some((id) => id !== me?.id) && (
                  <p className="mt-3 text-caption text-muted">
                    {c.payingFor} <span className="font-semibold text-ink">{data.people.filter((p) => selected.includes(p.id)).map(shortName).join(", ")}</span>
                  </p>
                )}
                <button type="button" onClick={() => setSheet("method")} disabled={!canPay || !tipValid} className={`${primary} mt-3 min-h-14 w-full text-section`}>
                  {pay.state === "starting" && <HugeiconsIcon icon={Loading03Icon} size={20} className="animate-spin" aria-hidden />}
                  {pay.state === "starting" ? c.starting : c.pay(formatRupees(payBase + tipPaise))}
                </button>
              </>
            )}
            {others.length > 0 && (
              <button type="button" onClick={() => setSheet("others")} disabled={!canPay} className={`${outline} mt-2.5 w-full`}>
                {c.payForOthers}
              </button>
            )}
            {data.payAtCounter && <p className="mt-2 text-center text-caption text-muted">{c.counterDone}</p>}
          </section>
        )}

        {session.requested && session.isHost && (
          <button type="button" onClick={() => setSheet("reopen")} disabled={!online || !!busy} className={`mt-6 inline-flex min-h-11 items-center gap-1.5 text-body font-semibold text-brand-strong underline underline-offset-4 disabled:opacity-55 ${focusRing}`}>
            <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden />
            {c.reopen}
          </button>
        )}
      </main>

      <DiningNav tablePath={base} active="bill" lang={lang} inProgress={0} preview={!!preview} />

      {sheet === "request" && (
        <Confirm c={c} title={c.requestConfirm} body={c.requestConfirmBody} keep={c.keepOrdering} go={c.requestBill} busy={!!busy} disabled={!online} onClose={() => setSheet(null)} onGo={() => void requestBill()} />
      )}
      {sheet === "reopen" && <Confirm c={c} title={c.reopenTitle} body={c.reopenBody} keep={c.cancel} go={c.confirm} busy={!!busy} disabled={!online} onClose={() => setSheet(null)} onGo={() => void act("reopen", () => reopenAction(data.outlet.code, shortCode))} />}
      {leaving && (
        <Confirm
          c={c}
          title={c.markLeftTitle(shortName(leaving))}
          body={c.markLeftBody}
          keep={c.cancel}
          go={c.markLeft}
          busy={!!busy}
          disabled={!online}
          onClose={() => setLeaving(null)}
          onGo={() => void act("left", () => paidAndLeftAction(data.outlet.code, shortCode, leaving.id), c.markLeftDone(shortName(leaving)))}
        />
      )}

      {sheet === "method" && (
        <Sheet title={c.methodTitle} closeLabel={c.close} onClose={() => setSheet(null)}>
          <p className="mt-1 text-body text-muted">{c.pay(formatRupees(payBase + tipPaise))}</p>
          <div className="mt-4 grid gap-2.5">
            {data.onlinePayment ? (
              (["upi", "card", "wallet"] as Method[]).map((m) => (
                <MethodButton key={m} icon={m === "upi" ? SmartPhone01Icon : m === "card" ? CreditCardIcon : Wallet01Icon} title={c.methods[m]} help={c.methodHelp[m]} disabled={!online} value={m} onPick={begin} />
              ))
            ) : (
              <p className="rounded-guest bg-[var(--state-cleaning-soft)] p-3.5 text-caption text-[var(--state-cleaning-text)]">{c.noOnline}</p>
            )}
            <MethodButton icon={Store01Icon} title={c.counter} help={c.counterHelp} disabled={!online || !!data.payAtCounter} value="counter" onPick={counter} />
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-caption text-muted">
            <HugeiconsIcon icon={LockIcon} size={14} className="mt-px shrink-0" aria-hidden />
            {c.secureNote}
          </p>
        </Sheet>
      )}

      {sheet === "others" && (
        <Sheet title={c.selectShares} closeLabel={c.close} onClose={() => setSheet(null)}>
          <ul className="mt-3 divide-y divide-line/70">
            {data.people
              .filter((p) => p.duePaise > 0)
              .map((p) => {
                const checked = payFor.includes(p.id);
                const blocked = p.status === "paying";
                return (
                  <li key={p.id}>
                    <label className={`flex min-h-14 items-center gap-3 py-2 ${blocked ? "opacity-55" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blocked}
                        onChange={() => setPayFor((ids) => (checked ? ids.filter((x) => x !== p.id) : [...ids, p.id]))}
                        className="size-5 accent-[var(--brand-main)]"
                      />
                      <span className="min-w-0 flex-1 text-body font-semibold break-words">
                        {nameOf(p)}
                        {(p.removed || blocked) && <span className="block text-caption font-normal text-muted">{blocked ? c.paying : c.removed}</span>}
                      </span>
                      <span className="font-semibold tabular">{formatRupees(p.duePaise)}</span>
                    </label>
                  </li>
                );
              })}
          </ul>
          {others.length === 0 && <p className="mt-3 text-body text-muted">{c.nobodyElse}</p>}
          <button type="button" onClick={() => setSheet(null)} disabled={selected.length === 0} className={`${primary} mt-4 w-full`}>
            {c.payingSelected(formatRupees(payBase))}
          </button>
        </Sheet>
      )}
    </div>
  );
}

function StatusChip({ status, c }: { status: Person["status"]; c: G8Copy }) {
  const tone =
    status === "paid"
      ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]"
      : status === "paying"
        ? "bg-[var(--state-held-soft)] text-[var(--state-held-text)]"
        : "bg-[var(--state-paid-soft)] text-[var(--state-paid-text)]";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-label font-semibold ${tone}`}>
      <HugeiconsIcon icon={status === "paid" ? CheckmarkCircle02Icon : status === "paying" ? Loading03Icon : Clock01Icon} size={12} aria-hidden />
      {status === "paid" ? c.paid : status === "paying" ? c.paying : c.unpaid}
    </span>
  );
}

function Row({ label, hint, value, strong }: { label: string; hint?: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className={`min-w-0 ${strong ? "font-semibold text-ink" : "text-muted"}`}>
        {label}
        {hint && <span className="block text-caption break-words text-muted">{hint}</span>}
      </dt>
      <dd className={`shrink-0 tabular ${strong ? "font-semibold text-ink" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function ServiceChargeRow({ c, bill, value, canEdit, onToggle }: { c: G8Copy; bill: BillScreenData["bill"]; value: string; canEdit: boolean; onToggle: (waived: boolean) => void }) {
  const waived = bill.totals.serviceChargeWaived;
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="min-w-0 text-muted">
        <span className={waived ? "line-through" : ""}>{c.serviceCharge(pct(bill.totals.serviceChargeBp))}</span>
        <span className="block text-caption">
          {c.serviceChargeOptional}
          {canEdit && (
            <>
              {" · "}
              <button type="button" onClick={() => onToggle(!waived)} className={`-my-3 inline-flex min-h-11 items-center font-semibold text-brand-strong underline underline-offset-2 ${focusRing}`}>
                {waived ? c.addServiceCharge : c.removeServiceCharge}
              </button>
            </>
          )}
        </span>
      </dt>
      <dd className="shrink-0 text-ink tabular">{waived ? "₹0.00" : value}</dd>
    </div>
  );
}

function CustomItems({
  data,
  c,
  lineName,
  shortName,
  disabled,
  onAssign,
}: {
  data: BillScreenData;
  c: G8Copy;
  lineName: (l: { nameEn: string; nameHi: string | null }) => string;
  shortName: (p: Person) => string;
  disabled: boolean;
  onAssign: (lineId: string, ids: string[]) => void;
}) {
  const eligible = data.people.filter((p) => data.eligibleIds.includes(p.id));
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const editing = data.bill.canEdit;
  return (
    <section aria-labelledby="g8-custom" className="mt-6">
      <h2 id="g8-custom" className="font-display text-section font-bold text-ink">
        {c.customTitle}
      </h2>
      <p className="mt-1 text-caption text-muted">{editing ? c.customHelp : c.customReadOnly}</p>
      <ul className="mt-2 space-y-2.5">
        {data.lines.map((l) => (
          <li key={l.id} className="rounded-guest border border-line bg-surface p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-body font-semibold break-words">
                {lineName(l)} <span className="font-normal text-muted">× {l.qty}</span>
              </p>
              <span className="shrink-0 tabular text-ink">{formatRupees(l.amountPaise)}</span>
            </div>
            {editing && !l.settled ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {eligible.map((p) => {
                  const on = l.assignees.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      disabled={disabled}
                      onClick={() => onAssign(l.id, on ? l.assignees.filter((x) => x !== p.id) : [...l.assignees.filter((x) => data.eligibleIds.includes(x)), p.id])}
                      className={`min-h-11 rounded-full border px-3 text-caption font-semibold ${focusRing} ${on ? "border-ink bg-ink text-white" : "border-line bg-paper text-ink"} disabled:opacity-60`}
                    >
                      {on && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} className="mr-1 inline" aria-hidden />}
                      {shortName(p)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1 text-caption text-muted">
                {l.settled ? `${c.settledBy} · ` : ""}
                {l.assignees.map((id) => (byId.get(id) ? shortName(byId.get(id)!) : c.anotherGuest)).join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MethodButton<T extends string>({ icon, title, help, disabled, value, onPick }: { icon: IconSvgElement; title: string; help: string; disabled?: boolean; value: T; onPick: (v: T) => unknown }) {
  return (
    <button type="button" onClick={() => void onPick(value)} disabled={disabled} className={`flex min-h-16 w-full items-center gap-3 rounded-guest border border-line bg-surface px-4 py-3 text-left hover:border-ink/40 disabled:opacity-55 ${focusRing}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-input bg-brand-soft text-brand-strong" aria-hidden>
        <HugeiconsIcon icon={icon} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-ink">{title}</span>
        <span className="block text-caption text-muted">{help}</span>
      </span>
      <HugeiconsIcon icon={ArrowRight01Icon} size={18} className="shrink-0 text-muted" aria-hidden />
    </button>
  );
}

function PaymentPanel({
  state,
  c,
  dueText,
  online,
  onRetry,
  onCounter,
  onDismiss,
}: {
  state: PayState;
  c: G8Copy;
  dueText: string;
  online: boolean;
  onRetry: () => void;
  onCounter: () => void;
  onDismiss: () => void;
}) {
  if (state === "ready" || state === "starting") return null;
  if (state === "verifying" || state === "unknown") {
    return (
      <div role="status" aria-live="polite" className="mt-4 flex items-start gap-3 rounded-guest border border-[var(--state-held)]/25 bg-[var(--state-held-soft)] p-4 text-[var(--state-held-text)]">
        <HugeiconsIcon icon={Loading03Icon} size={22} className="mt-px shrink-0 animate-spin" aria-hidden />
        <div>
          <p className="text-body font-semibold">{c.checkingTitle}</p>
          <p className="mt-0.5 text-caption text-ink/80">{c.checkingBody}</p>
        </div>
      </div>
    );
  }
  if (state === "success") {
    return (
      <div role="status" className="mt-4 flex items-start gap-3 rounded-guest border border-success/25 bg-[var(--state-available-soft)] p-4 text-[var(--state-available-text)]">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={22} className="mt-px shrink-0" aria-hidden />
        <div>
          <p className="text-body font-semibold">{c.successTitle}</p>
          <p className="mt-0.5 text-caption text-ink/80">{c.successBody}</p>
        </div>
      </div>
    );
  }
  const cancelled = state === "cancelled";
  return (
    <div role="alert" className="mt-4 rounded-guest border border-line bg-surface p-4 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--state-seated-soft)] text-danger" aria-hidden>
        <HugeiconsIcon icon={cancelled ? InformationCircleIcon : AlertCircleIcon} size={22} />
      </span>
      <p className="mt-2 font-display text-section font-bold text-ink">{cancelled ? c.cancelledTitle : c.failedTitle}</p>
      <p className="mt-1 text-caption text-muted">{cancelled ? c.cancelledBody : state === "gateway_down" ? c.gatewayDownBody : c.failedBody}</p>
      <p className="mt-3 flex items-center justify-between rounded-input bg-paper px-3 py-2 text-body">
        <span className="text-muted">{c.yourShare}</span>
        <span className="font-semibold tabular">
          {dueText} · {c.stillUnpaid}
        </span>
      </p>
      <div className="mt-3 grid gap-2">
        <button type="button" onClick={onRetry} disabled={!online} className={`${primary} w-full`}>
          {c.tryAgain}
        </button>
        <button type="button" onClick={onRetry} disabled={!online} className={`${outline} w-full`}>
          {c.otherMethod}
        </button>
        <button type="button" onClick={onCounter} disabled={!online} className={`${outline} w-full`}>
          {c.counterInstead}
        </button>
        <button type="button" onClick={onDismiss} className={`min-h-11 text-caption font-semibold text-muted underline underline-offset-2 ${focusRing}`}>
          {c.close}
        </button>
      </div>
    </div>
  );
}

const BANNER_TONE = {
  info: "border-[var(--state-cleaning)]/20 bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
  offline: "border-line bg-surface text-ink",
} as const;

function Banner({ icon, tone, title, body }: { icon: IconSvgElement; tone: keyof typeof BANNER_TONE; title: string; body: string }) {
  return (
    <div role="status" className={`mt-4 flex items-start gap-3 rounded-guest border px-4 py-3 ${BANNER_TONE[tone]}`}>
      <HugeiconsIcon icon={icon} size={20} className="mt-px shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-body font-semibold">{title}</p>
        <p className="mt-0.5 text-caption text-ink/75">{body}</p>
      </div>
    </div>
  );
}

function Confirm({
  c,
  title,
  body,
  keep,
  go,
  busy,
  disabled,
  onClose,
  onGo,
}: {
  c: G8Copy;
  title: string;
  body: string;
  keep: string;
  go: string;
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  onGo: () => void;
}): ReactNode {
  return (
    <Sheet title={title} closeLabel={c.close} busy={busy} onClose={onClose}>
      <p className="mt-2 text-body text-muted">{body}</p>
      <div className="mt-6 grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2">
        <button type="button" onClick={onClose} disabled={busy} className={outline}>
          {keep}
        </button>
        <button type="button" onClick={onGo} disabled={busy || disabled} aria-busy={busy || undefined} className={primary}>
          {busy && <HugeiconsIcon icon={Loading03Icon} size={18} className="animate-spin" aria-hidden />}
          {go}
        </button>
      </div>
    </Sheet>
  );
}
