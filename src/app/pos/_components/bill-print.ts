import { addressLine, mergeLines, taxRows } from "@/domain/invoice-view";
import type { PosBillDetail } from "@/server/staff/pos-read";

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const rs = (paise: number) => `${paise < 0 ? "− " : ""}₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { upi: "UPI", card: "Card", wallet: "Wallet", cash: "Cash" };
const when = (ms: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(ms);

/** A bill or a receipt that fits an 80 mm thermal roll and still prints fine on A4. */
export function billHtml(d: PosBillDetail, outlet: string, kind: "bill" | "receipt") {
  const lines = mergeLines(
    d.lines.filter((l) => l.status !== "voided" && l.status !== "cancelled")
      .map((l) => ({ name: l.name, qty: l.qty, unitPricePaise: l.unitPricePaise, amountPaise: l.qty * l.unitPricePaise, note: l.note, parcel: !!l.note && /parcel|pack/i.test(l.note) })),
    (l) => `${l.name}|${l.unitPricePaise}|${l.parcel}`,
  );
  const paid = d.payments.filter((p) => p.status === "success");
  const paidTotal = paid.reduce((n, p) => n + p.amountPaise + p.tipPaise, 0);
  const b = d.bill;
  const summaryRows = b ? 2 + Number(!!b.deliveryFeePaise) + Number(!!b.discountPaise) + Number(!!b.serviceChargePaise) + Number(!!b.roundOffPaise) : 0;
  // Long dish names wrap on the roll; reserve extra height so Chrome doesn't spill the last lines
  // onto a second page. One row is about 36 mono characters at this print width.
  const wrappedItemRows = lines.reduce((count, line) => count + Math.max(1, Math.ceil(`${line.qty}× ${line.name}${line.note && /parcel|pack/i.test(line.note) ? " (PARCEL)" : ""}`.length / 36)), 0);
  const extraItemRows = Math.max(0, wrappedItemRows - lines.length);
  const paperHeight = Math.max(92, 78 + lines.length * 8 + extraItemRows * 4.5 + summaryRows * 5 + (kind === "receipt" ? paid.length * 6 + 8 : 0));
  const row = (a: string, v: string, bold = false) => `<div class="r${bold ? " b" : ""}"><span>${a}</span><span>${v}</span></div>`;
  const seller = d.seller;
  const gstin = seller?.gstin?.trim() || null;
  // A paid bill with an invoice is a tax invoice when the restaurant is GST registered, else a receipt
  const title = kind === "bill" ? "BILL" : d.invoice && gstin ? "TAX INVOICE" : d.invoice ? "RECEIPT" : "PAYMENT RECEIPT";
  const tax = (bill: NonNullable<typeof b>) => taxRows(bill.taxBreakup, gstin, bill.taxPaise).map((t) => row(t.label, rs(t.paise))).join("");
  const address = addressLine(seller?.address, seller?.city);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${kind === "bill" ? "Bill" : "Receipt"} · Table ${esc(d.tableCode)}</title><style>
@page{size:80mm ${paperHeight}mm;margin:0}
*{box-sizing:border-box}
html{color-scheme:light;background:#fff}
body{margin:0;width:80mm;padding:4mm;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#000;line-height:1.35}
h1{font-size:16px;text-align:center;margin:0 0 2px}
.c{text-align:center}.m{color:#444;font-size:11px}
hr{border:0;border-top:1px dashed #000;margin:8px 0}
.r{display:flex;justify-content:space-between;gap:8px}.b{font-weight:700;font-size:14px}
.it{display:flex;gap:8px}.it .n{flex:1}.it .q{width:26px}.it .p{text-align:right}
</style></head><body>
<h1>${esc(seller?.name || outlet)}</h1>
${address ? `<div class="c m">${esc(address)}</div>` : ""}
${gstin ? `<div class="c m">GSTIN: ${esc(gstin)}</div>` : ""}
${seller?.fssai?.trim() ? `<div class="c m">FSSAI: ${esc(seller.fssai.trim())}</div>` : ""}
<hr>
<div class="c"><b>${title}</b></div>
${kind === "receipt" && d.invoice ? `<div class="c m">No. ${esc(d.invoice.number)}</div>` : ""}
<div class="c m">${d.takeaway ? "Takeaway" : "Table"} ${esc(d.tableCode)} · ${when(kind === "receipt" && d.invoice ? d.invoice.issuedAt : Date.now())}</div>
<hr>
${lines.map((l) => `<div class="it"><span class="q">${l.qty}×</span><span class="n">${esc(l.name)}${l.parcel ? " (PARCEL)" : ""}</span><span class="p">${rs(l.amountPaise)}</span></div>`).join("")}
<hr>
${b ? row("Items", rs(b.subtotalPaise)) + (b.discountPaise ? row("Discount", "− " + rs(b.discountPaise)) : "") + (b.serviceChargePaise ? row("Service charge", rs(b.serviceChargePaise)) : "") + (b.deliveryFeePaise ? row("Delivery charge", rs(b.deliveryFeePaise)) : "") + tax(b) +(b.roundOffPaise ? row("Round off", rs(b.roundOffPaise)) : "") + row("TOTAL", rs(b.totalPaise), true) : ""}
${kind === "receipt" && paid.length ? `<hr>${paid.map((p) => row(`Paid by ${METHOD[p.method] ?? p.method}`, rs(p.amountPaise + p.tipPaise))).join("")}${row("Total paid", rs(paidTotal), true)}` : ""}
<hr>
<div class="c m">Thank you for dining with us!</div>
<div class="c m">Powered by TableQR</div>
</body></html>`;
}

