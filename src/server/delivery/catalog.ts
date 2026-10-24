import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { readDeliveryPolicy, deliveryQuote } from "@/domain/delivery";
import { isOpenAt } from "@/domain/hours";
import { priceLine } from "@/domain/pricing";
import { readFeatures } from "@/lib/plan-features";
import { tenantAccess } from "../access";
import { AppError } from "../errors";
import { outletGatewayFromConfig } from "../payments/outlet-gateway";
import { isWithinCategoryWindow, loadItems } from "../guest/menu";
import type { Runner } from "../db-types";

export async function deliveryOutlet(code: string, ordering = true, now = new Date()) {
  const [row] = await db.select({ outlet: s.outlets, custom: s.tenants.customFeatures, features: s.plans.features, logoUrl: s.brands.logoUrl }).from(s.outlets)
    .innerJoin(s.tenants, eq(s.tenants.id, s.outlets.tenantId)).innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode))
    .innerJoin(s.brands, and(eq(s.brands.id, s.outlets.brandId), eq(s.brands.tenantId, s.outlets.tenantId)))
    .where(eq(s.outlets.code, String(code).trim().toUpperCase())).limit(1);
  if (!row) throw new AppError("not_found", "Restaurant not found.");
  if ((await tenantAccess(row.outlet.tenantId)).state === "blocked") throw new AppError("outlet_unavailable", "This restaurant is unavailable.");
  const policy = readDeliveryPolicy(row.outlet.deliveryPolicy);
  if (ordering) {
    if (!readFeatures(row.custom ?? row.features).delivery) throw new AppError("forbidden", "Delivery is not available for this restaurant.");
    if (!policy.acceptingOrders) throw new AppError("outlet_unavailable", "Delivery is paused. Please contact the restaurant.");
    if (policy.paymentMode === "manual_qr" && !row.outlet.bookingPaymentQrUrl) throw new AppError("outlet_unavailable", "This restaurant has not added its payment QR yet. Please contact staff.");
    if (policy.paymentMode === "gateway" && !outletGatewayFromConfig(row.outlet.paymentGatewayConfig)) throw new AppError("outlet_unavailable", "Online delivery payment is not available right now. Please contact the restaurant.");
    if (!isOpenAt(row.outlet.openingHours, row.outlet.timezone, now)) throw new AppError("outlet_unavailable", "This restaurant is closed right now.");
  }
  return { ...row.outlet, policy, logoUrl: row.logoUrl };
}

export async function deliveryMenu(code: string, now = new Date()) {
  const outlet = await deliveryOutlet(code, true, now);
  const [categories, loaded] = await Promise.all([
    db.select({ id: s.menuCategories.id, nameEn: s.menuCategories.nameEn, nameHi: s.menuCategories.nameHi, imageUrl: s.menuCategories.imageUrl })
      .from(s.menuCategories)
      .where(and(eq(s.menuCategories.tenantId, outlet.tenantId), eq(s.menuCategories.brandId, outlet.brandId), eq(s.menuCategories.isActive, true)))
      .orderBy(asc(s.menuCategories.sortOrder)),
    loadItems(db, { tenantId: outlet.tenantId, outletId: outlet.id, brandId: outlet.brandId }, now),
  ]);
  const visible = loaded.filter(item => isWithinCategoryWindow(item.categoryWindow, outlet.timezone, now));
  const items = visible.map(({ item, pricing, categoryWindow }) => ({
    id: item.id,
    categoryId: item.categoryId,
    name: item.nameEn,
    nameHi: item.nameHi,
    description: item.descriptionEn,
    descriptionHi: item.descriptionHi,
    imageUrl: item.imageUrl,
    isVeg: item.isVeg,
    isJain: item.isJain,
    available: pricing.isAvailable,
    pricing,
    categoryWindow,
  }));
  const menuCategories = categories.map(category => ({
    ...category,
    items: items.filter(item => item.categoryId === category.id),
  })).filter(category => category.items.length > 0);
  return { outlet: { code: outlet.code, name: outlet.name, logoUrl: outlet.logoUrl, paymentQrUrl: outlet.policy.paymentMode === "manual_qr" ? outlet.bookingPaymentQrUrl : null, policy: outlet.policy }, categories: menuCategories, items };
}

export function cleanDeliveryCart(raw: s.DeliveryCartLine[]): s.DeliveryCartLine[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 40) throw new AppError("invalid_line", "Choose between 1 and 40 dishes.");
  return raw.map(line => {
    if (!line || typeof line.itemId !== "string" || line.itemId.length > 36 || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 20 || !Array.isArray(line.modifierIds) || line.modifierIds.length > 30 || line.modifierIds.some(id => typeof id !== "string" || id.length > 36)) throw new AppError("invalid_line", "Check your dish quantities and options.");
    return { itemId: line.itemId, qty: line.qty, modifierIds: [...new Set(line.modifierIds)] };
  });
}

export async function priceDeliveryCart(run: Runner, outlet: Awaited<ReturnType<typeof deliveryOutlet>>, raw: s.DeliveryCartLine[], pincode: string, now = new Date()) {
  const lines = cleanDeliveryCart(raw);
  const loaded = new Map((await loadItems(run, { tenantId: outlet.tenantId, outletId: outlet.id, brandId: outlet.brandId }, now, [...new Set(lines.map(line => line.itemId))])).map(item => [item.item.id, item]));
  const quantities = new Map<string, number>();
  const priced = lines.map(line => {
    const item = loaded.get(line.itemId);
    const result = item ? priceLine(item.pricing, line.qty, line.modifierIds) : null;
    if (!item || !result?.ok || !isWithinCategoryWindow(item.categoryWindow, outlet.timezone, now)) throw new AppError("items_unavailable", "A dish or option is unavailable. Please review your cart.");
    quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + line.qty);
    return { ...line, name: item.item.nameEn, unitPricePaise: result.line.unitPricePaise, linePaise: result.line.linePaise, taxRateBp: item.item.taxRateBp };
  });
  for (const [id, qty] of quantities) { const left = loaded.get(id)!.portionsLeft; if (left !== null && qty > left) throw new AppError("items_unavailable", "Not enough portions are available."); }
  const subtotalPaise = priced.reduce((sum, line) => sum + line.linePaise, 0);
  const taxByRate = new Map<number, number>();
  for (const line of priced) taxByRate.set(line.taxRateBp, (taxByRate.get(line.taxRateBp) ?? 0) + line.linePaise);
  const taxPaise = [...taxByRate].reduce((sum, [rate, amount]) => sum + Math.round(amount * rate / 10000), 0);
  let quote;
  try { quote = deliveryQuote(outlet.policy, pincode, subtotalPaise); } catch (error) { throw new AppError("invalid_state", error instanceof Error ? error.message : "Check your delivery area."); }
  // Delivery has no dine-in service charge. Fee is the final charge configured by the owner.
  return { lines: priced, subtotalPaise, taxPaise, deliveryFeePaise: quote.feePaise, totalPaise: Math.round((subtotalPaise + taxPaise) / 100) * 100 + quote.feePaise, estimatedMinutes: quote.estimatedMinutes };
}
