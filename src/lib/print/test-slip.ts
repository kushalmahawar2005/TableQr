import { clock, dateTime, esc, profileFor, rs, thermalDocument, type PaperMm } from "./thermal";

// A slip for checking a printer: its name, the roll width, a ruler across the printable strip, and
// the characters real slips use. If either edge of the ruler is cut off, the print window's scale or
// margins are wrong, which is far easier to see here than on a customer's bill.

export function testSlipHtml(paper: PaperMm, o: { printerName?: string | null; outletName: string }) {
  const profile = profileFor(paper);
  const cols = Math.max(10, Math.floor((profile.contentMm * 96) / 25.4 / (profile.fs * 0.6)));
  const ruler = Array.from({ length: cols }, (_, i) => ((i + 1) % 10 === 0 ? String(((i + 1) / 10) % 10) : "-")).join("");
  const edge = `|${"=".repeat(Math.max(0, cols - 2))}|`;
  const body = `<h1>TEST PRINT</h1>
<div class="c m">${esc(o.outletName)}</div>
<hr>
<div class="r"><span>Printer</span><span>${esc(o.printerName || "This device")}</span></div>
<div class="r"><span>Roll</span><span>${paper} mm</span></div>
<div class="r"><span>Text width</span><span>${profile.contentMm} mm</span></div>
<div class="r"><span>Printed</span><span>${esc(dateTime(Date.now()))}</span></div>
<hr>
<pre>${esc(edge)}
${esc(ruler)}
${esc(edge)}</pre>
<div class="r"><span>Sample amount</span><span>${esc(rs(123450))}</span></div>
<div class="r b"><span>TOTAL</span><span>${esc(rs(98765))}</span></div>
<hr>
<div class="c m">Both edges of the lines above should show.<br>If one is cut off: print window, Margins None, Scale 100%.</div>
<div class="c m">${esc(clock(Date.now()))} · TableQR</div>`;
  return thermalDocument({
    title: "Test print",
    paper,
    css: `h1{font-size:${profile.fsLarge + 3}px;text-align:center;letter-spacing:.08em}pre{margin:4px 0;font:inherit;white-space:pre;overflow:hidden}`,
    slips: [body],
    estimateMm: 110,
  });
}
