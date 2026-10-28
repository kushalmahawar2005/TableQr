import { paperSaved } from "@/lib/print/runtime";
import { charsPerLine, clock, esc, profileFor, thermalDocument, wrapRows, type PaperMm } from "@/lib/print/thermal";
import { isDeliveryTable } from "@/domain/delivery";
import type { KdsCard } from "./kds-logic";

// The kitchen order ticket (KOT) for a thermal printer: what the cook needs and nothing else, in
// big type. The order type and table come first, then the round and time, then each dish with its
// options and notes under it. No prices. Long names and notes wrap; nothing is cut off.

const PARCEL_NOTE = "PACK FOR TAKEAWAY";

function slip(card: KdsCard) {
  const takeaway = card.tableCodes.some((t) => /^TA-\d+$/.test(t));
  // Home delivery: the hidden counter code means nothing to the cook, so say what it is
  const delivery = card.tableCodes.some(isDeliveryTable);
  const lines = card.lines
    .map((l) => {
      const extras = [
        ...l.modifiers.map((m) => `<div class="x">+ ${esc(m.en)}</div>`),
        l.personalForPickup ? `<div class="x w">${PARCEL_NOTE}</div>` : "",
        l.note ? `<div class="x w">NOTE: ${esc(l.note)}</div>` : "",
      ].join("");
      return `<div class="l"><span class="q">${l.qty}×</span><div class="d"><div class="nm">${esc(l.nameEn)}</div>${extras}</div></div>`;
    })
    .join("");
  return `<div class="ty">${delivery ? "DELIVERY · PACK ALL" : takeaway ? "PARCEL" : "DINE-IN"}</div>
<h1>${delivery ? esc(card.placedBy?.name || "Delivery") : esc(card.tableCodes.join(" + "))}</h1>
<div class="mt"><b>Round ${card.roundNo}</b> · ${clock(card.placedAt)}${card.station ? ` · ${esc(card.station)}` : ""}</div>
<hr class="s">${lines}<hr class="s">
${card.orderNote ? `<div class="on"><b>ORDER NOTE:</b> ${esc(card.orderNote)}</div>` : ""}
${card.placedBy ? `<div class="m c">By ${esc(card.placedBy.name)}</div>` : ""}`;
}

export function kotHtml(cards: KdsCard[], paper: PaperMm = paperSaved()) {
  const profile = profileFor(paper);
  const perLine = charsPerLine(profile, profile.fsLarge + 1);
  // Height before measuring: each ticket on its own page, every page as tall as the longest
  const rows = (card: KdsCard) => card.lines.reduce((n, line) => n
    + wrapRows(line.nameEn, perLine - 4) + line.modifiers.reduce((m, mod) => m + wrapRows(`+ ${mod.en}`, perLine), 0)
    + (line.personalForPickup ? 1 : 0) + (line.note ? wrapRows(`NOTE: ${line.note}`, perLine) : 0), 0)
    + (card.orderNote ? wrapRows(`ORDER NOTE: ${card.orderNote}`, perLine) + 1 : 0);
  const estimateMm = 40 + Math.max(1, ...cards.map(rows)) * 8;
  return thermalDocument({
    title: "KOT",
    paper,
    css: `.ty{text-align:center;font-size:${profile.fsLarge + 2}px;font-weight:700;letter-spacing:.14em}
h1{text-align:center;font-size:${profile.fsHuge}px;line-height:1.1;font-weight:700;overflow-wrap:anywhere}
.mt{text-align:center;font-size:${profile.fs + 1}px;margin-top:2px}
hr.s{border-top:2px solid #000;margin:6px 0}
.l{display:flex;gap:6px;margin:6px 0;align-items:flex-start}
.q{flex:none;min-width:2.4em;font-size:${profile.fsLarge + 3}px;font-weight:700;line-height:1.15}
.d{min-width:0;flex:1}.nm{font-size:${profile.fsLarge + 1}px;font-weight:700;line-height:1.2}
.x{font-size:${profile.fs}px;margin-top:1px}
.on{border:2px solid #000;padding:3px 4px;margin:6px 0;font-size:${profile.fs + 1}px}`,
    slips: cards.map(slip),
    estimateMm,
  });
}

const KEY = "tableeqr.kds.autoKot";
const LEGACY_KEY = "tableqr.kds.autoKot";
export const autoKotSaved = () => {
  try {
    const current = localStorage.getItem(KEY);
    if (current !== null) return current === "1";
    const previous = localStorage.getItem(LEGACY_KEY);
    if (previous !== null) {
      try { localStorage.setItem(KEY, previous); localStorage.removeItem(LEGACY_KEY); }
      catch { /* A full browser store must not change the existing auto-print preference. */ }
    }
    return previous === "1";
  } catch { return false; }
};
export const saveAutoKot = (on: boolean) => { try { localStorage.setItem(KEY, on ? "1" : "0"); localStorage.removeItem(LEGACY_KEY); } catch { /* private window */ } };
