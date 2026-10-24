import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatINR } from "@/domain/money";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { getReceipt } from "@/server/guest/after-visit";
import { billMessage } from "@/domain/bill-message";
import { PrintButton, ShareButton } from "./print-button";

export const metadata: Metadata = { title: "Receipt", robots: { index: false, follow: false } };

// The table's invoice once settled, and this phone's own payments. Reached only with the phone's
// device cookie, never by an id in the address. A restaurant without a GSTIN gets a Receipt.

const words = {
  en: { tax_invoice: "Tax invoice", receipt: "Receipt", payment: "Payment receipt", notFinal: "The table invoice is issued once everyone has paid.", number: "Invoice no.", table: "Table", item: "Item", qty: "Qty", amount: "Amount", subtotal: "Subtotal", discount: "Discount", service: "Service charge", gst: (r: string) => `GST ${r}%`, roundOff: "Round off", total: "Total", yourPayments: "Your payments", tip: "Tip (not taxed)", coveredFor: "Covers", you: "you", another: "another guest", table2: "the table", print: "Print or save as PDF", back: "Back", methods: { upi: "UPI", card: "Card", wallet: "Wallet", cash: "Cash" } as Record<string, string>, gstin: "GSTIN", fssai: "FSSAI", paidBy: "Payments", byGuest: (n: string | null) => n ?? "A guest", counter: "At the counter" },
  hi: { tax_invoice: "टैक्स इनवॉइस", receipt: "रसीद", payment: "पेमेंट रसीद", notFinal: "सबके पेमेंट के बाद टेबल का इनवॉइस बनता है।", number: "इनवॉइस नं.", table: "टेबल", item: "आइटम", qty: "मात्रा", amount: "रकम", subtotal: "उप-योग", discount: "छूट", service: "सर्विस चार्ज", gst: (r: string) => `GST ${r}%`, roundOff: "राउंड ऑफ़", total: "कुल", yourPayments: "आपके पेमेंट", tip: "टिप (टैक्स नहीं)", coveredFor: "इनके लिए", you: "आप", another: "एक और मेहमान", table2: "टेबल", print: "प्रिंट या PDF सेव करें", back: "वापस", methods: { upi: "UPI", card: "कार्ड", wallet: "वॉलेट", cash: "नकद" } as Record<string, string>, gstin: "GSTIN", fssai: "FSSAI", paidBy: "पेमेंट", byGuest: (n: string | null) => n ?? "एक मेहमान", counter: "काउंटर पर" },
};

const rupees = (paise: number) => `₹${formatINR(Math.abs(paise), { paise: true, prefix: false })}`;

