import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@/db/schema";
import { db } from "@/db";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { announceBill } from "./payments";
import { computeDraft, loadBillInputs, lockSession, syncBill, type BillScope } from "./bill";
import { requireFeature } from "../plan";

// A discount on the whole bill, given by billing staff: a percent or a rupee amount, always with a
// reason, recorded in the audit log. One bill-level discount at a time (giving another replaces it),
// and only before anyone has paid, so no share that was already settled changes under a guest.

export const discountRoles = ["owner", "manager", "accountant", "cashier"] as const;

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "userId" | "name" | "roles">;
type DiscountInput = { sessionId: string; kind: "percent" | "flat"; /** percent: 1-100; flat: rupees */ value: number; reason: string };

const guard = (staff: Staff) => {
  if (!staff.roles.some((r) => (discountRoles as readonly string[]).includes(r))) throw new AppError("forbidden", "Your role cannot give discounts.");
};

/** Locks the visit, makes sure its bill exists, and refuses once money has moved */
async function openBill(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], scope: BillScope, now: Date) {
  const session = await lockSession(tx, scope);
  if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
  const { billId } = await syncBill(tx, scope, now);
  const shares = await tx.select({ paidPaise: s.billShares.paidPaise }).from(s.billShares).where(and(eq(s.billShares.tenantId, scope.tenantId), eq(s.billShares.billId, billId)));
  const moving = await tx
    .select({ id: s.payments.id })
    .from(s.payments)
    .where(and(eq(s.payments.tenantId, scope.tenantId), eq(s.payments.billId, billId), inArray(s.payments.status, ["initiated", "pending", "success"])));
  if (shares.some((sh) => sh.paidPaise > 0) || moving.length) {
    throw new AppError("invalid_state", "Someone has already paid on this bill. Reopen it before changing the discount.", { reason: "paid" });
  }
  return billId;
}

export async function setBillDiscount(staff: Staff, input: DiscountInput, now = new Date()) {
  guard(staff);
  await requireFeature(staff.tenantId, "discounts");
  const kind = input.kind === "flat" ? "flat" : "percent";
  const value = Number(input.value);
  const reason = String(input.reason ?? "").trim().slice(0, 200);
  if (reason.length < 2) throw new AppError("invalid_state", "Write why this discount is given.", { reason: "reason" });
  if (kind === "percent" && !(Number.isFinite(value) && value > 0 && value <= 100)) throw new AppError("invalid_state", "Enter a percent from 1 to 100.", { reason: "value" });
  if (kind === "flat" && !(Number.isInteger(value) && value > 0)) throw new AppError("invalid_state", "Enter the discount in whole rupees.", { reason: "value" });
  const scope: BillScope = { tenantId: staff.tenantId, outletId: staff.outletId, sessionId: String(input.sessionId) };

  const result = await db.transaction(async (tx) => {
    const billId = await openBill(tx, scope, now);
    // The discount is worked out on the food total before any other bill-level discount
    const inputs = await loadBillInputs(tx, scope);
    const base = computeDraft({ ...inputs, discounts: inputs.discounts.filter((d) => d.orderLineId) }).totals.subtotalPaise;
    if (base <= 0) throw new AppError("invalid_state", "There is nothing on this bill to discount.", { reason: "empty" });
    const amountPaise = kind === "percent" ? Math.round((base * Math.round(value * 100)) / 10000) : Math.min(base, Math.round(value * 100));
    const before = inputs.discounts.filter((d) => !d.orderLineId).reduce((n, d) => n + d.amountPaise, 0);
    await tx.delete(s.discounts).where(and(eq(s.discounts.tenantId, scope.tenantId), eq(s.discounts.billId, billId), isNull(s.discounts.orderLineId)));
    await tx.insert(s.discounts).values({
      tenantId: scope.tenantId,
      billId,
      kind,
      // Basis points for a percent, paise for rupees: both are the typed number times 100
      value: Math.round(value * 100),
      amountPaise,
      reason,
      appliedByUserId: staff.userId,
    });
    await syncBill(tx, scope, now);
    await audit(tx, staff, { action: "bill.discount_set", entity: "bill", entityId: billId, before: { discountPaise: before }, after: { kind, value, amountPaise }, reason, now });
    return { billId, amountPaise };
  }, LOCK_THEN_READ);
  announceBill(scope);
  return result;
}

export async function clearBillDiscount(staff: Staff, sessionId: string, now = new Date()) {
  guard(staff);
  const scope: BillScope = { tenantId: staff.tenantId, outletId: staff.outletId, sessionId: String(sessionId) };
  await db.transaction(async (tx) => {
    const billId = await openBill(tx, scope, now);
    await tx.delete(s.discounts).where(and(eq(s.discounts.tenantId, scope.tenantId), eq(s.discounts.billId, billId), isNull(s.discounts.orderLineId)));
    await syncBill(tx, scope, now);
    await audit(tx, staff, { action: "bill.discount_removed", entity: "bill", entityId: billId, now });
  }, LOCK_THEN_READ);
  announceBill(scope);
}

/** The bill-level discount on a visit's bill, for the billing screen */
export async function billDiscount(staff: Pick<StaffSession, "tenantId">, billId: string) {
  const [row] = await db
    .select({ kind: s.discounts.kind, value: s.discounts.value, amountPaise: s.discounts.amountPaise, reason: s.discounts.reason })
    .from(s.discounts)
    .where(and(eq(s.discounts.tenantId, staff.tenantId), eq(s.discounts.billId, billId), isNull(s.discounts.orderLineId)));
  return row ?? null;
}
