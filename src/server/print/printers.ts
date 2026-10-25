import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { MAX_PRINTERS_PER_OUTLET, PRINTER_NAME_MAX } from "@/lib/print/jobs";
import { getTransport, isTransportId } from "@/lib/print/transports";
import type { PaperMm } from "@/lib/print/thermal";
import { AppError } from "../errors";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";

// The printers of one outlet and which of them it uses for customer slips and for the kitchen.
// Everything here is scoped to the signed-in person's restaurant and outlet; ids sent from a screen
// are only ever looked up inside that scope.

type Scope = { tenantId: string; outletId: string };
type Staff = Pick<StaffSession, "tenantId" | "outletId" | "userId" | "name" | "roles">;

export type PrinterInfo = {
  id: string;
  name: string;
  paperMm: PaperMm;
  transport: string;
  config: Record<string, string | number | boolean> | null;
};
export type PrintSetup = { outletId: string; printers: PrinterInfo[]; receiptPrinterId: string | null; kitchenPrinterId: string | null };

const info = (r: typeof s.printers.$inferSelect): PrinterInfo => ({ id: r.id, name: r.name, paperMm: r.paperMm === 58 ? 58 : 80, transport: r.transport, config: r.config ?? null });

/** What a screen needs to print here: the active printers and the outlet's two assignments */
export async function printSetup(scope: Scope): Promise<PrintSetup> {
  const [rows, [settings]] = await Promise.all([
    db.select().from(s.printers).where(and(eq(s.printers.tenantId, scope.tenantId), eq(s.printers.outletId, scope.outletId), eq(s.printers.isActive, true))).orderBy(s.printers.name),
    db.select().from(s.printSettings).where(and(eq(s.printSettings.tenantId, scope.tenantId), eq(s.printSettings.outletId, scope.outletId))),
  ]);
  const active = new Set(rows.map((r) => r.id));
  return {
    outletId: scope.outletId,
    printers: rows.map(info),
    receiptPrinterId: settings?.receiptPrinterId && active.has(settings.receiptPrinterId) ? settings.receiptPrinterId : null,
    kitchenPrinterId: settings?.kitchenPrinterId && active.has(settings.kitchenPrinterId) ? settings.kitchenPrinterId : null,
  };
}

function assertManager(staff: Pick<Staff, "roles">) {
  if (!staff.roles.some((r) => r === "owner" || r === "manager")) throw new AppError("forbidden", "Only a manager or owner can set up printers.");
}

export type PrinterInput = { id?: string; name: string; paperMm: number; transport: string; config?: unknown };

/** Adds a printer, or changes one of this outlet's */
export async function savePrinter(staff: Staff, input: PrinterInput, now = new Date()) {
  assertManager(staff);
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new AppError("invalid_state", "Give the printer a name, for example Counter printer.");
  if (name.length > PRINTER_NAME_MAX) throw new AppError("invalid_state", `Keep the name under ${PRINTER_NAME_MAX} letters.`);
  if (input.paperMm !== 58 && input.paperMm !== 80) throw new AppError("invalid_state", "Choose a 58 mm or 80 mm roll.");
  if (!isTransportId(input.transport)) throw new AppError("invalid_state", "Choose how this printer is connected.");
  const transport = getTransport(input.transport);
  if (!transport.implemented) throw new AppError("invalid_state", `${transport.label} is not available yet. Use browser print for now.`);
  const config = transport.validateConfig(input.config);
  if (!config.ok) throw new AppError("invalid_state", config.message);
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };

  return db.transaction(async (tx) => {
    const same = await tx.select({ id: s.printers.id }).from(s.printers)
      .where(and(eq(s.printers.tenantId, scope.tenantId), eq(s.printers.outletId, scope.outletId), eq(s.printers.name, name)));
    if (same.some((r) => r.id !== input.id)) throw new AppError("conflict", "A printer with that name already exists here.");
    if (input.id) {
      const [before] = await tx.select().from(s.printers).where(and(eq(s.printers.tenantId, scope.tenantId), eq(s.printers.outletId, scope.outletId), eq(s.printers.id, String(input.id)))).for("update");
      if (!before || !before.isActive) throw new AppError("not_found", "That printer is no longer here.");
      await tx.update(s.printers).set({ name, paperMm: input.paperMm, transport: transport.id, config: config.config })
        .where(and(eq(s.printers.tenantId, scope.tenantId), eq(s.printers.id, before.id)));
      await audit(tx, staff, { action: "printer.updated", entity: "printer", entityId: before.id, before: { name: before.name, paperMm: before.paperMm, transport: before.transport }, after: { name, paperMm: input.paperMm, transport: transport.id }, now });
      return before.id;
    }
    const [{ n }] = await tx.select({ n: count() }).from(s.printers).where(and(eq(s.printers.tenantId, scope.tenantId), eq(s.printers.outletId, scope.outletId), eq(s.printers.isActive, true)));
    if (n >= MAX_PRINTERS_PER_OUTLET) throw new AppError("invalid_state", `An outlet can have up to ${MAX_PRINTERS_PER_OUTLET} printers. Remove one you no longer use.`);
    const id = uuidv7();
    await tx.insert(s.printers).values({ id, tenantId: scope.tenantId, outletId: scope.outletId, name, paperMm: input.paperMm, transport: transport.id, config: config.config, createdBy: staff.userId, createdAt: now });
    await audit(tx, staff, { action: "printer.added", entity: "printer", entityId: id, after: { name, paperMm: input.paperMm, transport: transport.id }, now });
    return id;
  });
}

