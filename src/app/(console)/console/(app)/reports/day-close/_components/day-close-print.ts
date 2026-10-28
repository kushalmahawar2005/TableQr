import { paperSaved } from "@/lib/print/runtime";
import { charsPerLine, dateTime, esc, profileFor, row, rs, thermalDocument, wrapRows, type PaperMm } from "@/lib/print/thermal";
import type { DayClose } from "@/server/staff/day-close";

// The day close as its own small document: black on white, no console around it, laid out for an
// 80 mm or 58 mm receipt roll and still tidy on A4. A day that is still going is a summary "so far",
// not a final report, and says so. The sums are the day close's own; this only lays them out.

const METHOD: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", wallet: "Wallet / online" };

/** "3 am" for a business day that runs past midnight */
export const dayEndsAt = (minutes: number) => `${Math.floor(minutes / 60) % 12 || 12}${minutes % 60 ? `:${String(minutes % 60).padStart(2, "0")}` : ""} am`;

const openLabel = (t: DayClose["openTables"][number]) => `${t.takeaway ? "Takeaway" : "Table"} ${t.table}`;

export function dayCloseHtml(r: DayClose, outlet: string, paper: PaperMm = paperSaved()) {
  const profile = profileFor(paper);
  const date = new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const methods = r.methods.length ? r.methods.map((m) => row(`${METHOD[m.method] ?? m.method} (${m.count})`, rs(m.paise))).join("") : row("No payments", rs(0));
  const still = r.openTables.length
    ? `<hr><h2>${r.isToday ? "Still open" : "Unsettled from this day"} (${r.openTables.length})</h2>${r.openTables.map((t) => row(openLabel(t), t.totalPaise ? rs(t.totalPaise) : "")).join("")}`
    : "";
  const top = r.topItems.length
    ? `<hr><h2>Most ordered</h2>${r.topItems.map((t, i) => `<div class="it"><div class="n">${i + 1}. ${esc(t.name)}</div>${row(`× ${t.qty}`, rs(t.paise))}</div>`).join("")}`
    : "";

  const body = `<h1>${esc(outlet)}</h1>
<div class="c t"><b>${r.isToday ? "DAY SUMMARY" : "DAY CLOSE REPORT"}</b></div>
<div class="c m">${r.isToday ? "So far today · not final" : "Final for this business day"}</div>
<hr>
${row("Date", date)}
${r.cutoffMinutes ? `<div class="m">Day runs till ${dayEndsAt(r.cutoffMinutes)} next morning</div>` : ""}
${row("Printed", dateTime(Date.now()))}
<hr>
<h2>Money in</h2>
${methods}
${r.refunds.paise ? row(`Refunds (${r.refunds.count})`, `− ${rs(r.refunds.paise)}`) : ""}
${row("COLLECTED", rs(r.netPaise), "b")}
<hr>
<h2>Sales</h2>
${row("Paid bills", String(r.bills.count))}
${row("Food & drinks", rs(r.bills.subtotalPaise))}
${r.bills.discountPaise ? row("Discounts", `− ${rs(r.bills.discountPaise)}`) : ""}
${r.bills.serviceChargePaise ? row("Service charge", rs(r.bills.serviceChargePaise)) : ""}
${row("GST", rs(r.bills.taxPaise))}
${r.bills.roundOffPaise ? row("Round off", rs(r.bills.roundOffPaise)) : ""}
${row("SALES", rs(r.bills.totalPaise), "b")}
${r.bills.tipsPaise ? row("Tips (on top)", rs(r.bills.tipsPaise)) : ""}
${row("Average bill", rs(r.averageBillPaise))}
<hr>
<h2>Volume</h2>
${row("Guests", String(r.visits.covers || r.visits.count))}
${row("Orders", String(r.orders))}
${row("Items sold", String(r.itemsSold))}
${r.removed.qty ? row(`Voided (${r.removed.qty})`, rs(r.removed.paise)) : ""}
${top}${still}
<hr>
<div class="c m">Powered by Tableeqr</div>`;

  // Height before measuring: long outlet or dish names wrap onto more rows
  const perLine = charsPerLine(profile);
  const rows = 22 + r.methods.length + Number(!!r.refunds.paise) + Number(!!r.bills.discountPaise) + Number(!!r.bills.serviceChargePaise) + Number(!!r.bills.roundOffPaise) + Number(!!r.bills.tipsPaise) + Number(!!r.removed.qty)
    + wrapRows(outlet, Math.floor(perLine * 0.6)) - 1
    + r.topItems.reduce((n, t, i) => n + 1 + wrapRows(`${i + 1}. ${t.name}`, perLine), 0)
    + (r.openTables.length ? 2 + r.openTables.length : 0);

  return thermalDocument({
    title: `${r.isToday ? "Day summary" : "Day close"} ${r.date}`,
    paper,
    css: `h1{font-size:${profile.fsLarge + 3}px;text-align:center;line-height:1.2;font-weight:700;margin-bottom:2px}
.t{font-size:${profile.fsLarge}px;letter-spacing:.06em}
h2{font-size:${profile.fs}px;margin:2px 0 3px;text-transform:uppercase;letter-spacing:.05em}
.it{margin:2px 0}.it .n{font-weight:700}`,
    slips: [body],
    estimateMm: rows * 4.6 + 12,
  });
}
