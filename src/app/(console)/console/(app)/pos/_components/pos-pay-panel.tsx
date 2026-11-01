"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Banknote, Check, Loader2, Printer, Smartphone } from "lucide-react";
import { usePrint } from "@/components/print/print-provider";
import { billMessage, whatsappNumber } from "@/domain/bill-message";
import { billHtml } from "@/app/pos/_components/bill-print";
import { DiscountBox, WhatsAppBill } from "@/app/pos/_components/billing-screen";
import { primaryButton, secondaryButton } from "@/app/(console)/console/(app)/orders/_components/orders-ui";
import * as actions from "@/server/staff/pos-actions";
import type { PosBillDetail } from "@/server/staff/pos-read";

const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const primary = `${primaryButton} min-h-11 w-full`;
const quiet = `${secondaryButton} min-h-11 w-full`;
const METHODS = [
  { id: "cash", icon: Banknote, en: "Cash", hi: "नकद" },
  { id: "upi", icon: Smartphone, en: "UPI", hi: "UPI" },
] as const;
type Method = (typeof METHODS)[number]["id"];

/** Take payment inside the POS order panel, so a counter sale never leaves this screen. Splits and reopening stay on Billing. */
export function PosPayPanel({ detail: first, hi, offline, onClose, initialDone = null }: { detail: PosBillDetail; hi: boolean; offline: boolean; onClose: () => void; initialDone?: { change: number } | null }) {
  const L = (en: string, h: string) => (hi ? h : en);
  const printer = usePrint().manager;
  const [detail, setDetail] = useState(first);
  const [method, setMethod] = useState<Method>("cash");
  const [received, setReceived] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(initialDone);
  const settleKey = useRef<string | null>(null);

  const outlet = detail.seller?.name ?? "";
  const bill = detail.bill;
  const billHref = `/console/billing?session=${encodeURIComponent(detail.sessionId)}`;
  const dueNow = detail.shares.reduce((n, s) => n + Math.max(0, s.amountPaise - s.paidPaise), 0);
  const paidSoFar = detail.payments.filter((p) => p.status === "success").reduce((n, p) => n + p.amountPaise + p.tipPaise, 0);
  const pendingOnline = detail.payments.some((p) => ["pending", "initiated"].includes(p.status));
  const receivedPaise = received === null ? dueNow : Math.round(Number(received || "0") * 100);
  const short = method === "cash" && receivedPaise < dueNow;
  const quick = [...new Set([Math.ceil(dueNow / 5000) * 5000, Math.ceil(dueNow / 10000) * 10000, Math.ceil(dueNow / 50000) * 50000, Math.ceil(dueNow / 200000) * 200000])].filter((v) => v > dueNow).slice(0, 3);
  const phones = [...new Set(detail.people.map((p) => whatsappNumber(p.phone ?? "")).filter((v): v is string => !!v))];
  const phone = phones.length === 1 ? phones[0] : "";

  const print = (d: PosBillDetail, kind: "bill" | "receipt") => void printer.print({ kind, subject: { type: "session", id: d.sessionId }, build: (paper) => billHtml(d, outlet, kind, paper) });
  const reload = async () => { const d = await actions.detailAction(detail.sessionId); if (d.ok) setDetail(d.data); return d.ok ? d.data : detail; };
  const run = async <T,>(work: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, then: (data: T) => Promise<void>) => {
    setBusy(true); setError(null);
    try {
      const r = await work();
      if (r.ok) await then(r.data); else setError(r.error);
    } catch {
      setError(L("Connection lost. Nothing new was saved; try again.", "कनेक्शन टूट गया। कुछ नया सेव नहीं हुआ; फिर कोशिश करें।"));
    } finally { setBusy(false); }
  };
  const pay = () => {
    settleKey.current ??= crypto.randomUUID();
    void run(() => actions.settleAction({ sessionId: detail.sessionId, method, receivedPaise: method === "cash" ? receivedPaise : undefined, clientRequestId: settleKey.current!, externalReference: reference }), async (r) => {
      setDone({ change: r.changePaise });
      print(await reload(), "receipt");
    });
  };

  const whatsApp = (
    <WhatsAppBill
      hi={hi}
      defaultPhone={phone}
      actionClassName="min-h-11 w-full sm:w-full"
      sendPdf={detail.pdfOnWhatsApp && bill ? async (to) => { const r = await actions.sendBillAction({ sessionId: detail.sessionId, phone: to }); return r.ok ? null : r.error; } : undefined}
      onSend={(to) => void actions.rememberCustomerAction({ sessionId: detail.sessionId, phone: to, name: detail.guestName })}
      text={billMessage({
        outlet,
        table: detail.tableCode,
        kind: done ? "receipt" : "bill",
        phone: phone ? phone.slice(-10) : null,
        date: bill?.createdAt ?? null,
        totalPaise: bill?.totalPaise ?? 0,
        paidPaise: paidSoFar,
        link: bill && typeof window !== "undefined" ? `${window.location.origin}/b/${bill.shareToken}` : null,
      })}
    />
  );

  if (done) {
    return (
      <div className="flex flex-1 flex-col p-4">
        <div className="grid flex-1 place-content-center justify-items-center py-6 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-success/10 text-success"><Check className="size-7" aria-hidden="true" /></span>
          <h2 className="mt-3 font-display text-section font-bold text-ink">{L("Payment recorded", "भुगतान दर्ज हुआ")}</h2>
          <p className="text-body text-muted">{rs(bill?.totalPaise ?? 0)}</p>
          {done.change > 0 && <div className="mt-4 rounded-2xl bg-accent px-6 py-3"><p className="text-caption text-muted">{L("Give back change", "वापस दें")}</p><p className="font-display text-title font-bold tabular-nums text-ink">{rs(done.change)}</p></div>}
        </div>
        <div className="grid gap-2">
          <button type="button" className={primary} onClick={onClose}>{L("New order", "नया ऑर्डर")}</button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={quiet} onClick={() => print(detail, "receipt")}><Printer className="size-4" aria-hidden="true" />{L("Print", "प्रिंट")}</button>
            {whatsApp}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="shrink-0 border-b border-line p-4">
        <button type="button" onClick={onClose} className="mb-1 inline-flex min-h-9 items-center gap-1.5 text-caption font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden="true" />{L("Pay later", "बाद में भुगतान")}</button>
        <h2 className="font-display text-section font-bold text-ink">{L("Take payment", "भुगतान लें")} · {detail.takeaway ? L("Takeaway", "पार्सल") : `${L("Table", "टेबल")} ${detail.tableCode}`}</h2>
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <dl className="space-y-1 border-b border-line p-4 text-body">
          <div className="flex justify-between text-muted"><dt>{L("Items", "आइटम")}</dt><dd className="tabular-nums">{rs(bill?.subtotalPaise ?? 0)}</dd></div>
          {!!bill?.discountPaise && <div className="flex justify-between text-success"><dt>{L("Discount", "छूट")}</dt><dd className="tabular-nums">− {rs(bill.discountPaise)}</dd></div>}
          {!!bill?.taxPaise && <div className="flex justify-between text-muted"><dt>{L("Tax", "कर")}</dt><dd className="tabular-nums">{rs(bill.taxPaise)}</dd></div>}
          {!!bill?.serviceChargePaise && <div className="flex justify-between text-muted"><dt>{L("Service charge", "सर्विस चार्ज")}</dt><dd className="tabular-nums">{rs(bill.serviceChargePaise)}</dd></div>}
          {!!bill?.roundOffPaise && <div className="flex justify-between text-muted"><dt>{L("Round off", "राउंड ऑफ़")}</dt><dd className="tabular-nums">{rs(bill.roundOffPaise)}</dd></div>}
          {paidSoFar > 0 && <div className="flex justify-between text-success"><dt>{L("Paid so far", "अब तक भुगतान")}</dt><dd className="tabular-nums">− {rs(paidSoFar)}</dd></div>}
          <div className="flex justify-between pt-1 font-display text-section font-bold text-ink"><dt>{L("To pay", "देना है")}</dt><dd className="tabular-nums">{rs(dueNow)}</dd></div>
        </dl>

        {paidSoFar === 0 && detail.discounts && <div className="[&>*]:px-4">
          <DiscountBox
            hi={hi}
            current={bill?.discount ?? null}
            disabled={offline || busy}
            needsApproval={detail.needsApproval}
            subtotalPaise={bill?.subtotalPaise ?? 0}
            onApply={(kind, value, reason, approval) => void run(() => actions.discountAction({ sessionId: detail.sessionId, kind, value, reason, approval }), async () => { await reload(); setReceived(null); })}
            onClear={() => void run(() => actions.clearDiscountAction(detail.sessionId), async () => { await reload(); setReceived(null); })}
          />
        </div>}

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={L("How did they pay?", "भुगतान कैसे हुआ?")}>
            {METHODS.map((m) => (
              <button key={m.id} type="button" aria-pressed={method === m.id} onClick={() => setMethod(m.id)} className={`flex min-h-12 items-center justify-center gap-1.5 rounded-xl border text-button font-semibold ${method === m.id ? "border-forest bg-forest text-white" : "border-line bg-surface text-muted hover:text-ink"}`}><m.icon className="size-4" aria-hidden="true" />{hi ? m.hi : m.en}</button>
            ))}
          </div>
          {method === "cash" ? (
            <div>
              <label className="block text-caption font-semibold text-muted">{L("Cash received", "नकद मिला")}
                <input inputMode="decimal" value={received ?? String(dueNow / 100)} onChange={(e) => setReceived(e.target.value.replace(/[^0-9.]/g, ""))} onFocus={(e) => e.target.select()} className="mt-1 h-11 w-full rounded-xl border border-line bg-surface px-3 text-body font-bold tabular-nums text-ink" />
              </label>
              {quick.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{quick.map((v) => <button key={v} type="button" onClick={() => setReceived(String(v / 100))} className="min-h-9 rounded-full border border-line px-3 text-caption font-semibold text-ink hover:bg-accent">{rs(v)}</button>)}</div>}
              {receivedPaise !== dueNow && <p className={`mt-2 flex justify-between text-body font-semibold ${short ? "text-danger" : "text-success"}`}><span>{short ? L("Short by", "कम है") : L("Change to give", "वापस देना है")}</span><span className="tabular-nums">{rs(Math.abs(receivedPaise - dueNow))}</span></p>}
            </div>
          ) : (
            <label className="block text-caption font-semibold text-muted">{L("UPI reference (optional)", "UPI रेफ़रेंस (वैकल्पिक)")}
              <input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-surface px-3 text-body text-ink" />
            </label>
          )}
          {pendingOnline && <p className="text-caption font-semibold text-warning">{L("An online payment is being checked. Finish it on the Billing page.", "ऑनलाइन भुगतान जाँचा जा रहा है। इसे बिलिंग पेज पर पूरा करें।")}</p>}
          {error && <p role="alert" className="text-caption font-semibold text-danger">{error}</p>}
        </div>
      </div>

      <footer className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] grid shrink-0 gap-2 rounded-b-2xl border-t border-line bg-surface p-4 sm:bottom-0">
        <button type="button" className={primary} disabled={busy || offline || pendingOnline || dueNow <= 0 || short} onClick={pay}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Printer className="size-4" aria-hidden="true" />}{L(`Pay ${rs(dueNow)} & print`, `${rs(dueNow)} भुगतान और प्रिंट`)}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={quiet} onClick={() => print(detail, "bill")}>{L("Print bill", "बिल प्रिंट")}</button>
          {whatsApp}
        </div>
        <Link href={billHref} className="py-1 text-center text-caption font-semibold text-muted hover:text-ink">{L("Split or change the bill", "बिल बाँटें या बदलें")}</Link>
      </footer>
    </>
  );
}
