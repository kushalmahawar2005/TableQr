import { PORTRAIT_GUARD_MM, type PaperMm } from "./thermal";

// Printing a slip from the browser, on this device. Runs only in the browser.

export type { PaperMm };

const PAPER_KEY = "tq_paper_mm";
/** The receipt roll width of this device's printer; each printer is set up on the device it serves */
export const paperSaved = (): PaperMm => { try { return localStorage.getItem(PAPER_KEY) === "58" ? 58 : 80; } catch { return 80; } };
const paperListeners = new Set<() => void>();
export const savePaper = (mm: PaperMm) => { try { localStorage.setItem(PAPER_KEY, String(mm)); } catch { /* private window */ } paperListeners.forEach((fn) => fn()); };
export const subscribePaper = (fn: () => void) => { paperListeners.add(fn); return () => { paperListeners.delete(fn); }; };

/**
 * Slips written for an 80 mm roll by older code. For a 58 mm roll the whole slip is scaled down to
 * fit. Slips built by thermalDocument are already laid out for the roll they were built for.
 */
export function forPaper(html: string, mm: PaperMm = paperSaved()) {
  if (mm === 80 || !/@page\{size:80mm /.test(html)) return html;
  return html.replace(/@page\{size:80mm /g, "@page{size:58mm ").replace("</style>", `body{zoom:${58 / 80}}</style>`);
}

const PAGE_RULE = /@page\{size:(\d+)mm [\d.]+mm;margin:0\}/;

/** Chrome's print window can add its own margins and header lines, whatever the page asks for; this spare paper stops the last line spilling onto a second page */
const DIALOG_TAIL_MM = 14;

/**
 * A slip's page height is only an estimate when the html is built. Once laid out, set it to the
 * real height of the tallest slip so the roll neither feeds blank paper nor cuts the last lines.
 * The page is never shorter than portrait needs: a page wider than tall is printed sideways.
 */
export function fitThermalPage(doc: Document, tailMm = 0) {
  const width = Number(doc.head?.innerHTML.match(PAGE_RULE)?.[1]);
  const box = doc.body?.getBoundingClientRect();
  if (!width || !box?.height || !box.width) return;
  const slips = Array.from(doc.querySelectorAll<HTMLElement>("[data-slip]"));
  const contentPx = slips.length ? Math.max(...slips.map((el) => el.getBoundingClientRect().height)) : box.height;
  // A slip scaled down for a narrower roll may be measured before or after its zoom; the body
  // spans the paper width once scaled, so the width ratio gives the printed height either way
  const scale = Math.min(1, (width * 96) / 25.4 / box.width);
  const wanted = Math.ceil((contentPx * scale * 25.4) / 96) + 1 + tailMm;
  const style = doc.createElement("style");
  style.textContent = `@page{size:${width}mm ${Math.max(wanted, width + PORTRAIT_GUARD_MM)}mm;margin:0}`;
  doc.head.appendChild(style);
}

/**
 * Measures a slip in the browser and returns its HTML with an exact @page height. Used by local
 * print bridges that send HTML to the OS print stack instead of opening Chrome's print dialog.
 */
export async function fitThermalHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:400px;height:1000px;border:0";
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("Could not prepare the receipt for printing.");
    doc.open();
    doc.write(html);
    doc.close();
    await new Promise<void>((resolve) => {
      if (doc.readyState === "complete") resolve();
      else frame.addEventListener("load", () => resolve(), { once: true });
    });
    await doc.fonts?.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    fitThermalPage(doc);
    const rules = Array.from(doc.querySelectorAll("style"), (el) => el.textContent ?? "").join("\n");
    const matches = Array.from(rules.matchAll(/@page\{size:(\d+)mm ([\d.]+)mm;margin:0\}/g));
    const height = Number(matches.at(-1)?.[2]);
    if (!height) throw new Error("Could not measure the receipt page.");
    return { html: `<!doctype html>${doc.documentElement.outerHTML}`, heightMm: height };
  } finally {
    frame.remove();
  }
}

function printInPopup(html: string) {
  const win = window.open("", "tableeqr-print", "popup,width=460,height=720");
  if (!win) return false;
  try {
    win.document.open();
    win.document.write(forPaper(html));
    win.document.close();
  } catch {
    win.close();
    return false;
  }
  let done = false;
  const go = () => { if (done) return; done = true; fitThermalPage(win.document, DIALOG_TAIL_MM); win.focus(); win.print(); };
  win.addEventListener("load", go);
  setTimeout(go, 500);
  win.addEventListener("afterprint", () => win.close());
  return true;
}

function printInFrame(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Off screen but with a real width, so the slip lays out at paper width and can be measured
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:400px;height:10px;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(forPaper(html));
  doc.close();
  let done = false;
  const go = () => { if (done) return; done = true; fitThermalPage(doc, DIALOG_TAIL_MM); frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1500); };
  frame.onload = go;
  setTimeout(go, 400);
}

/**
 * Prints a slip. A print someone just asked for opens in a small window of its own, so the page it
 * prints is the slip alone: nothing of the console around it, and its own paper size and margins.
 * A print nobody is waiting at (a kitchen ticket printing itself) goes through a hidden frame, as
 * does any print a pop-up blocker refuses. Returns which of the two was used.
 */
export function printHtml(html: string, opts: { background?: boolean } = {}): "window" | "frame" {
  if (!opts.background && printInPopup(html)) return "window";
  printInFrame(html);
  return "frame";
}
