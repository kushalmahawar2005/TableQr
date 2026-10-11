import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatINR } from "@/domain/money";
import { sharedBill } from "@/server/billing/bill-link";
import { PrintButton } from "../../(guest)/r/[outlet]/t/[table]/paid/receipt/print-button";

export const metadata: Metadata = { title: "Bill", robots: { index: false, follow: false } };

// The bill sent on WhatsApp. Anyone with the link sees this one bill and nothing else; "Download
// PDF" opens the phone's print sheet, where "Save as PDF" keeps a copy.

const rupees = (paise: number) => `₹${formatINR(Math.abs(paise), { paise: true, prefix: false })}`;
const METHOD: Record<string, string> = { upi: "UPI", card: "Card", wallet: "Wallet", cash: "Cash" };
const TITLE = { tax_invoice: "Tax invoice", receipt: "Receipt", bill: "Bill" } as const;

export default async function SharedBillPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const b = await sharedBill(token);
  if (!b || b.cancelled) notFound();
  const snap = b.snap;
  const time = (ms: number) => new Intl.DateTimeFormat("en-IN", { timeZone: b.outlet.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  const row = "flex items-start justify-between gap-3 py-1";
  const paid = b.payments.reduce((n, p) => n + p.paise, 0);
  return (
    <main className="mx-auto min-h-dvh max-w-md bg-paper px-4 py-6 text-ink print:bg-white print:p-0">
      <article className="rounded-guest border border-line bg-surface p-5 print:border-0 print:p-0">
        <p className="text-caption font-semibold tracking-wide text-muted uppercase">{TITLE[b.docType]}</p>
        <h1 className="mt-1 font-display text-title font-bold">{b.outlet.name}</h1>
        <p className="mt-1 text-caption text-muted">{b.outlet.address}, {b.outlet.city}</p>
        {b.outlet.gstin && <p className="text-caption text-muted">GSTIN {b.outlet.gstin}</p>}
        {b.outlet.fssai && <p className="text-caption text-muted">FSSAI {b.outlet.fssai}</p>}
        <p className="mt-2 text-caption text-muted">
          Table {b.table}
          {b.number && ` · No. ${b.number}`}
          {b.issuedAt && ` · ${time(b.issuedAt)}`}
        </p>

        <table className="mt-4 w-full text-body">
          <thead>
            <tr className="border-b border-line text-left text-caption text-muted">
              <th className="py-1 font-semibold">Item</th>
              <th className="py-1 text-right font-semibold">Qty</th>
              <th className="py-1 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {snap.lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="py-1 pr-2 break-words">{l.nameEn}</td>
                <td className="py-1 text-right tabular">{l.qty}</td>
                <td className="py-1 text-right tabular">{rupees(l.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-3 border-t border-line pt-2 text-body">
          <div className={row}><dt className="text-muted">Subtotal</dt><dd className="tabular">{rupees(snap.subtotalPaise)}</dd></div>
          {snap.discountPaise > 0 && <div className={row}><dt className="text-muted">Discount</dt><dd className="tabular">−{rupees(snap.discountPaise)}</dd></div>}
          {snap.serviceChargePaise > 0 && <div className={row}><dt className="text-muted">Service charge</dt><dd className="tabular">{rupees(snap.serviceChargePaise)}</dd></div>}
          {Object.entries(snap.taxBreakup ?? {}).map(([bp, paise]) => (
            <div key={bp} className={row}><dt className="text-muted">{bp ? `GST ${Number(bp) / 100}%` : "GST"}</dt><dd className="tabular">{rupees(paise)}</dd></div>
          ))}
          {snap.roundOffPaise !== 0 && <div className={row}><dt className="text-muted">Round off</dt><dd className="tabular">{snap.roundOffPaise < 0 ? "−" : ""}{rupees(snap.roundOffPaise)}</dd></div>}
          <div className={`${row} border-t border-line pt-2 font-semibold`}><dt>Total</dt><dd className="font-display text-section font-bold tabular">{rupees(snap.totalPaise)}</dd></div>
        </dl>
        {snap.totalInWords && <p className="mt-1 text-caption text-muted">{snap.totalInWords}</p>}
        {b.payments.length > 0 && (
          <>
            <h2 className="mt-4 text-caption font-semibold text-muted">Payments</h2>
            <ul className="mt-1 text-caption">
              {b.payments.map((p, i) => (
                <li key={i} className={row}><span>{METHOD[p.method] ?? p.method}</span><span className="tabular">{rupees(p.paise)}</span></li>
              ))}
              <li className={`${row} font-semibold`}><span>{b.paid ? "Paid in full" : "Paid so far"}</span><span className="tabular">{rupees(paid)}</span></li>
            </ul>
          </>
        )}
        <p className="mt-5 text-center text-caption text-muted">Thank you for dining with us! · Powered by TableQR</p>
      </article>
      <div className="mt-4">
        <PrintButton label="Download PDF" />
      </div>
    </main>
  );
}
