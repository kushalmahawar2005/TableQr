export type QrSize = "a6" | "a5" | "a4";
export const QR_SIZES: { id: QrSize; label: string; hint: string; qrMm: number }[] = [
  { id: "a6", label: "Small (A6)", hint: "Table stand", qrMm: 70 },
  { id: "a5", label: "Medium (A5)", hint: "Table top or menu", qrMm: 100 },
  { id: "a4", label: "Large (A4)", hint: "Wall or door", qrMm: 150 },
];

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One printable poster per table: outlet, what to do, the QR, the table name and the join code. */
export function posterHtml(p: { outlet: string; table: string; svg: string; joinCode: string | null; size: QrSize }) {
  const qr = QR_SIZES.find((s) => s.id === p.size)!.qrMm;
  const scale = p.size === "a4" ? 1.5 : p.size === "a5" ? 1.15 : 1;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Table ${esc(p.table)} QR</title><style>
@page{size:${p.size.toUpperCase()};margin:8mm}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1f2937;text-align:center}
.card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${4 * scale}mm;border:0.4mm dashed #b8b2a7;border-radius:4mm;padding:${6 * scale}mm;break-inside:avoid}
h1{margin:0;font-size:${7 * scale}mm}
.sub{margin:0;font-size:${4.2 * scale}mm;color:#4b5563}
.qr{width:${qr}mm;height:${qr}mm}.qr svg{width:100%;height:100%;display:block}
.table{font-size:${11 * scale}mm;font-weight:800;margin:0}
.join{font-size:${4 * scale}mm;color:#4b5563}.join b{font-size:${5 * scale}mm;letter-spacing:.2em;color:#1f2937}
.foot{font-size:${3 * scale}mm;color:#9ca3af}
</style></head><body><div class="card"><h1>${esc(p.outlet)}</h1><p class="sub">Scan to see the menu, order and pay from your phone</p><div class="qr">${p.svg}</div><p class="table">Table ${esc(p.table)}</p>${p.joinCode ? `<p class="join">Joining friends? Use code <b>${esc(p.joinCode)}</b></p>` : ""}<p class="foot">Powered by TableQR</p></div></body></html>`;
}

/** Prints through a hidden frame so no pop-up is blocked. */
export function printPoster(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 1500);
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    done();
  };
  // Some browsers do not fire onload for document.write content
  setTimeout(() => { if (frame.isConnected && !frame.dataset.printed) { frame.dataset.printed = "1"; frame.contentWindow?.focus(); frame.contentWindow?.print(); done(); } }, 400);
}

export function downloadSvg(svg: string, name: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
