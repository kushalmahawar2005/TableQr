import type { PosBillDetail } from "@/server/staff/pos-read";

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { upi: "UPI", card: "Card", wallet: "Wallet", cash: "Cash" };
const when = (ms: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(ms);

/** A bill or a receipt that fits an 80 mm thermal roll and still prints fine on A4. */
export function billHtml(d: PosBillDetail, outlet: string, kind: "bill" | "receipt") {
  const lines = d.lines.filter((l) => l.status !== "voided" && l.status !== "cancelled");
  const paid = d.payments.filter((p) => p.status === "success");
  const paidTotal = paid.reduce((n, p) => n + p.amountPaise + p.tipPaise, 0);
  const b = d.bill;
  const row = (a: string, v: string, bold = false) => `<div class="r${bold ? " b" : ""}"><span>${a}</span><span>${v}</span></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${kind === "bill" ? "Bill" : "Receipt"} · Table ${esc(d.tableCode)}</title><style>
@page{size:80mm auto;margin:4mm}
*{box-sizing:border-box}
body{margin:0 auto;max-width:80mm;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#000;line-height:1.35}
h1{font-size:16px;text-align:center;margin:0 0 2px}
.c{text-align:center}.m{color:#444;font-size:11px}
hr{border:0;border-top:1px dashed #000;margin:8px 0}
.r{display:flex;justify-content:space-between;gap:8px}.b{font-weight:700;font-size:14px}
.it{display:flex;gap:8px}.it .n{flex:1}.it .q{width:26px}.it .p{text-align:right}
</style></head><body>
<h1>${esc(outlet)}</h1>
<div class="c m">${kind === "bill" ? "BILL" : "PAYMENT RECEIPT"}</div>
<div class="c m">Table ${esc(d.tableCode)} · ${when(Date.now())}</div>
<hr>
${lines.map((l) => `<div class="it"><span class="q">${l.qty}×</span><span class="n">${esc(l.name)}${l.note && /parcel|pack/i.test(l.note) ? " (PARCEL)" : ""}</span><span class="p">${rs(l.qty * l.unitPricePaise)}</span></div>`).join("")}
<hr>
${b ? row("Items", rs(b.subtotalPaise)) + row("Tax", rs(b.taxPaise)) + (b.serviceChargePaise ? row("Service charge", rs(b.serviceChargePaise)) : "") + (b.roundOffPaise ? row("Round off", rs(b.roundOffPaise)) : "") + row("TOTAL", rs(b.totalPaise), true) : ""}
${kind === "receipt" && paid.length ? `<hr>${paid.map((p) => row(`Paid by ${METHOD[p.method] ?? p.method}`, rs(p.amountPaise + p.tipPaise))).join("")}${row("Total paid", rs(paidTotal), true)}` : ""}
<hr>
<div class="c m">Thank you for dining with us!</div>
<div class="c m">Powered by TableQR</div>
</body></html>`;
}

/** Prints through a hidden frame so no pop-up gets blocked. */
export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  let done = false;
  const go = () => { if (done) return; done = true; frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1500); };
  frame.onload = go;
  setTimeout(go, 400);
}
