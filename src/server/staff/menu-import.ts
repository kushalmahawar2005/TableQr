import "server-only";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";
import { menuManagerRoles } from "./menu-manager";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { db } from "@/db";

export type MenuImportRow = { category: string; nameEn: string; nameHi?: string; price: number; veg: boolean; jain?: boolean; spice?: number | null; allergens?: string[] | null; station: string; prepMinutes: number; aliases?: string; bestseller?: boolean };
const MAX_IMPORT_BYTES = 1_000_000;
const MAX_IMPORT_ROWS = 1_000;

export function parseMenuCsv(csv: string): MenuImportRow[] {
  if (Buffer.byteLength(csv, "utf8") > MAX_IMPORT_BYTES) throw new AppError("invalid_state", "The CSV must be smaller than 1 MB.");
  const lines = csv.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); if (!lines.length) throw new AppError("invalid_state", "The import file is empty.");
  if (lines.length - 1 > MAX_IMPORT_ROWS) throw new AppError("invalid_state", `Import up to ${MAX_IMPORT_ROWS} dishes at a time.`);
  const head = lines[0].split(",").map((x) => x.trim().toLowerCase()); const required = ["category", "english name", "price", "station", "prep minutes"]; if (required.some((x) => !head.includes(x))) throw new AppError("invalid_state", `Import requires: ${required.join(", ")}.`);
  if (head.length > 20 || lines.some((line) => line.length > 5_000)) throw new AppError("invalid_state", "The CSV contains a row that is too large.");
  return lines.slice(1).map((line, i) => {
    const c = line.split(",").map((x) => x.trim());
    if (c.length > 20) throw new AppError("invalid_state", `Import row ${i + 2} has too many columns.`);
    const get = (name: string) => c[head.indexOf(name)] ?? "";
    const category = get("category"), nameEn = get("english name"), nameHi = get("hindi name"), station = get("station");
    const price = Number(get("price"));
    const prepInput = get("prep minutes");
    const prepMinutes = prepInput === "" ? 15 : Number(prepInput);
    const spiceInput = get("spice");
    const spice = spiceInput === "" ? null : Number(spiceInput);
    if (!category || category.length > 60 || !nameEn || nameEn.length > 100 || nameHi.length > 100 || !station || station.length > 60 || !Number.isInteger(price) || price < 0 || price > 1_000_000 || !Number.isInteger(prepMinutes) || prepMinutes < 1 || prepMinutes > 1_440 || (spice !== null && (!Number.isFinite(spice) || spice < 0 || spice > 5))) {
      throw new AppError("invalid_state", `Import row ${i + 2} is invalid.`);
    }
    const allergens = get("allergens").split("|").map((x) => x.trim()).filter(Boolean);
    if (allergens.length > 20 || allergens.some((x) => x.length > 40)) throw new AppError("invalid_state", `Import row ${i + 2} has invalid allergens.`);
    const aliases = get("aliases");
    if (aliases.length > 255) throw new AppError("invalid_state", `Import row ${i + 2} has aliases that are too long.`);
    return { category, nameEn, nameHi: nameHi || undefined, price, veg: ["true", "yes", "veg"].includes(get("veg").toLowerCase()), jain: ["true", "yes"].includes(get("jain").toLowerCase()), spice, allergens: allergens.length ? allergens : null, station, prepMinutes, aliases, bestseller: ["true", "yes"].includes(get("bestseller").toLowerCase()) };
  });
}
export async function parseMenuFile(filename: string, bytes: Buffer) {
  if (bytes.length > MAX_IMPORT_BYTES) throw new AppError("invalid_state", "The CSV must be smaller than 1 MB.");
  if (!/\.csv$/i.test(filename)) throw new AppError("invalid_state", "Upload a .csv menu file.");
  return parseMenuCsv(bytes.toString("utf8"));
}
export async function previewMenuCsv(staff: StaffSession, csv: string) { if (!staff.roles.some((r) => menuManagerRoles.includes(r as (typeof menuManagerRoles)[number]))) throw new AppError("forbidden", "Your role can't import menus."); const rows = parseMenuCsv(csv); return { rows, valid: rows.length, warnings: [], errors: [] }; }

export function validateMenuImportRows(input: unknown): MenuImportRow[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_IMPORT_ROWS) throw new AppError("invalid_state", "Import between 1 and 1,000 valid dishes.");
  const cleanText = (value: unknown, max: number, field: string, required = false) => {
    if (value == null && !required) return "";
    if (typeof value !== "string" || value.length > max) throw new AppError("invalid_state", `An imported ${field} is invalid.`);
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (required && !clean) throw new AppError("invalid_state", `An imported ${field} is missing.`);
    return clean;
  };
  return input.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("invalid_state", "An imported dish is invalid.");
    const row = value as Record<string, unknown>;
    const category = cleanText(row.category, 60, "category", true);
    const nameEn = cleanText(row.nameEn, 100, "dish name", true);
    const nameHi = cleanText(row.nameHi, 100, "Hindi dish name");
    const station = cleanText(row.station, 60, "station", true);
    const aliases = cleanText(row.aliases, 255, "aliases");
    const price = row.price;
    const prepMinutes = row.prepMinutes;
    const spice = row.spice == null ? null : row.spice;
    if (typeof price !== "number" || !Number.isInteger(price) || price < 0 || price > 1_000_000 || typeof prepMinutes !== "number" || !Number.isInteger(prepMinutes) || prepMinutes < 1 || prepMinutes > 1_440 || (spice !== null && (typeof spice !== "number" || !Number.isFinite(spice) || spice < 0 || spice > 5))) {
      throw new AppError("invalid_state", "An imported price, preparation time, or spice level is invalid.");
    }
    if (typeof row.veg !== "boolean" || (row.jain != null && typeof row.jain !== "boolean") || (row.bestseller != null && typeof row.bestseller !== "boolean")) throw new AppError("invalid_state", "An imported dish option is invalid.");
    const allergens = row.allergens == null ? null : row.allergens;
    if (allergens !== null && (!Array.isArray(allergens) || allergens.length > 20 || allergens.some((item) => typeof item !== "string" || item.length > 40))) throw new AppError("invalid_state", "An imported allergen list is invalid.");
    return { category, nameEn, nameHi: nameHi || undefined, price, veg: row.veg, jain: row.jain === true, spice, allergens: allergens as string[] | null, station, prepMinutes, aliases: aliases || undefined, bestseller: row.bestseller === true };
  });
}

/** Atomic import entry point; category/item writes are intentionally transactional. */
export async function commitMenuCsv(staff: StaffSession, input: unknown) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only an owner can import a menu.");
  const rows = validateMenuImportRows(input);
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
