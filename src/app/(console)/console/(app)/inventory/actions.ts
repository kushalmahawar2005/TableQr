"use server";
import { AppError } from "@/server/errors";
import { addFromLibrary, getInventory, moveStock, removeStockItem, saveStockItem, setRecipe } from "@/server/staff/inventory";
import { getPurchasing, getStockReport, makePrep, paySupplier, recordCount, recordPurchase, removeSupplier, saveSupplier, setPrepRecipe, setStockSoldOut, type PurchaseInput } from "@/server/staff/inventory-pro";
import { staffFor } from "@/server/staff/request";

async function run<T>(work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) {
  try {
    return { ok: true as const, data: await work(await staffFor(["owner", "manager"], "inventory")) };
  } catch (e) {
    if (!(e instanceof AppError)) console.error("[inventory] action failed", e);
    return { ok: false as const, error: e instanceof AppError ? e.message : "Could not save. Try again." };
  }
}
export async function inventoryAction() { return run(getInventory); }
export async function saveItemAction(input: Parameters<typeof saveStockItem>[1]) { return run((s) => saveStockItem(s, input)); }
export async function libraryAction(names: string[]) { return run((s) => addFromLibrary(s, names)); }
export async function removeItemAction(id: string) { return run((s) => removeStockItem(s, id)); }
export async function moveAction(input: Parameters<typeof moveStock>[1]) { return run((s) => moveStock(s, input)); }
export async function recipeAction(itemId: string, lines: { stockItemId: string; qty: string }[]) { return run((s) => setRecipe(s, itemId, lines)); }

export async function purchasingAction() { return run(getPurchasing); }
export async function saveSupplierAction(input: Parameters<typeof saveSupplier>[1]) { return run((s) => saveSupplier(s, input)); }
export async function removeSupplierAction(id: string) { return run((s) => removeSupplier(s, id)); }
export async function purchaseAction(input: PurchaseInput) { return run((s) => recordPurchase(s, input, "purchase")); }
export async function returnAction(input: PurchaseInput) { return run((s) => recordPurchase(s, input, "return")); }
export async function payAction(input: Parameters<typeof paySupplier>[1]) { return run((s) => paySupplier(s, input)); }
export async function countAction(input: Parameters<typeof recordCount>[1]) { return run((s) => recordCount(s, input)); }
export async function prepRecipeAction(prepItemId: string, lines: { stockItemId: string; qty: string }[]) { return run((s) => setPrepRecipe(s, prepItemId, lines)); }
export async function makePrepAction(input: { prepItemId: string; qty: string }) { return run((s) => makePrep(s, input)); }
export async function stockSoldOutAction(on: boolean) { return run((s) => setStockSoldOut(s, on)); }
export async function reportAction(input: { from?: string; to?: string }) { return run((s) => getStockReport(s, input)); }
