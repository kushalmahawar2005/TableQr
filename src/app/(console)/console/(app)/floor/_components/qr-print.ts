export type QrSize = "a6" | "a5" | "a4";
/**
 * Posters always print on A4 paper (what restaurants and print shops have), several to a sheet,
 * with dashed cut lines. Cells fill the A4 area inside the 8 mm page margin: 194 x 281 mm.
 */
export const QR_SIZES: { id: QrSize; label: string; hint: string; qrMm: number; scale: number; perPage: number; cols: number; cellMm: [number, number] }[] = [
  { id: "a6", label: "Small · 4 per A4", hint: "Table stand", qrMm: 70, scale: 1, perPage: 4, cols: 2, cellMm: [97, 140] },
  { id: "a5", label: "Medium · 2 per A4", hint: "Table top or menu", qrMm: 85, scale: 1.1, perPage: 2, cols: 1, cellMm: [194, 140] },
  { id: "a4", label: "Large · 1 per A4", hint: "Wall or door", qrMm: 150, scale: 1.5, perPage: 1, cols: 1, cellMm: [194, 280] },
];

export const qrSize = (id: QrSize) => QR_SIZES.find((s) => s.id === id)!;

/** Print rules for a QR sheet: posters grouped into `.qr-page` blocks of `perPage`, one block per A4 sheet. */
export function qrSheetCss(id: QrSize) {
  const { cols, cellMm: [w, h] } = qrSize(id);
  return `@page{size:A4 portrait;margin:8mm}@media print{.no-print{display:none!important}body{background:#fff}`
    + `.qr-sheet{display:block!important;max-width:none!important;padding:0!important;margin:0!important}`
    + `.qr-page{display:grid!important;grid-template-columns:repeat(${cols},${w}mm);grid-auto-rows:${h}mm;break-after:page;break-inside:avoid}.qr-page:last-child{break-after:auto}`
    + `.poster{box-sizing:border-box;width:${w}mm;height:${h}mm;min-height:0!important;margin:0!important;padding:5mm!important;gap:2.5mm!important;overflow:hidden;border:0.3mm dashed #b8b2a7!important;border-radius:0!important;box-shadow:none!important;break-inside:avoid}}`;
}

/** Split posters into A4 sheets */
export function qrPages<T>(items: T[], id: QrSize): T[][] {
  const { perPage } = qrSize(id);
  return Array.from({ length: Math.ceil(items.length / perPage) }, (_, i) => items.slice(i * perPage, (i + 1) * perPage));
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One printable poster per table: outlet, what to do, the QR, the table name and the join code. */
export function posterHtml(p: { outlet: string; table: string; svg: string; joinCode: string | null; size: QrSize }) {
  const { qrMm: qr, scale, cellMm: [w, h] } = qrSize(p.size);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Table ${esc(p.table)} QR</title><style>
@page{size:A4 portrait;margin:8mm}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1f2937;text-align:center}
.card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${3 * scale}mm;width:${w}mm;min-height:${h}mm;border:0.3mm dashed #b8b2a7;padding:${5 * scale}mm;break-inside:avoid}
h1{margin:0;font-size:${7 * scale}mm}
.sub{margin:0;font-size:${4.2 * scale}mm;color:#4b5563}
.qr{width:${qr}mm;height:${qr}mm}.qr svg{width:100%;height:100%;display:block}
.table{font-size:${11 * scale}mm;font-weight:800;margin:0}
.join{font-size:${4 * scale}mm;color:#4b5563}.join b{font-size:${5 * scale}mm;letter-spacing:.2em;color:#1f2937}
.foot{font-size:${3 * scale}mm;color:#9ca3af}
</style></head><body><div class="card"><h1>${esc(p.outlet)}</h1><p class="sub">Scan to see the menu, order and pay from your phone</p><div class="qr">${p.svg}</div><p class="table">Table ${esc(p.table)}</p>${p.joinCode ? `<p class="join">Joining friends? Use code <b>${esc(p.joinCode)}</b></p>` : ""}<p class="foot">Powered by Tableeqr</p></div></body></html>`;
}

/** Prints through a hidden frame so no pop-up is blocked. */
export function printPoster(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  let printed = false;
  const printOnce = () => {
    if (printed || !frame.isConnected) return;
    printed = true;
    frame.dataset.printed = "1";
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1500);
  };
  frame.onload = printOnce;
  // Some browsers do not fire onload for document.write content
  setTimeout(printOnce, 400);
}

export function downloadSvg(svg: string, name: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
