import type { KdsCard } from "./kds-logic";

// The kitchen order ticket (KOT) as an 80 mm slip for a thermal printer: table, round, time and
// the dishes in big type, with options and notes under each. Printed through the browser.

const esc = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const time = (ms: number) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(ms);

function slip(card: KdsCard) {
  const takeaway = card.tableCodes.some((t) => /^TA-\d+$/.test(t));
  const lines = card.lines
    .map((l) => {
      const extra = [...l.modifiers.map((m) => m.en), l.personalForPickup ? "PARCEL · PACK FOR TAKEAWAY" : "", l.note ?? ""].filter(Boolean);
      return `<div class="l"><b>${l.qty} ×</b> ${esc(l.nameEn)}${extra.length ? `<div class="x">${esc(extra.join(", "))}</div>` : ""}</div>`;
    })
    .join("");
  return `<section>
<h1>${takeaway ? "PARCEL " : ""}${esc(card.tableCodes.join(" + "))}</h1>
<div class="m">KOT · Round ${card.roundNo} · ${time(card.placedAt)}${card.station ? ` · ${esc(card.station)}` : ""}</div>
<hr>${lines}<hr>
${card.orderNote ? `<div class="n">Note: ${esc(card.orderNote)}</div>` : ""}
${card.placedBy ? `<div class="m">By ${esc(card.placedBy.name)}</div>` : ""}
</section>`;
}

export function kotHtml(cards: KdsCard[]) {
  const longestTicket = Math.max(1, ...cards.map((card) => card.lines.length + (card.orderNote ? 2 : 0)));
  const paperHeight = Math.max(64, 34 + longestTicket * 9);
  return `<!doctype html><html><head><meta charset="utf-8"><title>KOT</title><style>
@page{size:80mm ${paperHeight}mm;margin:0}
*{box-sizing:border-box}html{background:#fff;color-scheme:light}
body{margin:0;width:80mm;padding:4mm;font-family:ui-monospace,Menlo,Consolas,monospace;color:#000}
h1{font-size:22px;margin:0;text-align:center}.m{font-size:12px;text-align:center}
hr{border:0;border-top:1px dashed #000;margin:6px 0}
.l{font-size:16px;margin:4px 0}.x{font-size:12px;margin-left:22px}.n{font-size:13px;font-weight:700}
section{break-after:page}section:last-child{break-after:auto}
</style></head><body>${cards.map(slip).join("")}</body></html>`;
}

const KEY = "tableqr.kds.autoKot";
export const autoKotSaved = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export const saveAutoKot = (on: boolean) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private window */ } };
