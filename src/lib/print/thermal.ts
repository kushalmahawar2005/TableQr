// Shared basics for every slip Tableeqr prints on a receipt roll: the receipt, the kitchen ticket
// (KOT), the order slip and the day close. Each keeps its own layout; the paper sizes, the
// printable width, the typography and the page rule live here once.
//
// Printing goes through the browser, so this document is a plain HTML page with an `@page` rule.
// The rules that matter for a roll printer:
//  - The page is as wide as the roll and as tall as its content, and always taller than wide.
//    A page wider than it is tall is printed sideways.
//  - A roll prints less than its full width (about 72 of 80 mm, 48 of 58 mm) and the printer
//    centres that strip. Text laid out to the paper's edge is cut off, so the slip is laid out in
//    a strip a little narrower than the printable width, centred on the paper.

export type PaperMm = 58 | 80;

export type PrintProfile = {
  /** Width of the roll */
  paperMm: PaperMm;
  /** Width the text is laid out in: a little less than what the printer can print, so nothing is cut */
  contentMm: number;
  /** Type sizes in px: normal, small, large (item lines, totals), extra large (table number) */
  fs: number;
  fsSmall: number;
  fsLarge: number;
  fsHuge: number;
};

export const PRINT_PROFILES: Record<PaperMm, PrintProfile> = {
  80: { paperMm: 80, contentMm: 70, fs: 12, fsSmall: 10.5, fsLarge: 15, fsHuge: 30 },
  58: { paperMm: 58, contentMm: 46, fs: 11, fsSmall: 9.5, fsLarge: 13, fsHuge: 24 },
};

export const profileFor = (mm: PaperMm): PrintProfile => PRINT_PROFILES[mm === 58 ? 58 : 80];

/** A page must be taller than it is wide, by at least this much, or the printer turns it sideways */
export const PORTRAIT_GUARD_MM = 4;

/** Page height for a slip: the content's height, never less than portrait needs */
export const pageHeightMm = (paperMm: PaperMm, contentHeightMm: number) => Math.ceil(Math.max(contentHeightMm, paperMm + PORTRAIT_GUARD_MM));

export const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const rs = (paise: number) => `${paise < 0 ? "− " : ""}₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const clock = (ms: number) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(ms);
export const dateTime = (ms: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(ms);

/** Two columns on one line: the label wraps when it is long, the amount never does */
export const row = (label: string, value: string, cls = "") => `<div class="r${cls ? ` ${cls}` : ""}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;

/** The type, spacing and wrapping every slip shares */
export function thermalCss(profile: PrintProfile, pageHeight: number) {
  const side = (profile.paperMm - profile.contentMm) / 2;
  return `@page{size:${profile.paperMm}mm ${pageHeight}mm;margin:0}
*{box-sizing:border-box}
html{background:#fff;color-scheme:light}
html,body{margin:0;padding:0;height:auto}
body{width:${profile.paperMm}mm;padding:0 ${side}mm;font-family:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;font-size:${profile.fs}px;line-height:1.3;color:#000;overflow-wrap:anywhere}
h1,h2,p{margin:0}
b{font-weight:700}
.c{text-align:center}.m{font-size:${profile.fsSmall}px}.w{font-weight:700}
hr{border:0;border-top:1px dashed #000;margin:5px 0}
.r{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;column-gap:6px}
.r>span:first-child{min-width:0}
.r>span:last-child{flex:none;margin-left:auto;white-space:nowrap;text-align:right}
.b{font-weight:700;font-size:${profile.fsLarge}px}
section[data-slip]{display:block;padding:2mm 0 4mm;break-after:page}
section[data-slip]:last-child{break-after:auto}
@media print{html,body{background:#fff}}`;
}

export type ThermalDoc = {
  title: string;
  paper: PaperMm;
  /** The slip's own rules, added after the shared ones */
  css?: string;
  /** One entry per slip; each is cut onto its own page, all pages the height of the tallest slip */
  slips: string[];
  /** Estimated content height; the real height is measured just before printing */
  estimateMm: number;
};

export function thermalDocument(d: ThermalDoc) {
  const profile = profileFor(d.paper);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)}</title><style>${thermalCss(profile, pageHeightMm(profile.paperMm, d.estimateMm))}
${d.css ?? ""}</style></head><body>${d.slips.map((s) => `<section data-slip>${s}</section>`).join("")}</body></html>`;
}

/** How tall `text` is once wrapped at `perLine` characters; an estimate for the page height before measuring */
export const wrapRows = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));

/** The printable characters in one line of the profile's fixed-width type, for those estimates */
export const charsPerLine = (profile: PrintProfile, fontPx = profile.fs) => Math.max(10, Math.floor((profile.contentMm * 96) / 25.4 / (fontPx * 0.6)));
