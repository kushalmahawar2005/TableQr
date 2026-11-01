"use client";

import {
  AlertCircleIcon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
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
import { openCheckout } from "@/lib/payments/checkout";
import type { BillScreenData } from "@/server/guest/bill-screen";
import { DiningNav } from "../../_components/dining-nav";
import { RoomDashboardLink } from "../../_components/room-dashboard-link";
import { LanguageToggle } from "../../_components/language-toggle";
import { OutletLogo } from "../../_components/outlet-logo";
import { focusRing, Sheet } from "../../_components/sheet";
import { serviceRequestAction } from "../../orders/actions";
import {
  customAmountsAction,
  paidAndLeftAction,
  payAtCounterAction,
  paidUpiAction,
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
  /** Custom amounts being typed by the host, in rupees, before saving */
  custom?: Record<string, string>;
  /** The ordered-items list opened in full */
  allItems?: boolean;
};

const button = `inline-flex min-h-12 items-center justify-center gap-2 rounded-cta px-4 py-2.5 text-button font-semibold transition-colors duration-150 ease-natural disabled:cursor-not-allowed disabled:opacity-55 ${focusRing}`;
const outline = `${button} border border-line bg-surface text-ink hover:border-ink/40`;
const primary = `${button} bg-brand text-brand-on hover:bg-brand-hover active:bg-brand-pressed`;

const exact = (paise: number) =>
  `${paise < 0 ? "−" : ""}₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bp: number) => `${(bp / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

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
              : error === "total"
                ? c.customTotalError
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
        setNotice({ text: errorText(res.error), error: res.error === "failed" || res.error === "total" });
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
        await openCheckout(res.checkout);
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
  // One step for a guest in a hurry: get the bill and go straight to choosing how to pay,
  // or straight to the counter while online payment is off
  const billAndPay = async () => {
    let asked = false;
    await act("request", async () => {
      const res = await serviceRequestAction(data.outlet.code, shortCode, "request_bill", `bill-${session.key}`.slice(0, 64));
      asked = res.ok;
      return res.ok ? { ok: true as const } : { ok: false as const, error: (res.error === "gone" ? "gone" : res.error === "host_only" ? "host_only" : "failed") as BillError };
    });
    if (asked && data.onlinePayment) setSheet("method");
    else if (asked && !data.payAtCounter) await counter();
  };


  const total = bill.totals.totalPaise;
  const remainingTotal = Math.min(total, data.people.reduce((n, p) => n + p.duePaise, 0));
  const paidTotal = Math.max(0, total - remainingTotal);
  const paidPct = total > 0 ? Math.round((paidTotal / total) * 100) : 0;
  const taxRates = Object.keys(bill.totals.taxBreakup);
  const gstLabel = taxRates.length === 1 ? c.gst(pct(Number(taxRates[0]))) : c.gstMixed;
  const host = data.people.find((p) => p.isHost);
  const requestedMins = bill.requestedAt === null ? null : Math.max(0, Math.floor((data.renderedAt - bill.requestedAt) / 60_000));
  const customEditing = bill.mode === "custom" && bill.canEdit;
  const scToggle = (w: boolean) => void act("sc", () => serviceChargeAction(data.outlet.code, shortCode, w));
  const openOthers = (id?: string) => {
    if (id) setPayFor((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setSheet("others");
  };

  return (
    <div lang={lang} style={brandStyle(deriveBrandTokens(data.outlet.accentColor)) as CSSProperties} className={`relative flex flex-1 flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}>
      <header className="flex items-center gap-3 pt-4">
        <OutletLogo name={data.outlet.name} logoUrl={data.outlet.logoUrl} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-title leading-tight font-bold text-ink">{c.title}</h1>
          <p className="text-caption break-words text-muted">
            {data.outlet.name} · {c.tableLine(data.table.code)}
          </p>
        </div>
        <LanguageToggle lang={lang} label={c.language} preview={!!preview} />
      </header>
      <RoomDashboardLink outletCode={data.outlet.code} shortCode={shortCode} tableCode={data.table.code} lang={lang} preview={!!preview} />

      <main className="pb-6">
        {!online && <Banner icon={WifiOff01Icon} tone="offline" title={c.offline} body={c.offlineBody} />}
        {session.requested && !bill.reopened && (
          <Banner icon={CheckmarkCircle02Icon} tone="done" title={c.requested} meta={c.requestedBy(session.hostName, session.hostIsMe, requestedMins)} body={c.requestedBody} />
        )}
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
          amountText={pay.state === "starting" ? formatRupees(payBase + tipPaise) : null}
          online={online}
          onRetry={() => setSheet("method")}
          onCounter={() => void counter()}
          onDismiss={() => setPay({ state: "ready", paymentId: null })}
        />

        {!session.requested ? (
          <BeforeRequest
            data={data}
            c={c}
            base={base}
            preview={!!preview}
            lineName={lineName}
            allItems={!!preview?.allItems}
            action={
              session.isHost ? (
                <>
                  <button type="button" onClick={() => setSheet("request")} disabled={!online || !!busy || data.people.length === 0} className={`${primary} mt-4 w-full`}>
                    <HugeiconsIcon icon={Invoice01Icon} size={18} aria-hidden />
                    {c.requestBill}
                  </button>
                  <button type="button" onClick={() => void billAndPay()} disabled={!online || !!busy || data.people.length === 0} className="mt-2.5 min-h-12 w-full rounded-cta border border-line bg-surface px-4 text-button font-semibold text-ink focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50">
                    {data.onlinePayment ? c.billAndPay : c.billAndCounter}
                  </button>
                  <p className="mt-2 text-center text-caption text-muted">{c.requestBillHelp}</p>
                </>
              ) : (
                <p className="mt-4 rounded-guest bg-ink/[0.04] px-4 py-3 text-caption text-ink">
                  {c.hostRequests(session.hostName)} {c.previewNote}
                </p>
              )
            }
          />
        ) : (
          <>
            {/* Table total: a receipt with how much of it is already paid */}
            <section aria-label={c.tableTotal} className="mt-4 overflow-hidden rounded-guest border border-line bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.05)]">
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-line bg-brand-soft/40 px-4 py-3">
                <h2 className="flex items-center gap-2 font-display text-section font-bold text-ink">
                  <HugeiconsIcon icon={Invoice01Icon} size={18} className="text-brand-strong" aria-hidden />
                  {c.yourBill}
                </h2>
                <span className="text-caption text-muted">{c.paidOf(bill.paidCount, data.people.length)}</span>
              </div>
              <dl className="space-y-1.5 px-4 pt-3 text-body">
                {bill.totals.discountPaise > 0 && <Row label={c.subtotal} value={exact(bill.totals.subtotalPaise)} />}
                {bill.totals.discountPaise > 0 && <Row label={c.discount} value={`− ${exact(bill.totals.discountPaise)}`} />}
                <Row label={bill.totals.discountPaise > 0 ? c.afterDiscount : c.subtotal} value={exact(bill.totals.subtotalPaise - bill.totals.discountPaise)} />
                {bill.totals.serviceChargeBp > 0 && <Row label={c.serviceCharge(pct(bill.totals.serviceChargeBp))} value={exact(bill.totals.serviceChargePaise)} />}
                <Row label={gstLabel} value={exact(bill.totals.taxPaise)} />
                <div className="!mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
                  <dt className="font-semibold text-ink">{c.tableTotal}</dt>
                  <dd className="font-display text-title leading-tight font-bold text-ink tabular">{formatRupees(total)}</dd>
                </div>
              </dl>
              <div className="px-4 pt-3 pb-4">
                <div className="flex justify-between gap-3 text-caption font-semibold tabular">
                  <span className="text-[var(--state-available-text)]">{c.paidAmount(formatRupees(paidTotal))}</span>
                  <span className="text-brand-strong">{c.remainingAmount(formatRupees(remainingTotal))}</span>
                </div>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={paidPct} className="mt-1.5 h-2 overflow-hidden rounded-full bg-brand-soft">
                  <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${paidPct}%` }} />
                </div>
              </div>
            </section>

            {/* Split mode */}
            {data.groupSplit && (
            <section aria-labelledby="g8-split" className="mt-6">
              <h2 id="g8-split" className="font-display text-section font-bold text-ink">
                {c.split}
              </h2>
              <div role="radiogroup" aria-labelledby="g8-split" className="mt-2 grid grid-cols-[repeat(3,minmax(min-content,1fr))] gap-1 rounded-cta border border-line/80 bg-surface p-1 shadow-[0_1px_3px_rgb(0_0_0/0.05)]">
                {(["my_items", "equal", "custom"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={bill.mode === m}
                    disabled={!bill.canEdit || !online || !!busy}
                    onClick={() => bill.mode !== m && void act(`mode-${m}`, () => splitModeAction(data.outlet.code, shortCode, m))}
                    className={`min-h-11 rounded-input px-1.5 text-caption font-semibold transition-colors ${focusRing} ${bill.mode === m ? "border border-brand-border bg-brand-soft text-brand-strong shadow-[0_1px_2px_rgb(31_41_55/0.12)]" : "text-muted enabled:hover:text-ink"}`}
                  >
                    {c.modes[m]}
                  </button>
                ))}
              </div>
              {(bill.locked || !session.isHost) && (
                <p className="mt-2 flex items-start gap-1.5 text-caption text-muted">
                  <HugeiconsIcon icon={bill.locked ? LockIcon : CrownIcon} size={14} className="mt-px shrink-0" aria-hidden />
                  {bill.locked ? c.splitLocked : bill.mode === "custom" && bill.custom.valid ? c.customReadOnly(session.hostName) : c.splitHostOnly(session.hostName)}
                </p>
              )}
              {bill.mode === "custom" && !bill.custom.valid && !customEditing && <p className="mt-2 rounded-guest bg-[var(--state-held-soft)] px-3.5 py-2.5 text-caption text-[var(--state-held-text)]">{c.customStale(session.hostName)}</p>}
            </section>
            )}

            {customEditing ? (
              <CustomAmounts
                key={`${JSON.stringify(bill.custom.amounts)}-${bill.custom.targetPaise}`}
                data={data}
                c={c}
                nameOf={nameOf}
                draft={preview?.custom}
                disabled={!online || !!busy}
                busy={busy === "custom"}
                onSave={(amounts) => void act("custom", () => customAmountsAction(data.outlet.code, shortCode, amounts), c.customSaved)}
              />
            ) : (
              <section aria-labelledby="g8-people" className="mt-6">
                <h2 id="g8-people" className="font-display text-section font-bold text-ink">
                  {c.people} <span className="font-normal text-muted">({data.people.length})</span>
                </h2>
                <ul className="mt-2 space-y-2">
                  {data.people.map((p) => {
                    const hostMenu = session.isHost && !p.isHost && p.status === "paid" && !p.paidAndLeft && !p.removed;
                    const payable = !p.isMe && p.status === "unpaid" && p.duePaise > 0 && canPay;
                    const body = (
                      <>
                        <Avatar name={p.name} muted={p.removed || p.paidAndLeft} />
                        <span className="min-w-[min(100%,6em)] flex-1 text-body">
                          <span className={`block text-body font-semibold break-words ${p.removed || p.paidAndLeft ? "text-muted" : "text-ink"}`}>
                            {nameOf(p)}
                            {p.isHost && (
                              <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--state-held-soft)] px-1.5 py-px align-middle text-label font-semibold text-[var(--state-held-text)]">
                                <HugeiconsIcon icon={CrownIcon} size={11} aria-hidden />
                                {c.host}
                              </span>
                            )}
                          </span>
                          {(p.removed || p.paidAndLeft || p.paidBy || p.paidByMe) && (
                            <span className="block text-caption text-muted">
                              {[p.removed ? c.removed : null, p.paidAndLeft ? c.paidAndLeft : null, p.paidByMe ? c.paidByYou : p.paidBy ? c.paidBy(p.paidBy) : null].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </span>
                        <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                          <span className="text-body font-semibold text-ink tabular">{formatRupees(p.amountPaise)}</span>
                          <StatusChip status={p.status} c={c} />
                        </span>
                      </>
                    );
                    return (
                      <li key={p.id} className="flex items-center rounded-guest border border-line/80 bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.05)]">
                        {payable ? (
                          <button type="button" onClick={() => openOthers(p.id)} aria-label={`${c.payFor(shortName(p))}, ${formatRupees(p.duePaise)}`} className={`flex min-h-16 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-left ${focusRing}`}>
                            {body}
                            <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="shrink-0 text-muted" aria-hidden />
                          </button>
                        ) : (
                          <div className="flex min-h-16 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                            {body}
                            {/* Keeps amounts lined up with the rows that end in a chevron */}
                            {!hostMenu && canPay && <span aria-hidden className="w-4 shrink-0" />}
                            {hostMenu && (
                              <button type="button" onClick={() => setLeaving(p)} aria-label={c.moreFor(shortName(p))} className={`-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-ink/5 ${focusRing}`}>
                                <HugeiconsIcon icon={MoreHorizontalIcon} size={20} aria-hidden />
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Your share */}
            {data.mine && (
              <section aria-labelledby="g8-mine" className="mt-6 rounded-guest border border-line bg-surface p-4 shadow-[0_1px_3px_rgb(0_0_0/0.05)]">
                <h2 id="g8-mine" className="font-display text-section font-bold text-ink">
                  {c.yourShare}
                </h2>
                <dl className="mt-3 space-y-2 text-body">
                  {data.mine.detail ? (
                    <>
                      <Row label={c.yourDishes} hint={data.mine.ownItems.map(itemName).join(", ")} value={exact(data.mine.detail.ownItemsPaise)} />
                      {data.mine.detail.sharedItemsPaise > 0 && <Row label={c.shared} hint={data.mine.sharedItems.map(itemName).join(", ")} value={exact(data.mine.detail.sharedItemsPaise)} />}
                      {data.mine.detail.discountPaise > 0 && <Row label={c.discount} value={exact(-data.mine.detail.discountPaise)} />}
                      <Row label={c.subtotal} value={exact(data.mine.detail.subtotalPaise - data.mine.detail.discountPaise)} strong />
                      {bill.totals.serviceChargeBp > 0 && <ServiceChargeRow c={c} bill={bill} value={exact(data.mine.detail.serviceChargePaise)} canEdit={bill.canEdit && online && !busy} onToggle={scToggle} />}
                      <Row label={gstLabel} value={exact(data.mine.detail.taxPaise)} />
                      <Row label={c.roundOff} value={exact(data.mine.detail.roundOffPaise)} />
                    </>
                  ) : (
                    <>
                      <Row label={c.subtotal} value={exact(bill.totals.subtotalPaise - bill.totals.discountPaise)} />
                      {bill.totals.discountPaise > 0 && <Row label={c.discount} value={exact(-bill.totals.discountPaise)} />}
                      {bill.totals.serviceChargeBp > 0 && <ServiceChargeRow c={c} bill={bill} value={exact(bill.totals.serviceChargePaise)} canEdit={bill.canEdit && online && !busy} onToggle={scToggle} />}
                      <Row label={gstLabel} value={exact(bill.totals.taxPaise)} />
                      <Row label={c.roundOff} value={exact(bill.totals.roundOffPaise)} />
                      <Row label={c.tableTotal} hint={c.includingTax} value={exact(total)} strong />
                      <Row label={data.mine.basis === "custom" ? c.customBy(host?.name ?? session.hostName) : c.equalShare(data.mine.equalBetween)} value="" />
                    </>
                  )}
                  {data.mine.paidPaise > 0 && data.mine.duePaise > 0 && <Row label={c.alreadyPaid} value={exact(-data.mine.paidPaise)} />}
                  <div className="!mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
                    <dt className="font-semibold text-ink">{data.mine.duePaise === 0 && data.mine.amountPaise > 0 ? c.settledShare : c.amountDue}</dt>
                    <dd className="font-display text-title leading-tight font-bold text-ink tabular">{formatRupees(data.mine.duePaise || data.mine.amountPaise)}</dd>
                  </div>
                </dl>
              </section>
            )}

            {/* The restaurant's own UPI: pay from any UPI app, then say so; staff confirm and settle */}
            {data.upi && session.status === "bill_requested" && remainingTotal > 0 && (
              <UpiPay
                upi={data.upi}
                amountPaise={myDue > 0 ? myDue : remainingTotal}
                note={`${data.outlet.name} ${data.table.code}`}
                lang={lang}
                claimed={data.paidUpi}
                disabled={!online || !!busy}
                onPaid={() => void act("upi", () => paidUpiAction(data.outlet.code, shortCode, `upi-${session.key}`.slice(0, 64)), lang === "hi" ? "स्टाफ आपका भुगतान जाँच रहा है।" : "Staff are checking your payment.")}
              />
            )}

            {/* No online payment: everyone settles at the counter */}
            {!data.onlinePayment && remainingTotal > 0 && (
              <section aria-label={c.counter} className="mt-6">
                <button type="button" onClick={() => void counter()} disabled={!online || !!busy || !!data.payAtCounter} className={`${primary} min-h-14 w-full text-section`}>
                  <HugeiconsIcon icon={Store01Icon} size={20} aria-hidden />
                  {c.counter}
                </button>
                <p className="mt-2 text-center text-caption text-muted">{data.payAtCounter ? c.counterDone : c.counterHelp}</p>
              </section>
            )}

            {/* Tip and pay */}
            {data.onlinePayment && (selected.length > 0 || others.length > 0) && (
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
                    {tipPaise > 0 && (
                      <p className={`mt-1.5 text-caption ${tipValid ? "text-muted" : "text-danger"}`}>
                        {c.tipLine}: {formatRupees(tipPaise)}
                      </p>
                    )}

                    {selected.some((id) => id !== me?.id) && (
                      <p className="mt-3 text-caption text-muted">
                        {c.payingFor} <span className="font-semibold text-ink">{data.people.filter((p) => selected.includes(p.id)).map(shortName).join(", ")}</span>
                      </p>
                    )}
                    <button type="button" onClick={() => setSheet("method")} disabled={!canPay || !tipValid} className={`${primary} mt-4 min-h-14 w-full text-section`}>
                      {pay.state === "starting" && <HugeiconsIcon icon={Loading03Icon} size={20} className="animate-spin" aria-hidden />}
                      {pay.state === "starting" ? c.starting : c.pay(formatRupees(payBase + tipPaise))}
                    </button>
                  </>
                )}
                {others.length > 0 && (
                  <button type="button" onClick={() => openOthers()} disabled={!canPay} className={`${outline} mt-2.5 w-full`}>
                    {c.payForOthers}
                  </button>
                )}
                {data.payAtCounter && <p className="mt-2 text-center text-caption text-muted">{c.counterDone}</p>}
              </section>
            )}

            {session.isHost && (
              <button type="button" onClick={() => setSheet("reopen")} disabled={!online || !!busy} className={`mt-6 inline-flex min-h-11 items-center gap-1.5 text-body font-semibold text-brand-strong underline underline-offset-4 disabled:opacity-55 ${focusRing}`}>
                <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden />
                {c.reopen}
              </button>
            )}
          </>
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
          <p className="mt-1 flex items-baseline justify-between gap-3 text-body">
            <span className="text-muted">{c.totalToPay}</span>
            <span className="font-display text-section font-bold text-ink tabular">{formatRupees(payBase + tipPaise)}</span>
          </p>
          <div className="mt-4 grid gap-2.5">
            {data.onlinePayment ? (
              (["upi", "card", "wallet"] as Method[]).map((m) => (
                <MethodButton
                  key={m}
                  icon={m === "upi" ? SmartPhone01Icon : m === "card" ? CreditCardIcon : Wallet01Icon}
                  title={c.methods[m]}
                  badge={m === "upi" ? c.recommended : undefined}
                  help={c.methodHelp[m]}
                  disabled={!online}
                  value={m}
                  onPick={begin}
                />
              ))
            ) : (
              <p className="rounded-guest bg-[var(--state-cleaning-soft)] p-3.5 text-caption text-[var(--state-cleaning-text)]">{c.noOnline}</p>
            )}
            <MethodButton icon={Store01Icon} title={c.counter} help={c.counterHelp} disabled={!online || !!data.payAtCounter} value="counter" onPick={counter} />
          </div>
          <p className="mt-4 flex items-start gap-1.5 text-caption text-muted">
            <HugeiconsIcon icon={LockIcon} size={14} className="mt-px shrink-0" aria-hidden />
            {c.secureNote}
          </p>
        </Sheet>
      )}

      {sheet === "others" && (
        <Sheet title={c.selectShares} closeLabel={c.close} onClose={() => setSheet(null)}>
          <p className="mt-1 text-body text-muted">{c.selectHelp}</p>
          <ul className="mt-3 divide-y divide-line/70">
            {data.people
              .filter((p) => p.duePaise > 0)
              .map((p) => {
                const checked = payFor.includes(p.id);
                const blocked = p.status === "paying";
                return (
                  <li key={p.id}>
                    <label className={`flex min-h-14 cursor-pointer items-center gap-3 py-2 ${blocked ? "cursor-not-allowed opacity-55" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blocked}
                        onChange={() => setPayFor((ids) => (checked ? ids.filter((x) => x !== p.id) : [...ids, p.id]))}
                        className="size-5 shrink-0 accent-[var(--brand-main)]"
                      />
                      <Avatar name={p.name} />
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
          <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
            <span className="text-body font-semibold text-ink">{c.totalToPay}</span>
            <span className="font-display text-title leading-tight font-bold text-ink tabular">{formatRupees(payBase)}</span>
          </div>
          <button type="button" onClick={() => setSheet("method")} disabled={selected.length === 0 || !canPay} className={`${primary} mt-4 w-full`}>
            {c.continuePay}
          </button>
        </Sheet>
      )}
    </div>
  );
}

function BeforeRequest({
  data,
  c,
  base,
  preview,
  lineName,
  allItems,
  action,
}: {
  data: BillScreenData;
  c: G8Copy;
  base: string;
  preview: boolean;
  lineName: (l: { nameEn: string; nameHi: string | null }) => string;
  allItems: boolean;
  action: ReactNode;
}) {
  const [all, setAll] = useState(allItems);
  const shown = all ? data.lines : data.lines.slice(0, 4);
  const hidden = data.lines.length - shown.length;
  return (
    <>
      <section aria-labelledby="g8-live" className="mt-5">
        <h2 id="g8-live" className="font-display text-section font-bold text-ink">
          {c.liveBill}
        </h2>
        <p className="text-caption text-muted">{c.liveBillNote}</p>
        <a href={preview ? "#" : `${base}/orders`} aria-label={`${c.seeOrders}: ${c.roundsItems(data.bill.rounds, data.bill.itemCount)}, ${formatRupees(data.bill.totals.subtotalPaise)}`} className={`mt-3 flex min-h-16 items-center gap-3 rounded-guest border border-line bg-surface px-4 py-3 hover:border-ink/30 ${focusRing}`}>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-ink">{c.roundsItems(data.bill.rounds, data.bill.itemCount)}</span>
            <span className="block text-caption text-muted">{c.beforeGst}</span>
          </span>
          <span className="font-display text-title leading-tight font-bold text-ink tabular">{formatRupees(data.bill.totals.subtotalPaise)}</span>
          <HugeiconsIcon icon={ArrowRight01Icon} size={18} className="shrink-0 text-muted" aria-hidden />
        </a>
        {action}
      </section>
      {data.lines.length > 0 && (
        <section aria-labelledby="g8-items" className="mt-6">
          <h2 id="g8-items" className="font-display text-section font-bold text-ink">
            {c.orderedItems}
          </h2>
          <ul className="mt-2 divide-y divide-line/70 rounded-guest border border-line bg-surface px-4">
            {shown.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block text-body font-semibold break-words text-ink">{lineName(l)}</span>
                  <span className="block text-caption text-muted tabular">
                    {l.qty} × {formatRupees(Math.round(l.amountPaise / l.qty))}
                  </span>
                </span>
                <span className="shrink-0 text-body text-ink tabular">{formatRupees(l.amountPaise)}</span>
              </li>
            ))}
          </ul>
          {data.lines.length > 4 && (
            <button type="button" onClick={() => setAll(!all)} aria-expanded={all} className={`mt-1 inline-flex min-h-11 items-center text-body font-semibold text-brand-strong underline underline-offset-4 ${focusRing}`}>
              {all ? c.fewerItems : c.moreItems(hidden)}
            </button>
          )}
        </section>
      )}
    </>
  );
}

/** Host-only Custom split: one whole-rupee amount per person, saved only when it adds up exactly */
function CustomAmounts({
  data,
  c,
  nameOf,
  draft: previewDraft,
  disabled,
  busy,
  onSave,
}: {
  data: BillScreenData;
  c: G8Copy;
  nameOf: (p: Person) => string;
  draft?: Record<string, string>;
  disabled: boolean;
  busy: boolean;
  onSave: (amounts: Record<string, number>) => void;
}) {
  const { custom } = data.bill;
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const start = () =>
    Object.fromEntries(custom.ids.map((id) => [id, String(Math.round((custom.valid && custom.amounts ? (custom.amounts[id] ?? 0) : (byId.get(id)?.amountPaise ?? 0)) / 100))]));
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...start(), ...previewDraft }));
  const fixed = data.people.filter((p) => !custom.ids.includes(p.id));
  const fixedPaise = fixed.reduce((n, p) => n + p.amountPaise, 0);
  const allocated = custom.ids.reduce((n, id) => n + Number(draft[id] || 0) * 100, 0) + fixedPaise;
  const total = data.bill.totals.totalPaise;
  const left = total - allocated;
  const saved = custom.valid && !!custom.amounts && custom.ids.every((id) => Number(draft[id] || 0) * 100 === custom.amounts![id]);
  return (
    <section aria-labelledby="g8-custom" className="mt-6">
      <h2 id="g8-custom" className="font-display text-section font-bold text-ink">
        {c.customTitle}
      </h2>
      <p className="mt-0.5 text-caption text-muted">{custom.valid ? c.customHelp : c.customStaleHost}</p>
      <ul className="mt-3 divide-y divide-line/70 rounded-guest border border-line bg-surface">
        {custom.ids.map((id) => {
          const p = byId.get(id);
          const name = p ? nameOf(p) : c.anotherGuest;
          return (
            <li key={id} className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
              <Avatar name={p?.name ?? null} />
              <span className="min-w-[6em] flex-1 text-body font-semibold break-words text-ink">{name}</span>
              <label className="flex h-12 w-[7.5em] items-center gap-1 rounded-input border border-line bg-paper px-3 focus-within:border-brand focus-within:bg-surface">
                <span className="text-body text-muted">₹</span>
                <input
                  inputMode="numeric"
                  aria-label={c.amountFor(p?.name ?? name)}
                  value={draft[id] ?? ""}
                  disabled={disabled}
                  onChange={(e) => setDraft((d) => ({ ...d, [id]: e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 6) }))}
                  className="min-w-0 flex-1 bg-transparent text-right text-body font-semibold text-ink tabular outline-none disabled:opacity-60"
                />
              </label>
            </li>
          );
        })}
        {fixed.map((p) => (
          <li key={p.id} className="flex min-h-14 items-center gap-3 px-3.5 py-2.5">
            <Avatar name={p.name} muted />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold break-words text-muted">{nameOf(p)}</span>
              <span className="block text-caption text-muted">{p.paidAndLeft ? c.fixedLeft : c.fixedRemoved}</span>
            </span>
            <span className="shrink-0 text-body text-muted tabular">{formatRupees(p.amountPaise)}</span>
          </li>
        ))}
      </ul>
      <dl aria-live="polite" className="mt-3 space-y-1.5 rounded-guest bg-ink/[0.04] px-4 py-3 text-body">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{c.tableTotal}</dt>
          <dd className="text-ink tabular">{formatRupees(total)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{c.allocated}</dt>
          <dd className="text-ink tabular">{formatRupees(allocated)}</dd>
        </div>
        <div className={`flex items-baseline justify-between gap-3 font-semibold ${left === 0 ? "text-[var(--state-available-text)]" : left > 0 ? "text-[var(--state-held-text)]" : "text-danger"}`}>
          <dt className="flex items-center gap-1.5">
            {left === 0 && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden />}
            {left < 0 ? c.overBy : c.remaining}
          </dt>
          <dd className="tabular">{formatRupees(Math.abs(left))}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={() => onSave(Object.fromEntries(custom.ids.map((id) => [id, Number(draft[id] || 0) * 100])))}
        disabled={disabled || left !== 0 || saved}
        aria-busy={busy || undefined}
        className={`${saved ? outline : primary} mt-3 w-full`}
      >
        {busy ? <HugeiconsIcon icon={Loading03Icon} size={18} className="animate-spin" aria-hidden /> : saved ? <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} aria-hidden /> : null}
        {saved ? c.savedAmounts : c.saveAmounts}
      </button>
    </section>
  );
}

function Avatar({ name, muted = false }: { name: string | null; muted?: boolean }) {
  const letter = name?.trim().charAt(0).toLocaleUpperCase();
  return (
    <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-full text-body font-bold ${muted ? "bg-ink/[0.05] text-muted" : "bg-brand-soft text-brand-strong"}`}>
      {letter || "·"}
    </span>
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
    <div className="flex flex-wrap items-start justify-between gap-x-3">
      <dt className={`min-w-[min(100%,9em)] flex-1 ${strong ? "font-semibold text-ink" : "text-muted"}`}>
        {label}
        {hint && <span className="block text-caption font-normal break-words text-muted">{hint}</span>}
      </dt>
      <dd className={`ml-auto shrink-0 tabular ${strong ? "font-semibold text-ink" : "text-ink"}`}>{value}</dd>
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

function MethodButton<T extends string>({
  icon,
  title,
  badge,
  help,
  disabled,
  value,
  onPick,
}: {
  icon: IconSvgElement;
  title: string;
  badge?: string;
  help: string;
  disabled?: boolean;
  value: T;
  onPick: (v: T) => unknown;
}) {
  return (
    <button type="button" onClick={() => void onPick(value)} disabled={disabled} className={`flex min-h-16 w-full items-center gap-3 rounded-guest border border-line bg-surface px-4 py-3 text-left hover:border-ink/40 disabled:opacity-55 ${focusRing}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-input bg-brand-soft text-brand-strong" aria-hidden>
        <HugeiconsIcon icon={icon} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body font-semibold text-ink">
          {title}
          {badge && <span className="rounded-full bg-[var(--state-available-soft)] px-2 py-px text-label font-semibold text-[var(--state-available-text)]">{badge}</span>}
        </span>
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
  amountText,
  online,
  onRetry,
  onCounter,
  onDismiss,
}: {
  state: PayState;
  c: G8Copy;
  dueText: string;
  amountText: string | null;
  online: boolean;
  onRetry: () => void;
  onCounter: () => void;
  onDismiss: () => void;
}) {
  if (state === "ready") return null;
  if (state === "starting" || state === "verifying" || state === "unknown") {
    // Steps say only what is known: started, back from the gateway, then waiting on its answer
    const reached = state === "starting" ? 0 : 2;
    return (
      <div role="status" aria-live="polite" className="mt-4 rounded-guest border border-line bg-surface px-4 py-5">
        <div className="flex flex-col items-center text-center">
          <span className="grid size-14 place-items-center rounded-full bg-brand-soft text-brand-strong" aria-hidden>
            <HugeiconsIcon icon={Loading03Icon} size={28} className="animate-spin" />
          </span>
          <p className="mt-3 font-display text-section font-bold text-ink">{state === "starting" ? c.startingTitle : c.checkingTitle}</p>
          {amountText && <p className="font-display text-title font-bold text-ink tabular">{amountText}</p>}
          <p className="mt-1 text-body font-semibold text-ink">{state === "starting" ? c.dontClose : c.checkingBody}</p>
          {state !== "starting" && <p className="mt-1 text-caption text-muted">{state === "unknown" ? c.slowNote : c.checkingNote}</p>}
        </div>
        <ol className="mx-auto mt-4 max-w-xs space-y-2.5 text-body">
          {c.steps.map((step, i) => {
            const done = i < reached;
            const active = i === reached;
            return (
              <li key={step} className={`flex items-center gap-2.5 ${done ? "text-ink" : active ? "font-semibold text-ink" : "text-muted"}`}>
                <HugeiconsIcon
                  icon={done ? CheckmarkCircle02Icon : active ? Loading03Icon : CircleIcon}
                  size={18}
                  className={`shrink-0 ${done ? "text-success" : active ? "animate-spin text-brand-strong" : "text-line"}`}
                  aria-hidden
                />
                {step}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }
  if (state === "success") {
    return (
      <div role="status" className="mt-4 flex flex-col items-center rounded-guest border border-success/25 bg-[var(--state-available-soft)] px-4 py-5 text-center text-[var(--state-available-text)]">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={36} aria-hidden />
        <p className="mt-2 font-display text-section font-bold">{c.successTitle}</p>
        <p className="mt-0.5 text-caption text-ink/80">{c.successBody}</p>
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
  done: "border-success/20 bg-[var(--state-available-soft)] text-[var(--state-available-text)]",
  offline: "border-line bg-surface text-ink",
} as const;

function Banner({ icon, tone, title, meta, body }: { icon: IconSvgElement; tone: keyof typeof BANNER_TONE; title: string; meta?: string; body: string }) {
  return (
    <div role="status" className={`mt-4 flex items-start gap-3 rounded-guest border px-4 py-3 ${BANNER_TONE[tone]}`}>
      <HugeiconsIcon icon={icon} size={20} className="mt-px shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-body font-semibold">
          {title}
          {meta && <span className="font-normal"> · {meta}</span>}
        </p>
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

/**
 * Pay the restaurant's own UPI ID from the bill. The button opens the guest's UPI app with the
 * amount filled in; the QR is for paying from another phone. Nothing here can see the payment,
 * so the guest tells staff, who check their UPI app before settling.
 */
function UpiPay({ upi, amountPaise, note, lang, claimed, disabled, onPaid }: {
  upi: { id: string; name: string };
  amountPaise: number;
  note: string;
  lang: Lang;
  claimed: { requestedAt: number; done: boolean } | null;
  disabled: boolean;
  onPaid: () => void;
}) {
  const t = (en: string, hi: string) => (lang === "hi" ? hi : en);
  const link = `upi://pay?${new URLSearchParams({ pa: upi.id, pn: upi.name, am: (amountPaise / 100).toFixed(2), cu: "INR", tn: note.slice(0, 50) }).toString()}`;
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    if (!showQr) return;
    let live = true;
    void import("qrcode").then((q) => q.toDataURL(link, { margin: 1, width: 240 })).then((url) => { if (live) setQr(url); });
    return () => { live = false; };
  }, [showQr, link]);
  return (
    <section aria-label={t("Pay by UPI", "UPI से भुगतान")} className="mt-6 rounded-[22px] border border-line/60 bg-surface p-4 shadow-[0_2px_12px_rgb(31_41_55/0.05)]">
      <p className="text-body font-bold text-ink">{t("Pay by UPI", "UPI से भुगतान")}</p>
      <p className="text-caption text-muted">{t(`To ${upi.name} · ${upi.id}`, `${upi.name} को · ${upi.id}`)}</p>
      {claimed ? (
        <p role="status" className="mt-3 rounded-2xl bg-[var(--state-available-soft)] px-3 py-2.5 text-caption font-semibold text-[var(--state-available-text)]">
          {claimed.done ? t("Staff confirmed your payment.", "स्टाफ ने आपका भुगतान पक्का कर दिया।") : t("You told staff you paid. They are checking it now.", "आपने स्टाफ को भुगतान बताया। वे अभी जाँच रहे हैं।")}
        </p>
      ) : (
        <>
          <a href={link} className="mt-3 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-button font-bold text-brand-on">
            {t(`Pay ${formatRupees(amountPaise)} with a UPI app`, `UPI ऐप से ${formatRupees(amountPaise)} दें`)}
          </a>
          <button type="button" onClick={() => setShowQr((v) => !v)} className="mt-2 w-full text-center text-caption font-semibold text-brand-strong">{showQr ? t("Hide QR", "QR छिपाएँ") : t("Paying from another phone? Show QR", "दूसरे फ़ोन से? QR दिखाएँ")}</button>
          {/* A data URL made on this phone; next/image adds nothing here */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {showQr && (qr ? <img src={qr} alt={t("UPI QR code", "UPI QR कोड")} className="mx-auto mt-2 size-60 rounded-xl bg-white p-2" /> : <p className="mt-2 text-center text-caption text-muted">…</p>)}
          <button type="button" disabled={disabled} onClick={onPaid} className="mt-3 min-h-12 w-full rounded-2xl border border-line/70 bg-surface px-4 text-body font-semibold text-ink disabled:opacity-50">{t("I have paid", "मैंने भुगतान कर दिया")}</button>
          <p className="mt-2 text-center text-label text-muted">{t("Tap this only after your UPI app says the payment worked.", "UPI ऐप में भुगतान सफल होने के बाद ही दबाएँ।")}</p>
        </>
      )}
    </section>
  );
}
