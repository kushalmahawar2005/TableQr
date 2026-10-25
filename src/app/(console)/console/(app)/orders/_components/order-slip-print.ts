import { paperSaved } from "@/lib/print/runtime";
import { charsPerLine, dateTime, esc, profileFor, row, rs, thermalDocument, wrapRows, type PaperMm } from "@/lib/print/thermal";

// An order summary slip from the Orders screen: table, round, what was ordered and the order total.
// Not the kitchen ticket (that has no prices) and not a tax invoice (that is the bill).

export type OrderSlip = {
  table: string;
  takeaway: boolean;
  roundNo: number;
  /** ISO time the order was placed */
  placedAt: string;
  statusLabel: string;
  items: { name: string; qty: number }[];
  note: string | null;
  totalPaise: number;
};

export function orderSlipHtml(order: OrderSlip, outlet: string, paper: PaperMm = paperSaved()) {
  const profile = profileFor(paper);
  const items = order.items.map((item) => `<div class="l"><span class="q">${item.qty}×</span><div class="nm">${esc(item.name)}</div></div>`).join("");
  const body = `<h1>${esc(outlet)}</h1>
<div class="c t"><b>ORDER SLIP</b></div>
<hr>
<div class="ty">${order.takeaway ? "TAKEAWAY" : "TABLE"}</div>
<div class="tb">${esc(order.table)}</div>
<div class="c"><b>Round ${order.roundNo}</b> · ${esc(order.statusLabel)}</div>
<div class="c m">${esc(dateTime(new Date(order.placedAt).getTime()))}</div>
<hr>
${items || '<div class="c m">No active items</div>'}
${order.note ? `<div class="on"><b>Kitchen note:</b> ${esc(order.note)}</div>` : ""}
<hr>
${row("Order total", rs(order.totalPaise), "b")}
<hr>
<div class="c m">Order summary · Not a tax invoice</div>`;
  const perLine = charsPerLine(profile, profile.fsLarge);
  const rows = order.items.reduce((n, item) => n + wrapRows(item.name, perLine - 4), 0) + (order.note ? wrapRows(`Kitchen note: ${order.note}`, perLine) + 1 : 0);
  return thermalDocument({
    title: `Order ${order.table}`,
    paper,
    css: `h1{font-size:${profile.fsLarge + 3}px;text-align:center;line-height:1.2;font-weight:700}
.t{font-size:${profile.fsLarge}px;letter-spacing:.08em}
.ty{text-align:center;font-size:${profile.fs}px;font-weight:700;letter-spacing:.14em}
.tb{text-align:center;font-size:${profile.fsHuge - 4}px;font-weight:700;line-height:1.1;overflow-wrap:anywhere}
.l{display:flex;gap:6px;margin:4px 0;align-items:flex-start}
.q{flex:none;min-width:2.4em;font-size:${profile.fsLarge}px;font-weight:700}
.nm{min-width:0;flex:1;font-size:${profile.fsLarge}px;font-weight:700;line-height:1.2}
.on{border:1px solid #000;padding:3px 4px;margin:6px 0}`,
    slips: [body],
    estimateMm: 78 + rows * 7,
  });
}
