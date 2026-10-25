import type { DayClose } from "@/server/staff/day-close";

// The day close as its own small document: black on white, no console around it, sized for an
// 80 mm receipt printer and still tidy on A4. Printed through the same hidden frame as POS bills.

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const rs = (paise: number) => `${paise < 0 ? "− " : ""}₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", wallet: "Wallet / online" };

/** "3 am" for a business day that runs past midnight */
export const dayEndsAt = (minutes: number) => `${Math.floor(minutes / 60) % 12 || 12}${minutes % 60 ? `:${String(minutes % 60).padStart(2, "0")}` : ""} am`;

export function dayCloseHtml(r: DayClose, outlet: string) {
  const optionalRows = Number(!!r.refunds.paise) + Number(!!r.bills.discountPaise) + Number(!!r.bills.serviceChargePaise) + Number(!!r.bills.roundOffPaise) + Number(!!r.bills.tipsPaise) + Number(!!r.removed.qty);
  const extraWrappedRows = Math.max(0, Math.ceil(outlet.length / 25) - 1)
    + r.topItems.reduce((n, item, index) => n + Math.max(0, Math.ceil(`${index + 1}. ${item.name} x${item.qty} ${rs(item.paise)}`.length / 26) - 1), 0)
    + (r.openTables.length ? Math.max(0, Math.ceil(`Still open: ${r.openTables.map((table) => table.table).join(", ")}`.length / 26) - 1) : 0);
  const paperHeight = Math.max(130, 102 + (r.methods.length + optionalRows + r.topItems.length + r.openTables.length) * 5 + extraWrappedRows * 5);
  const row = (a: string, v: string, cls = "") => `<div class="r ${cls}"><span>${esc(a)}</span><span>${esc(v)}</span></div>`;
  const date = new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const printed = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(Date.now());
  return `<!doctype html><html><head><meta charset="utf-8"><title>Day close · ${esc(r.date)}</title><style>
@page{size:80mm ${paperHeight}mm;margin:0}
*{box-sizing:border-box}
html{color-scheme:light;background:#fff}
body{margin:0;width:80mm;padding:4mm;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#000;line-height:1.4}
h1{font-size:16px;text-align:center;margin:0 0 2px}
h2{font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.04em}
.c{text-align:center}.m{font-size:11px}
hr{border:0;border-top:1px dashed #000;margin:8px 0}
.r{display:flex;justify-content:space-between;gap:8px}
.b{font-weight:700;font-size:14px}.w{font-weight:700}
</style></head><body>
<h1>${esc(outlet)}</h1>
<div class="c w">DAY CLOSE</div>
<div class="c m">${esc(date)}${r.isToday ? " (so far)" : ""}</div>
${r.cutoffMinutes ? `<div class="c m">Day runs till ${dayEndsAt(r.cutoffMinutes)} next morning</div>` : ""}
<div class="c m">Printed ${esc(printed)}</div>
<hr>
<h2>Money in</h2>
${r.methods.length ? r.methods.map((m) => row(`${METHOD[m.method] ?? m.method} (${m.count})`, rs(m.paise))).join("") : row("No payments", rs(0))}
${r.refunds.paise ? row(`Refunds (${r.refunds.count})`, `- ${rs(r.refunds.paise)}`) : ""}
${row("COLLECTED", rs(r.netPaise), "b")}
<hr>
<h2>Bills</h2>
${row("Paid bills", String(r.bills.count))}
${row("Food and drinks", rs(r.bills.subtotalPaise))}
${r.bills.discountPaise ? row("Discounts", `- ${rs(r.bills.discountPaise)}`) : ""}
${r.bills.serviceChargePaise ? row("Service charge", rs(r.bills.serviceChargePaise)) : ""}
${row("GST", rs(r.bills.taxPaise))}
${r.bills.roundOffPaise ? row("Round off", rs(r.bills.roundOffPaise)) : ""}
${row("SALES", rs(r.bills.totalPaise), "w")}
${r.bills.tipsPaise ? row("Tips (on top)", rs(r.bills.tipsPaise)) : ""}
${row("Average bill", rs(r.averageBillPaise))}
<hr>
${row("Guests", String(r.visits.covers || r.visits.count))}
${row("Orders", String(r.orders))}
${row("Items sold", String(r.itemsSold))}
${r.removed.qty ? row(`Cancelled/voided (${r.removed.qty})`, rs(r.removed.paise)) : ""}
${r.topItems.length ? `<hr><h2>Most ordered</h2>${r.topItems.map((t, i) => row(`${i + 1}. ${t.name} x${t.qty}`, rs(t.paise))).join("")}` : ""}
${r.openTables.length ? `<hr><div class="w">Still open: ${esc(r.openTables.map((t) => t.table).join(", "))}</div>` : ""}
<div class="c m">TableQR</div>
</body></html>`;
}
