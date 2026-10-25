import { addressLine, mergeLines, taxRows } from "@/domain/invoice-view";
import { paperSaved } from "@/lib/print/runtime";
import { charsPerLine, dateTime, esc, profileFor, row, rs, thermalDocument, wrapRows, type PaperMm } from "@/lib/print/thermal";
import type { PosBillDetail } from "@/server/staff/pos-read";

// The customer's bill and receipt on a thermal roll. Printing itself (paper width, page size,
// fitting the page to the slip) is shared with the other slips in src/lib/print.
export { fitThermalPage, forPaper, paperSaved, printHtml, savePaper, subscribePaper } from "@/lib/print/runtime";
export type { PaperMm } from "@/lib/print/thermal";

const METHOD: Record<string, string> = { upi: "UPI", card: "Card", wallet: "Wallet", cash: "Cash" };
const isParcel = (note: string | null) => !!note && /parcel|pack/i.test(note);

/** A bill or a receipt that fits an 80 mm or 58 mm thermal roll and still prints fine on A4. */
export function billHtml(d: PosBillDetail, outlet: string, kind: "bill" | "receipt", paper: PaperMm = paperSaved()) {
  const profile = profileFor(paper);
  const lines = mergeLines(
    d.lines.filter((l) => l.status !== "voided" && l.status !== "cancelled")
      .map((l) => ({ name: l.name, qty: l.qty, unitPricePaise: l.unitPricePaise, amountPaise: l.qty * l.unitPricePaise, note: l.note, parcel: isParcel(l.note) })),
    (l) => `${l.name}|${l.unitPricePaise}|${l.parcel}`,
  );
  const paid = d.payments.filter((p) => p.status === "success");
  const paidTotal = paid.reduce((n, p) => n + p.amountPaise + p.tipPaise, 0);
  const b = d.bill;
  const seller = d.seller;
  const gstin = seller?.gstin?.trim() || null;
  // A paid bill with an invoice is a tax invoice when the restaurant is GST registered, else a receipt
  const title = kind === "bill" ? "BILL" : d.invoice && gstin ? "TAX INVOICE" : d.invoice ? "RECEIPT" : "PAYMENT RECEIPT";
  const tax = (bill: NonNullable<typeof b>) => taxRows(bill.taxBreakup, gstin, bill.taxPaise).map((t) => row(t.label, rs(t.paise))).join("");
  const address = addressLine(seller?.address, seller?.city);
  const showInvoice = kind === "receipt" && d.invoice;

  const head = [
    `<h1>${esc(seller?.name || outlet)}</h1>`,
    address ? `<div class="c m">${esc(address)}</div>` : "",
    gstin ? `<div class="c m">GSTIN: ${esc(gstin)}</div>` : "",
    seller?.fssai?.trim() ? `<div class="c m">FSSAI: ${esc(seller.fssai.trim())}</div>` : "",
    "<hr>",
    `<div class="c t"><b>${title}</b></div>`,
    "<hr>",
    showInvoice ? row("Invoice No.", d.invoice!.number) : "",
    row("Date", dateTime(showInvoice ? d.invoice!.issuedAt : Date.now())),
    row("Order", d.takeaway ? "Takeaway" : "Dine-in"),
    row(d.takeaway ? "Token" : "Table", d.tableCode),
    "<hr>",
  ].join("");

  const items = lines.map((l) => `<div class="it"><div class="n">${esc(l.name)}${l.parcel ? " (PARCEL)" : ""}</div>${row(`${l.qty} × ${rs(l.unitPricePaise)}`, rs(l.amountPaise))}</div>`).join("");

  const totals = b
    ? row("Subtotal", rs(b.subtotalPaise))
      + (b.discountPaise ? row("Discount", "− " + rs(b.discountPaise)) : "")
      + (b.serviceChargePaise ? row("Service charge", rs(b.serviceChargePaise)) : "")
      + (b.deliveryFeePaise ? row("Delivery charge", rs(b.deliveryFeePaise)) : "")
      + tax(b)
      + (b.roundOffPaise ? row("Round off", rs(b.roundOffPaise)) : "")
      + "<hr>" + row("TOTAL", rs(b.totalPaise), "b")
    : "";

  const payments = kind === "receipt" && paid.length
    ? `<hr>${paid.map((p) => row(`Paid by ${METHOD[p.method] ?? p.method}`, rs(p.amountPaise + p.tipPaise))).join("")}${row("Amount paid", rs(paidTotal), "b")}`
    : "";

  const footer = `<hr><div class="c m">Thank you for dining with us!</div><div class="c m">Powered by TableQR</div>`;

  // Height before measuring: a long name or address wraps onto more rows than its count of lines
  const perLine = charsPerLine(profile);
  const rows = wrapRows(seller?.name || outlet, Math.floor(perLine * 0.6)) + (address ? wrapRows(address, perLine) : 0)
    + lines.reduce((n, l) => n + wrapRows(`${l.name}${l.parcel ? " (PARCEL)" : ""}`, perLine) + 1, 0);
  const summaryRows = b ? 3 + Number(!!b.discountPaise) + Number(!!b.serviceChargePaise) + Number(!!b.deliveryFeePaise) + Number(!!b.roundOffPaise) + Object.keys(b.taxBreakup ?? {}).length * 2 : 0;
  const estimateMm = 52 + rows * 5 + summaryRows * 5 + (payments ? 6 + paid.length * 5 : 0);

  return thermalDocument({
    title: `${kind === "bill" ? "Bill" : "Receipt"} ${d.tableCode}`,
    paper,
    css: `h1{font-size:${profile.fsLarge + 3}px;text-align:center;line-height:1.2;font-weight:700;margin-bottom:2px}
.t{font-size:${profile.fsLarge}px;letter-spacing:.06em}
.it{margin:3px 0}.it .n{font-weight:700}.it .r{font-size:${profile.fs}px}`,
    slips: [head + items + "<hr>" + totals + payments + footer],
    estimateMm,
  });
}