/** Removes a printer from use. Its old jobs keep its name, and any assignment to it is cleared. */
export async function archivePrinter(staff: Staff, printerId: string, now = new Date()) {
  assertManager(staff);
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(s.printers).where(and(eq(s.printers.tenantId, scope.tenantId), eq(s.printers.outletId, scope.outletId), eq(s.printers.id, String(printerId)))).for("update");
    if (!p || !p.isActive) throw new AppError("not_found", "That printer is no longer here.");
    await tx.update(s.printers).set({ isActive: false }).where(and(eq(s.printers.tenantId, scope.tenantId), eq(s.printers.id, p.id)));
    const [settings] = await tx.select().from(s.printSettings).where(and(eq(s.printSettings.tenantId, scope.tenantId), eq(s.printSettings.outletId, scope.outletId))).for("update");
    if (settings) {
      await tx.update(s.printSettings).set({
        receiptPrinterId: settings.receiptPrinterId === p.id ? null : settings.receiptPrinterId,
        kitchenPrinterId: settings.kitchenPrinterId === p.id ? null : settings.kitchenPrinterId,
        updatedBy: staff.userId,
      }).where(and(eq(s.printSettings.tenantId, scope.tenantId), eq(s.printSettings.id, settings.id)));
    }
    await audit(tx, staff, { action: "printer.removed", entity: "printer", entityId: p.id, before: { name: p.name }, now });
  });
}

/** Sets which printer this outlet uses for customer slips and for the kitchen; null clears one */
export async function assignPrinters(staff: Staff, input: { receiptPrinterId: string | null; kitchenPrinterId: string | null }, now = new Date()) {
  assertManager(staff);
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  await db.transaction(async (tx) => {
    const active = new Set((await tx.select({ id: s.printers.id }).from(s.printers).where(and(eq(s.printers.tenantId, scope.tenantId), eq(s.printers.outletId, scope.outletId), eq(s.printers.isActive, true)))).map((r) => r.id));
    for (const id of [input.receiptPrinterId, input.kitchenPrinterId]) if (id && !active.has(id)) throw new AppError("not_found", "That printer is not set up at this outlet.");
    const [before] = await tx.select().from(s.printSettings).where(and(eq(s.printSettings.tenantId, scope.tenantId), eq(s.printSettings.outletId, scope.outletId))).for("update");
    const values = { receiptPrinterId: input.receiptPrinterId || null, kitchenPrinterId: input.kitchenPrinterId || null, updatedBy: staff.userId };
    if (before) await tx.update(s.printSettings).set(values).where(and(eq(s.printSettings.tenantId, scope.tenantId), eq(s.printSettings.id, before.id)));
    else await tx.insert(s.printSettings).values({ tenantId: scope.tenantId, outletId: scope.outletId, ...values });
    await audit(tx, staff, { action: "printer.assigned", entity: "print_settings", entityId: before?.id ?? null, before: before ? { receipt: before.receiptPrinterId, kitchen: before.kitchenPrinterId } : null, after: { receipt: values.receiptPrinterId, kitchen: values.kitchenPrinterId }, now });
  });
}
