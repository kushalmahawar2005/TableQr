"use server";
import { staffFor } from "@/server/staff/request";
import { AppError } from "@/server/errors";
import { menuManagerRoles, menuManagerData, saveMenuItem, archiveMenuItem, setMenuAvailability, adjustMenuPortions, saveMenuCategory, reorderCategories, archiveCategory, bulkPrice, savePairings, saveModifierGroup, setModifierGroupActive, reorderModifierGroups } from "@/server/staff/menu-manager";
import { parseMenuFile, commitMenuCsv } from "@/server/staff/menu-import";
import { storeMenuImage } from "@/server/menu-storage";

async function run<T>(work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) {
  try { return { ok: true as const, data: await work(await staffFor(menuManagerRoles)) }; }
  catch (e) { return { ok: false as const, error: e instanceof AppError ? e.message : "Could not complete this menu action.", code: e instanceof AppError ? e.code : "unknown" }; }
}
export async function dataAction() { return run(menuManagerData); }
export async function saveItemAction(input: Parameters<typeof saveMenuItem>[1]) { return run((s) => saveMenuItem(s, input)); }
export async function archiveItemAction(id: string, restore = false) { return run((s) => archiveMenuItem(s, id, restore)); }
export async function availabilityAction(id: string, mode: "available" | "today" | "off", portions?: number | null) { return run((s) => setMenuAvailability(s, id, mode, portions)); }
export async function portionsAction(id: string, portions: number | null) { return run((s) => adjustMenuPortions(s, id, portions)); }
export async function saveCategoryAction(input: Parameters<typeof saveMenuCategory>[1]) { return run((s) => saveMenuCategory(s, input)); }
export async function reorderAction(ids: string[]) { return run((s) => reorderCategories(s, ids)); }
export async function archiveCategoryAction(id: string, restore = false) { return run((s) => archiveCategory(s, id, restore)); }
export async function bulkPriceAction(ids: string[], mode: "percent" | "fixed", amount: number) { return run((s) => bulkPrice(s, ids, mode, amount)); }
export async function pairingsAction(source: string, paired: string[]) { return run((s) => savePairings(s, source, paired)); }
export async function modifierAction(input: Parameters<typeof saveModifierGroup>[1]) { return run((s) => saveModifierGroup(s, input)); }
export async function modifierActiveAction(id: string, active: boolean) { return run((s) => setModifierGroupActive(s, id, active)); }
export async function modifierOrderAction(itemId: string, ids: string[]) { return run((s) => reorderModifierGroups(s, itemId, ids)); }
export async function importPreviewAction(filename: string, base64: string) { return run(async () => ({ rows: await parseMenuFile(filename, Buffer.from(base64, "base64")) })); }
export async function importCommitAction(rows: Parameters<typeof commitMenuCsv>[1]) { return run((s) => commitMenuCsv(s, rows)); }
export async function uploadImageAction(filename: string, contentType: string, base64: string) { return run(async staff => { const brand = (await import("drizzle-orm")).eq; void brand; const { db } = await import("@/db"); const schema = await import("@/db/schema"); const [outlet] = await db.select({ brandId: schema.outlets.brandId }).from(schema.outlets).where((await import("drizzle-orm")).and((await import("drizzle-orm")).eq(schema.outlets.tenantId, staff.tenantId), (await import("drizzle-orm")).eq(schema.outlets.id, staff.outletId))); if (!outlet) throw new AppError("not_found", "Outlet not found."); return storeMenuImage({ tenantId: staff.tenantId, brandId: outlet.brandId, filename, contentType, bytes: Buffer.from(base64, "base64") }); }); }
