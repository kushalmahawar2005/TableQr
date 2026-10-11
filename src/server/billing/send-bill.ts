import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { whatsappNumber } from "@/domain/bill-message";
import { AppError } from "../errors";
import type { StaffSession } from "../staff/auth";
import { rememberCustomer } from "../staff/customers";
import { requireStaffRole } from "../staff/waiter";
import { posRoles } from "../staff/pos-read";
import { sendWhatsAppPdf, whatsappReady } from "../whatsapp/cloud";
import { billToken, sharedBill } from "./bill-link";
import { billPdf, billPdfName } from "./bill-pdf";

// "Send" on the billing screen: the bill goes to the guest's WhatsApp as a PDF, with no chat
// opened on the cashier's phone. Every send is kept with its outcome, the number masked.

const mask = (to: string) => `+${to.slice(0, 4)}xxxxxx${to.slice(-2)}`;

export async function sendBillOnWhatsApp(staff: StaffSession, input: { sessionId: string; phone: string }) {
  await requireStaffRole(staff, posRoles);
  if (!whatsappReady()) throw new AppError("invalid_state", "WhatsApp is not connected yet.", { reason: "not_connected" });
  const to = whatsappNumber(String(input.phone ?? ""));
  if (!to) throw new AppError("invalid_state", "Enter a 10-digit mobile number.", { reason: "phone" });
  const [bill] = await db
    .select({ id: s.bills.id })
    .from(s.bills)
    .where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.outletId, staff.outletId), eq(s.bills.sessionId, String(input.sessionId))));
  if (!bill) throw new AppError("invalid_state", "Get the bill first, then send it.", { reason: "no_bill" });
  const shared = (await sharedBill(billToken(bill.id)))!;
  const pdf = await billPdf(shared);

  const [delivery] = await db
    .insert(s.receiptDeliveries)
    .values({ tenantId: staff.tenantId, outletId: staff.outletId, billId: bill.id, channel: "whatsapp", destination: mask(to), status: "queued" })
    .$returningId();
  let ref: string | null = null;
  let failure: string | null = null;
  try {
    ref = await sendWhatsAppPdf({ to, pdf, filename: billPdfName(shared), outletName: shared.outlet.name });
  } catch (e) {
    failure = e instanceof Error ? e.message : "unknown";
  }
  await db
    .update(s.receiptDeliveries)
    .set({ status: failure ? "failed" : "sent", providerRef: ref?.slice(0, 100) || null })
    .where(and(eq(s.receiptDeliveries.tenantId, staff.tenantId), eq(s.receiptDeliveries.id, delivery.id)));
  if (failure) throw new AppError("invalid_state", `WhatsApp could not send it: ${failure}`, { reason: "send_failed" });
  await rememberCustomer(staff, { sessionId: String(input.sessionId), phone: to.slice(2) }).catch(() => undefined);
  return { sent: true };
}
