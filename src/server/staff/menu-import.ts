import "server-only";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";
import { menuManagerRoles } from "./menu-manager";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { db } from "@/db";

export type MenuImportRow = { category: string; nameEn: string; nameHi?: string; price: number; veg: boolean; jain?: boolean; spice?: number | null; allergens?: string[] | null; station: string; prepMinutes: number; aliases?: string; bestseller?: boolean };
export function parseMenuCsv(csv: string): MenuImportRow[] {
  const lines = csv.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); if (!lines.length) throw new AppError("invalid_state", "The import file is empty.");
  const head = lines[0].split(",").map((x) => x.trim().toLowerCase()); const required = ["category", "english name", "price", "station", "prep minutes"]; if (required.some((x) => !head.includes(x))) throw new AppError("invalid_state", `Import requires: ${required.join(", ")}.`);
  return lines.slice(1).map((line, i) => { const c = line.split(",").map((x) => x.trim()); const get = (name: string) => c[head.indexOf(name)] ?? ""; const price = Number(get("price")); if (!get("category") || !get("english name") || !Number.isInteger(price) || price < 0 || !get("station")) throw new AppError("invalid_state", `Import row ${i + 2} is invalid.`); return { category: get("category"), nameEn: get("english name"), nameHi: get("hindi name") || undefined, price, veg: ["true", "yes", "veg"].includes(get("veg").toLowerCase()), jain: ["true", "yes"].includes(get("jain").toLowerCase()), spice: get("spice") === "" ? null : Number(get("spice")), allergens: get("allergens") ? get("allergens").split("|").map((x) => x.trim()).filter(Boolean) : null, station: get("station"), prepMinutes: Number(get("prep minutes")) || 15, aliases: get("aliases"), bestseller: ["true", "yes"].includes(get("bestseller").toLowerCase()) }; });
}
export async function parseMenuFile(filename: string, bytes: Buffer) {
  if (/\.csv$/i.test(filename)) return parseMenuCsv(bytes.toString("utf8"));
  if (/\.xlsx$/i.test(filename)) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new AppError("invalid_state", "The XLSX file has no worksheets.");
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return parseMenuCsv(csv);
  }
  throw new AppError("invalid_state", "Upload a .csv or .xlsx menu file.");
}
export async function previewMenuCsv(staff: StaffSession, csv: string) { if (!staff.roles.some((r) => menuManagerRoles.includes(r as (typeof menuManagerRoles)[number]))) throw new AppError("forbidden", "Your role can't import menus."); const rows = parseMenuCsv(csv); return { rows, valid: rows.length, warnings: [], errors: [] }; }
/** Atomic import entry point; category/item writes are intentionally transactional. */
export async function commitMenuCsv(staff: StaffSession, rows: MenuImportRow[]) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only an owner can import a menu.");
  if (!rows.length) throw new AppError("invalid_state", "There are no valid rows to import.");
  const [outlet] = await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  if (!outlet) throw new AppError("not_found", "Outlet not found.");
  await db.transaction(async (tx) => {
    const categoryIds = new Map<string, string>();
    for (const row of rows) {
      let categoryId = categoryIds.get(row.category);
      if (!categoryId) {
        const [existing] = await tx.select({ id: s.menuCategories.id }).from(s.menuCategories).where(and(eq(s.menuCategories.tenantId, staff.tenantId), eq(s.menuCategories.brandId, outlet.brandId), eq(s.menuCategories.nameEn, row.category)));
        categoryId = existing?.id;
        if (!categoryId) categoryId = (await tx.insert(s.menuCategories).values({ tenantId: staff.tenantId, brandId: outlet.brandId, nameEn: row.category, nameHi: null, sortOrder: categoryIds.size }).$returningId())[0].id;
        categoryIds.set(row.category, categoryId);
      }
      await tx.insert(s.menuItems).values({ tenantId: staff.tenantId, brandId: outlet.brandId, categoryId, nameEn: row.nameEn.slice(0, 100), nameHi: row.nameHi?.slice(0, 100) ?? null, descriptionEn: null, descriptionHi: null, pricePaise: Math.round(row.price * 100), taxRateBp: 500, isVeg: row.veg, isJain: !!row.jain, spiceLevel: row.spice == null ? null : Math.max(0, Math.min(3, Math.round(row.spice))), allergens: row.allergens, searchTerms: row.aliases?.slice(0, 300) ?? null, prepMinutes: Math.max(0, Math.round(row.prepMinutes)), station: row.station.slice(0, 30), tags: row.bestseller ? ["bestseller"] : [], imageUrl: null, sortOrder: 0, isActive: true });
    }
    await tx.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: "menu.imported", entity: "menu", after: { rows: rows.length, categories: categoryIds.size }, createdAt: new Date() });
  });
  return { imported: rows.length };
}