export type PaperMm = 58 | 80;
const PAPER_KEY = "tq_paper_mm";
/** The receipt roll width of this device's printer; each printer is set up on the device it serves */
export const paperSaved = (): PaperMm => { try { return localStorage.getItem(PAPER_KEY) === "58" ? 58 : 80; } catch { return 80; } };
const paperListeners = new Set<() => void>();
export const savePaper = (mm: PaperMm) => { try { localStorage.setItem(PAPER_KEY, String(mm)); } catch { /* private window */ } paperListeners.forEach((fn) => fn()); };
export const subscribePaper = (fn: () => void) => { paperListeners.add(fn); return () => { paperListeners.delete(fn); }; };

/**
 * Thermal slips are written for an 80 mm roll. For a 58 mm roll the whole slip is scaled down to
 * fit, so lines wrap exactly as they do on 80 mm and nothing runs off the right edge.
 */
export function forPaper(html: string, mm: PaperMm = paperSaved()) {
  if (mm === 80 || !/@page\{size:80mm /.test(html)) return html;
  return html.replace(/@page\{size:80mm /g, "@page{size:58mm ").replace("</style>", `body{zoom:${58 / 80}}</style>`);
}

/**
 * A thermal slip's page height is only an estimate when the html is built. Once laid out, set it
 * to the real content height so the roll neither feeds blank paper nor cuts the last lines.
 */
export function fitThermalPage(doc: Document) {
  const width = doc.head?.innerHTML.match(/@page\{size:(\d+)mm [\d.]+mm;margin:0\}/)?.[1];
  const box = doc.body?.getBoundingClientRect();
  if (!width || !box?.height || !box.width) return;
  // A slip scaled down for a narrower roll may be measured before or after its zoom; the body
  // spans the paper width once scaled, so the width ratio gives the printed height either way
  const scale = Math.min(1, (Number(width) * 96) / 25.4 / box.width);
  const style = doc.createElement("style");
  style.textContent = `@page{size:${width}mm ${Math.ceil((box.height * scale * 25.4) / 96) + 4}mm;margin:0}`;
  doc.head.appendChild(style);
}

/** Prints through a hidden frame so no pop-up gets blocked. */
export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Off screen but with a real width, so the slip lays out at paper width and can be measured
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:400px;height:10px;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(forPaper(html));
  doc.close();
  let done = false;
  const go = () => { if (done) return; done = true; fitThermalPage(doc); frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1500); };
  frame.onload = go;
  setTimeout(go, 400);
}
