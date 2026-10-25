"use server";
import { AppError } from "@/server/errors";
import { getInventory, moveStock, removeStockItem, saveStockItem, setRecipe } from "@/server/staff/inventory";
import { staffFor } from "@/server/staff/request";

async function run<T>(work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) {
  try {
    return { ok: true as const, data: await work(await staffFor(["owner", "manager"], "inventory")) };
  } catch (e) {
    return { ok: false as const, error: e instanceof AppError ? e.message : "Could not save. Try again." };
  }
}
export async function inventoryAction() { return run(getInventory); }
export async function saveItemAction(input: Parameters<typeof saveStockItem>[1]) { return run((s) => saveStockItem(s, input)); }
export async function removeItemAction(id: string) { return run((s) => removeStockItem(s, id)); }
export async function moveAction(input: Parameters<typeof moveStock>[1]) { return run((s) => moveStock(s, input)); }
export async function recipeAction(itemId: string, lines: { stockItemId: string; qty: string }[]) { return run((s) => setRecipe(s, itemId, lines)); }
