import { sharedBill } from "@/server/billing/bill-link";
import { billPdf, billPdfName } from "@/server/billing/bill-pdf";

// The bill from a signed link as a PDF file, for "Download PDF" on the bill page
export async function GET(_req: Request, ctx: RouteContext<"/b/[token]/pdf">) {
  const { token } = await ctx.params;
  const b = await sharedBill(token);
  if (!b || b.cancelled) return new Response("Not found", { status: 404 });
  const pdf = await billPdf(b);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${billPdfName(b)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
