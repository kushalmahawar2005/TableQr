import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { addressLine, dishKey, mergeLines, taxRows } from "@/domain/invoice-view";
import type { SharedBill } from "./bill-link";

// The bill as a small PDF on an 80 mm wide page, the way a thermal printer prints it. Built with
// the PDF standard fonts, so nothing is downloaded; those fonts have no ₹ sign, hence "Rs.".

const W = 227; // 80 mm in points
const M = 14;
const rs = (paise: number) => `${paise < 0 ? "-" : ""}Rs. ${(Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** The standard fonts only draw Latin-1; anything else (Hindi, emoji) is dropped */
const safe = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7e\xa0-\xff]/g, "").trim();
const TITLE = { tax_invoice: "TAX INVOICE", receipt: "RECEIPT", bill: "BILL" } as const;
const METHOD: Record<string, string> = { upi: "UPI", card: "Card", wallet: "Wallet", cash: "Cash" };

/** Splits text into lines that fit the width */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of safe(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

export async function billPdf(b: SharedBill): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${TITLE[b.docType]} - ${safe(b.outlet.name)} - Table ${safe(b.table)}`);
  doc.setCreator("Tableeqr");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const inner = W - 2 * M;
  const when = b.issuedAt ? new Intl.DateTimeFormat("en-IN", { timeZone: b.outlet.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(b.issuedAt)) : "";

  // Lay everything out first, then size the page to fit it
  type Op = (page: PDFPage, y: number) => number;
  const ops: { h: number; draw: Op }[] = [];
  const text = (t: string, o: { size?: number; f?: PDFFont; center?: boolean; gray?: boolean } = {}) => {
    const size = o.size ?? 8.5;
    const f = o.f ?? font;
    for (const line of wrap(t, f, size, inner)) {
      ops.push({
        h: size + 3,
        draw: (page, y) => {
          const x = o.center ? (W - f.widthOfTextAtSize(line, size)) / 2 : M;
          page.drawText(line, { x, y: y - size, size, font: f, color: o.gray ? rgb(0.35, 0.35, 0.35) : rgb(0, 0, 0) });
          return size + 3;
        },
      });
    }
  };
  const row = (left: string, right: string, o: { size?: number; f?: PDFFont; qty?: string } = {}) => {
    const size = o.size ?? 8.5;
    const f = o.f ?? font;
    const rightW = f.widthOfTextAtSize(right, size);
    const qtyW = o.qty ? 18 : 0;
    const lines = wrap(left, f, size, inner - rightW - qtyW - 6);
    lines.forEach((line, i) =>
      ops.push({
        h: size + 3,
        draw: (page, y) => {
          if (i === 0 && o.qty) page.drawText(o.qty, { x: M, y: y - size, size, font: f });
          page.drawText(line, { x: M + qtyW, y: y - size, size, font: f });
          if (i === 0) page.drawText(right, { x: W - M - rightW, y: y - size, size, font: f });
          return size + 3;
        },
      }),
    );
  };
  const rule = () => ops.push({ h: 8, draw: (page, y) => { page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.6, dashArray: [2, 2], color: rgb(0, 0, 0) }); return 8; } });
  const gap = (h: number) => ops.push({ h, draw: () => h });

  text(b.outlet.name, { size: 12, f: bold, center: true });
  text(addressLine(b.outlet.address, b.outlet.city), { size: 7.5, center: true, gray: true });
  if (b.outlet.gstin) text(`GSTIN ${b.outlet.gstin}`, { size: 7.5, center: true, gray: true });
  if (b.outlet.fssai) text(`FSSAI ${b.outlet.fssai}`, { size: 7.5, center: true, gray: true });
  gap(3);
  text(TITLE[b.docType], { size: 9, f: bold, center: true });
  text([`Table ${b.table}`, b.number ? `No. ${b.number}` : "", when].filter(Boolean).join("  |  "), { size: 7.5, center: true, gray: true });
  rule();
  for (const l of mergeLines(b.snap.lines, dishKey)) row(l.nameEn, rs(l.amountPaise), { qty: `${l.qty}x` });
  rule();
  const s = b.snap;
  row("Subtotal", rs(s.subtotalPaise));
  if (s.discountPaise > 0) row("Discount", rs(-s.discountPaise));
  if (s.deliveryFeePaise) row("Delivery charge", rs(s.deliveryFeePaise));
  if (s.serviceChargePaise > 0) row("Service charge", rs(s.serviceChargePaise));
  for (const t of taxRows(s.taxBreakup, b.outlet.gstin)) row(t.label, rs(t.paise));
  if (s.roundOffPaise) row("Round off", rs(s.roundOffPaise));
  gap(2);
  row("TOTAL", rs(s.totalPaise), { size: 11, f: bold });
  if (s.totalInWords) text(s.totalInWords, { size: 7.5, gray: true });
  if (b.payments.length) {
    rule();
    for (const p of b.payments) row(`Paid by ${METHOD[p.method] ?? p.method}`, rs(p.paise));
  }
  rule();
  text("Thank you for dining with us!", { size: 8, center: true });
  text("Powered by Tableeqr", { size: 7, center: true, gray: true });

  const height = ops.reduce((n, o) => n + o.h, 0) + 2 * M;
  const page = doc.addPage([W, height]);
  let y = height - M;
  for (const o of ops) y -= o.draw(page, y);
  return doc.save();
}

export const billPdfName = (b: SharedBill) => `${b.docType === "bill" ? "Bill" : b.docType === "receipt" ? "Receipt" : "Invoice"}-${safe(b.outlet.name).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "Tableeqr"}-${safe(b.table).replace(/[^A-Za-z0-9]+/g, "")}.pdf`;
