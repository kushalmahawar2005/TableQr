import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

// A bill the guest can open from WhatsApp: /b/<bill id>.<signature>. The signature is an HMAC of
// the bill id, so the link cannot be guessed or changed to another bill, and nothing is stored.
// The page shows the bill and saves it as a PDF from the phone's print sheet.

function secret() {
  const value = process.env.OTP_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("OTP_SECRET is not set");
  return "tableqr-local-otp-secret";
}

const sign = (billId: string) => createHmac("sha256", secret()).update(`bill-link:${billId}`).digest("base64url").slice(0, 22);

export function billToken(billId: string) {
  return `${billId}.${sign(billId)}`;
}

/** The bill id inside a link, or null when the link was not made by us */
export function billIdFromToken(token: string): string | null {
  const [billId, sig, extra] = String(token ?? "").split(".");
  if (!billId || !sig || extra !== undefined || billId.length > 40) return null;
  const want = Buffer.from(sign(billId));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? billId : null;
}

type Snapshot = {
  docType?: "tax_invoice" | "receipt";
  lines: { nameEn: string; qty: number; amountPaise: number }[];
  subtotalPaise: number;
  discountPaise: number;
  serviceChargePaise: number;
  taxBreakup: Record<string, number> | null;
  roundOffPaise: number;
  totalPaise: number;
  totalInWords?: string;
};

export type SharedBill = NonNullable<Awaited<ReturnType<typeof sharedBill>>>;

/** The bill behind a link: the frozen invoice once paid, else the bill as it stands now */
export async function sharedBill(token: string) {
  const billId = billIdFromToken(token);
  if (!billId) return null;
  const [row] = await db
    .select({ bill: s.bills, outlet: s.outlets, table: s.diningTables })
    .from(s.bills)
    .innerJoin(s.outlets, and(eq(s.outlets.tenantId, s.bills.tenantId), eq(s.outlets.id, s.bills.outletId)))
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.bills.tenantId), eq(s.tableSessions.id, s.bills.sessionId)))
    .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
    .where(eq(s.bills.id, billId));
  if (!row) return null;
  const { bill, outlet, table } = row;
  const t = bill.tenantId;
  const [[invoice], payments] = await Promise.all([
    db.select().from(s.invoices).where(and(eq(s.invoices.tenantId, t), eq(s.invoices.billId, bill.id), isNull(s.invoices.shareId))),
    db.select({ method: s.payments.method, amountPaise: s.payments.amountPaise, tipPaise: s.payments.tipPaise }).from(s.payments).where(and(eq(s.payments.tenantId, t), eq(s.payments.billId, bill.id), inArray(s.payments.status, ["success", "refunded"]))),
  ]);
  let snap = invoice?.snapshot as Snapshot | undefined;
  if (!snap) {
    const lines = await db
      .select({ name: s.orderLines.nameEn, qty: s.orderLines.qty, unit: s.orderLines.unitPricePaise })
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, t), eq(s.orderLines.sessionId, bill.sessionId), inArray(s.orderLines.status, ["placed", "accepted", "preparing", "ready", "served"])));
    snap = {
      lines: lines.map((l) => ({ nameEn: l.name, qty: l.qty, amountPaise: l.qty * l.unit })),
      subtotalPaise: bill.subtotalPaise,
      discountPaise: bill.discountPaise,
      serviceChargePaise: bill.serviceChargePaise,
      taxBreakup: bill.taxBreakup ?? (bill.taxPaise ? { "": bill.taxPaise } : null),
      roundOffPaise: bill.roundOffPaise,
      totalPaise: bill.totalPaise,
    };
  }
  return {
    outlet: { name: outlet.name, address: outlet.address, city: outlet.city, gstin: outlet.gstin, fssai: outlet.fssai, timezone: outlet.timezone },
    table: table.code,
    docType: invoice ? (snap.docType ?? (outlet.gstin ? "tax_invoice" : "receipt")) : ("bill" as const),
    number: invoice?.number ?? null,
    issuedAt: (invoice?.issuedAt ?? bill.requestedAt ?? bill.createdAt)?.getTime() ?? null,
    paid: bill.status === "paid",
    cancelled: bill.status === "cancelled",
    snap,
    payments: payments.map((p) => ({ method: p.method, paise: p.amountPaise + p.tipPaise })),
  };
}