export default async function ReceiptPage(props: { params: Promise<{ outlet: string; table: string }> }) {
  const { outlet, table } = await props.params;
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const w = words[lang];
  let r;
  try {
    r = await getReceipt(outlet, table, jar.get(DEVICE_COOKIE)?.value ?? null);
  } catch (err) {
    if (err instanceof AppError) redirect(`/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}/paid`);
    throw err;
  }
  const time = (ms: number) => new Intl.DateTimeFormat(lang === "hi" ? "hi-IN-u-nu-latn" : "en-IN", { timeZone: r.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  const inv = r.invoice;
  const snap = inv?.snapshot as undefined | {
    lines: { nameEn: string; qty: number; amountPaise: number }[];
    subtotalPaise: number; discountPaise: number; serviceChargePaise: number; taxBreakup: Record<string, number> | null; roundOffPaise: number; totalPaise: number; totalInWords: string;
    payments: { method: string; channel: string; amountPaise: number; tipPaise: number; payer: string | null; covered: string[] }[];
  };
  const row = "flex items-start justify-between gap-3 py-1";
  return (
    <main lang={lang} className="receipt-print-page min-h-dvh py-6 text-ink">
      <Link href={`/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}/paid`} className="inline-flex min-h-11 items-center text-body font-semibold text-brand-strong underline underline-offset-4 print:hidden">
        {w.back}
      </Link>
      <article className="mt-2 rounded-guest border border-line bg-surface p-5">
        <p className="text-caption font-semibold tracking-wide text-muted uppercase">{inv ? w[inv.docType] : w.payment}</p>
        <h1 className="mt-1 font-display text-title font-bold">{r.outlet.name}</h1>
        <p className="mt-1 text-caption text-muted">{r.outlet.address}, {r.outlet.city}</p>
        {r.outlet.gstin && <p className="text-caption text-muted">{w.gstin} {r.outlet.gstin}</p>}
        {r.outlet.fssai && <p className="text-caption text-muted">{w.fssai} {r.outlet.fssai}</p>}
        <p className="mt-2 text-caption text-muted">
          {w.table} {r.table.code}
          {inv && ` · ${w.number} ${inv.number} · ${time(inv.issuedAt)}`}
        </p>

        {snap ? (
          <>
            <table className="mt-4 w-full text-body">
              <thead>
                <tr className="border-b border-line text-left text-caption text-muted">
                  <th className="py-1 font-semibold">{w.item}</th>
                  <th className="py-1 text-right font-semibold">{w.qty}</th>
                  <th className="py-1 text-right font-semibold">{w.amount}</th>
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
              <div className={row}><dt className="text-muted">{w.subtotal}</dt><dd className="tabular">{rupees(snap.subtotalPaise)}</dd></div>
              {snap.discountPaise > 0 && <div className={row}><dt className="text-muted">{w.discount}</dt><dd className="tabular">−{rupees(snap.discountPaise)}</dd></div>}
              {snap.serviceChargePaise > 0 && <div className={row}><dt className="text-muted">{w.service}</dt><dd className="tabular">{rupees(snap.serviceChargePaise)}</dd></div>}
              {Object.entries(snap.taxBreakup ?? {}).map(([bp, paise]) => (
                <div key={bp} className={row}><dt className="text-muted">{w.gst(String(Number(bp) / 100))}</dt><dd className="tabular">{rupees(paise)}</dd></div>
              ))}
              <div className={row}><dt className="text-muted">{w.roundOff}</dt><dd className="tabular">{snap.roundOffPaise < 0 ? "−" : ""}{rupees(snap.roundOffPaise)}</dd></div>
              <div className={`${row} border-t border-line pt-2 font-semibold`}><dt>{w.total}</dt><dd className="font-display text-section font-bold tabular">{rupees(snap.totalPaise)}</dd></div>
            </dl>
            <p className="mt-1 text-caption text-muted">{snap.totalInWords}</p>
            <h2 className="mt-4 text-caption font-semibold text-muted">{w.paidBy}</h2>
            <ul className="mt-1 text-caption">
              {snap.payments.map((p, i) => (
                <li key={i} className={row}>
                  <span>
                    {p.channel === "counter" ? w.counter : w.byGuest(p.payer)} · {w.methods[p.method] ?? p.method}
                    <span className="block text-muted">{w.coveredFor}: {p.covered.join(", ")}</span>
                  </span>
                  <span className="tabular">{rupees(p.amountPaise)}{p.tipPaise > 0 ? ` + ${rupees(p.tipPaise)}` : ""}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-4 rounded-input bg-paper p-3 text-caption text-muted">{w.notFinal}</p>
        )}

        {r.myPayments.length > 0 && (
          <>
            <h2 className="mt-5 font-display text-section font-bold">{w.yourPayments}</h2>
            <ul className="mt-1 divide-y divide-line/70 text-body">
              {r.myPayments.map((p) => (
                <li key={p.id} className="py-2">
                  <div className={row}>
                    <span>{w.methods[p.method] ?? p.method} · {time(p.at)}</span>
                    <span className="font-semibold tabular">{rupees(p.amountPaise + p.tipPaise)}</span>
                  </div>
                  {p.tipPaise > 0 && <div className={`${row} text-caption text-muted`}><span>{w.tip}</span><span className="tabular">{rupees(p.tipPaise)}</span></div>}
                  <p className="text-caption text-muted">
                    {w.coveredFor}: {p.covered.map((x) => (x.isMe ? w.you : (x.name ?? w.another))).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </article>
      <div className="mt-4 space-y-2.5">
        {snap && (
          <ShareButton
            label={lang === "hi" ? "WhatsApp पर भेजें" : "Share on WhatsApp"}
            text={billMessage({
              outlet: r.outlet.name,
              table: r.table.code,
              kind: "receipt",
              totalPaise: snap.totalPaise,
            })}
          />
        )}
        <PrintButton label={w.print} />
      </div>
    </main>
  );
}
